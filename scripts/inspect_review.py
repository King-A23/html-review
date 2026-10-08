import base64
import binascii
import gzip
import hashlib
import io
import json
import math
import posixpath
import re
import sys
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path
from zipfile import ZipFile, BadZipFile
from xml.etree import ElementTree as ET


FULL_FORMAT = "html-review"
ANNOTATIONS_FORMAT = "html-review-annotations"
SCHEMA_VERSION = 1
SHA256_RE = re.compile(r"^[0-9a-fA-F]{64}$")
DOCX_PARTS = {"word/document.xml", "word/footnotes.xml", "word/endnotes.xml"}
DOCX_NAMESPACES = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "w14": "http://schemas.microsoft.com/office/word/2010/wordml",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    "pic": "http://schemas.openxmlformats.org/drawingml/2006/picture",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "v": "urn:schemas-microsoft-com:vml",
}
DOCX_STEP_RE = re.compile(r"([A-Za-z][A-Za-z0-9]*):([A-Za-z][A-Za-z0-9]*)\[([1-9][0-9]*)\]")


def docx_path_steps(path):
    """Parse only absolute child paths; never execute user supplied XPath."""
    if not isinstance(path, str) or not path.startswith("/") or len(path) > 8192:
        raise ValueError("DOCX 路径无效")
    steps = []
    for segment in path[1:].split("/"):
        match = DOCX_STEP_RE.fullmatch(segment)
        if not match or match[1] not in DOCX_NAMESPACES or len(match[3]) > 9:
            raise ValueError("DOCX 路径必须为带命名空间和 1 起始索引的子节点路径")
        steps.append(("{" + DOCX_NAMESPACES[match[1]] + "}" + match[2], int(match[3])))
    return steps


def resolve_docx_path(root, path):
    steps = docx_path_steps(path)
    if not steps or steps[0] != (root.tag, 1):
        raise ValueError("DOCX 路径根节点不匹配：" + path)
    node = root
    for tag, index in steps[1:]:
        children = [child for child in node if child.tag == tag]
        if index > len(children):
            raise ValueError("DOCX 路径不存在：" + path)
        node = children[index - 1]
    return node


def validate_docx_targets(data, expected):
    source = data["source"]
    if source.get("type") != "docx" or source.get("adapterVersion") != "1":
        raise ValueError("DOCX source 类型或适配器版本无效")
    if data.get("resources") != []:
        raise ValueError("DOCX 资源必须保留在原始 ZIP 中，resources 必须为空列表")
    if any(key in source for key in ("encoding", "html", "index", "previewHtml", "blockIndex")):
        raise ValueError("DOCX source 不应包含编码或预览缓存")
    targets = [annotation.get("target") for annotation in data["annotations"]]
    targets.extend(event["target"] for annotation in data["annotations"] for event in annotation.get("targetHistory", []))
    for target in targets:
        if not isinstance(target, dict) or target.get("kind") not in ("text", "element", "page"):
            raise ValueError("DOCX 批注目标无效")
        if target["kind"] == "page" and target.get("scope") != "whole-document":
            raise ValueError("DOCX 不支持单页批注")
        mapping = target.get("docx")
        if not isinstance(mapping, dict) or mapping.get("adapterVersion") != "1":
            raise ValueError("DOCX 目标适配器版本无效")
        if not isinstance(mapping.get("sourceSha256"), str) or not SHA256_RE.fullmatch(mapping["sourceSha256"]):
            raise ValueError("DOCX 目标源文件哈希无效")
        blocks = mapping.get("blocks")
        if not isinstance(blocks, list) or len(blocks) > 10000:
            raise ValueError("DOCX 目标 blocks 无效")
        ids = set()
        for block in blocks:
            if not isinstance(block, dict) or not isinstance(block.get("id"), str) or not block["id"] or block["id"] in ids:
                raise ValueError("DOCX block ID 无效或重复")
            ids.add(block["id"])
            if block.get("part") not in DOCX_PARTS:
                raise ValueError("DOCX block part 不受支持")
            docx_path_steps(block.get("path"))
            if "paraId" in block and not isinstance(block["paraId"], str):
                raise ValueError("DOCX paraId 无效")
            if "table" in block:
                table = block["table"]
                if not isinstance(table, dict) or any(type(table.get(key)) is not int or table[key] < 1 for key in ("row", "column")):
                    raise ValueError("DOCX 表格行列必须为 1 起始整数")
                docx_path_steps(table.get("path"))
            if "image" in block:
                image = block["image"]
                if not isinstance(image, dict) or not isinstance(image.get("relationshipId"), str) or not image["relationshipId"] or not isinstance(image.get("mediaPath"), str) or not image["mediaPath"].startswith("word/media/") or ".." in image["mediaPath"].split("/") or "\\" in image["mediaPath"] or not isinstance(image.get("sha256"), str) or not SHA256_RE.fullmatch(image["sha256"]):
                    raise ValueError("DOCX 图片映射无效")
        for endpoint in ("start", "end"):
            if endpoint in mapping:
                point = mapping[endpoint]
                if not isinstance(point, dict) or point.get("id") not in ids or type(point.get("offset")) is not int or point["offset"] < 0:
                    raise ValueError("DOCX 文字偏移无效")
        if ("start" in mapping) != ("end" in mapping):
            raise ValueError("DOCX 文字范围必须同时提供 start 和 end")
        if target["kind"] == "text" and "start" not in mapping:
            raise ValueError("DOCX 文字目标缺少 start 和 end")
        if not blocks and target.get("scope") != "whole-document":
            raise ValueError("DOCX 非整体目标缺少 blocks")


def bounded_docx_archive(raw):
    archive = ZipFile(io.BytesIO(raw))
    entries = archive.infolist()
    if len(entries) > 3000 or sum(info.file_size for info in entries) > 100 * 1024 * 1024:
        archive.close()
        raise ValueError("DOCX ZIP 超出 3000 文件或 100 MiB 解压大小限制")
    names = [info.filename for info in entries]
    if len(set(names)) != len(names) or any(name.startswith("/") or "\\" in name or ".." in name.split("/") for name in names):
        archive.close()
        raise ValueError("DOCX ZIP 含重复或不安全路径")
    if "word/document.xml" not in names:
        archive.close()
        raise ValueError("DOCX ZIP 缺少 word/document.xml")
    return archive


def read_docx_xml(archive, part):
    raw = archive.read(part)
    if re.search(br"<!\s*(?:DOCTYPE|ENTITY)\b", raw.replace(b"\x00", b""), re.I):
        raise ValueError("DOCX XML 不允许 DTD 或实体声明")
    try:
        return ET.fromstring(raw)
    except ET.ParseError as error:
        raise ValueError("DOCX XML 无效：" + part) from error


def docx_paragraph_text(node):
    w = "{" + DOCX_NAMESPACES["w"] + "}"
    def visit(item):
        if item.tag == w + "del":
            return ""
        if item.tag == w + "t":
            return item.text or ""
        if item.tag == w + "tab":
            return "\t"
        if item.tag == w + "noBreakHyphen":
            return "\u2011"
        if item.tag == w + "softHyphen":
            return "\u00ad"
        if item.tag == w + "br" and item.get(w + "type") in ("page", "column"):
            return ""
        if item.tag in (w + "br", w + "cr"):
            return "\n"
        return "".join(visit(child) for child in item)
    return visit(node)


def docx_evidence(data, raw):
    """Return only mapped paragraphs and table/image evidence, never the full ZIP."""
    with bounded_docx_archive(raw) as archive:
        roots = {}
        output = []
        current_hash = sha256(raw)
        for annotation in data["annotations"]:
            mapping = annotation["target"]["docx"]
            if mapping["sourceSha256"].lower() != current_hash:
                output.append({"annotationId": annotation["id"], "stale": True,
                               "sourceSha256": mapping["sourceSha256"],
                               "message": "旧版本目标：批注时源文件与当前 DOCX 不同；请根据原文和上下文重新核对定位。",
                               "evidence": []})
                continue
            evidence = []
            texts = {}
            for block in mapping["blocks"]:
                part = block["part"]
                if part not in roots:
                    roots[part] = read_docx_xml(archive, part)
                node = resolve_docx_path(roots[part], block["path"])
                paragraph_tag = "{" + DOCX_NAMESPACES["w"] + "}p"
                text = docx_paragraph_text(node)
                if "paraId" in block and node.get("{" + DOCX_NAMESPACES["w14"] + "}paraId") != block["paraId"]:
                    raise ValueError("DOCX paraId 不匹配：" + block["id"])
                record = {"id": block["id"], "part": part, "path": block["path"]}
                if node.tag == paragraph_tag:
                    record["paragraph"] = text
                    texts[block["id"]] = text
                elif node.tag in ("{" + DOCX_NAMESPACES["w"] + "}" + tag for tag in ("tbl", "tr", "tc")) and "table" in block:
                    record["paragraphs"] = [docx_paragraph_text(paragraph) for paragraph in node.iter(paragraph_tag)]
                elif "image" not in block:
                    raise ValueError("DOCX block 路径未指向段落或图片")
                if "table" in block:
                    table = block["table"]
                    table_node = resolve_docx_path(roots[part], table["path"])
                    w = "{" + DOCX_NAMESPACES["w"] + "}"
                    rows = [child for child in table_node if child.tag == w + "tr"]
                    if table_node.tag != w + "tbl" or table["row"] > len(rows):
                        raise ValueError("DOCX 表格行映射不匹配")
                    cells = [child for child in rows[table["row"] - 1] if child.tag == w + "tc"]
                    if table["column"] > len(cells) or (node not in list(cells[table["column"] - 1].iter()) and cells[table["column"] - 1] not in list(node.iter())):
                        raise ValueError("DOCX 表格列映射不匹配")
                    record["table"] = table
                if "image" in block:
                    image = block["image"]
                    relpart = posixpath.join(posixpath.dirname(part), "_rels", posixpath.basename(part) + ".rels")
                    rels = read_docx_xml(archive, relpart)
                    matches = [rel for rel in rels if rel.get("Id") == image["relationshipId"]]
                    if len(matches) != 1 or matches[0].get("TargetMode") == "External" or not matches[0].get("Type", "").endswith("/image"):
                        raise ValueError("DOCX 图片关系无效")
                    target = matches[0].get("Target", "")
                    media_path = posixpath.normpath(target.lstrip("/") if target.startswith("/") else posixpath.join(posixpath.dirname(part), target))
                    relationship_values = [value for item in node.iter() for key, value in item.attrib.items() if key in ("{" + DOCX_NAMESPACES["r"] + "}embed", "{" + DOCX_NAMESPACES["r"] + "}id")]
                    if image["relationshipId"] not in relationship_values or media_path != image["mediaPath"] or sha256(archive.read(media_path)) != image["sha256"].lower():
                        raise ValueError("DOCX 图片内容或关系映射不匹配")
                    record["image"] = image
                evidence.append(record)
            for endpoint in ("start", "end"):
                if endpoint in mapping:
                    point = mapping[endpoint]
                    if point["id"] not in texts or point["offset"] > string_length(texts[point["id"]]):
                        raise ValueError("DOCX 文字偏移超出对应段落")
            if "start" in mapping:
                start, end = mapping["start"], mapping["end"]
                ids = [block["id"] for block in mapping["blocks"]]
                if ids.index(start["id"]) > ids.index(end["id"]) or (start["id"] == end["id"] and start["offset"] > end["offset"]):
                    raise ValueError("DOCX 文字范围顺序无效")
            output.append({"annotationId": annotation["id"], "evidence": evidence})
        return output


def configure_stdio():
    """Keep Chinese/emoji readable when agents pipe output on Windows."""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")


class ReviewDataParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.collecting = False
        self.blocks = []
        self.current = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag.lower() == "script" and attrs.get("id") == "html-review-data":
            if attrs.get("type", "").lower() != "application/json":
                raise ValueError("html-review-data 不是 application/json 数据块")
            self.collecting = True
            self.current = []

    def handle_data(self, data):
        if self.collecting:
            self.current.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "script" and self.collecting:
            self.blocks.append("".join(self.current))
            self.collecting = False


def sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def read_review_data(review_path):
    raw = Path(review_path).read_bytes()
    compressed = raw.startswith(b"\x1f\x8b")
    if compressed:
        raw = gzip.decompress(raw)
    text = raw.decode("utf-8-sig")
    stripped = text.lstrip()
    if stripped.startswith("{"):
        return json.loads(text), "轻量批注 JSON"

    parser = ReviewDataParser()
    parser.feed(text)
    parser.close()
    if len(parser.blocks) != 1 or parser.collecting:
        raise ValueError("必须恰好有一个完整的 html-review-data 数据块")
    return json.loads(parser.blocks[0]), "完整批注副本（gzip）" if compressed else "完整批注副本"


def require_source(data):
    if not isinstance(data, dict) or not isinstance(data.get("source"), dict):
        raise ValueError("批注缺少 source 元数据")
    source = data["source"]
    if not isinstance(source.get("name"), str) or not isinstance(source.get("path", ""), str):
        raise ValueError("source 名称或路径无效")
    if not isinstance(source.get("byteLength"), int) or source["byteLength"] < 0:
        raise ValueError("source 字节数无效")
    expected = source.get("sha256")
    if not isinstance(expected, str) or not SHA256_RE.fullmatch(expected):
        raise ValueError("source SHA-256 无效")
    if not isinstance(data.get("annotations"), list):
        raise ValueError("批注列表无效")
    if not isinstance(data.get("resources", []), list):
        raise ValueError("资源列表无效")
    return source, expected.lower()


def validate_resource_metadata(resource):
    if not isinstance(resource, dict):
        raise ValueError("资源元数据无效")
    if not isinstance(resource.get("path"), str) or not isinstance(resource.get("mime"), str):
        raise ValueError("资源路径或类型无效")
    digest = resource.get("sha256")
    if not isinstance(digest, str) or not SHA256_RE.fullmatch(digest):
        raise ValueError("资源 SHA-256 无效：" + resource["path"])


def validate_full_snapshot(data, source, expected):
    snapshot = base64.b64decode(source["base64"], validate=True)
    if sha256(snapshot) != expected:
        raise ValueError("内嵌原文件快照 SHA-256 不一致；请勿按此副本修改")
    if len(snapshot) != source["byteLength"]:
        raise ValueError("内嵌原文件字节数不一致")

    for resource in data.get("resources", []):
        validate_resource_metadata(resource)
        raw = base64.b64decode(resource["base64"], validate=True)
        if sha256(raw) != resource["sha256"].lower():
            raise ValueError("资源快照哈希不一致：" + resource["path"])


def validate_lightweight_data(data):
    for resource in data.get("resources", []):
        validate_resource_metadata(resource)
        if "base64" in resource:
            raise ValueError("轻量批注 JSON 不应包含资源 Base64")
    if "base64" in data["source"]:
        raise ValueError("轻量批注 JSON 不应包含原文件 Base64")


def valid_time(value):
    if not isinstance(value, str) or not value or len(value) >= 80:
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


def string_length(value):
    """Count UTF-16 code units like the browser's string-length limits."""
    return len(value.encode("utf-16-le", errors="surrogatepass")) // 2


def validate_dimensions(value):
    if not isinstance(value, dict):
        raise ValueError("定位视口或边界必须为对象")
    for key in ("x", "y", "width", "height", "scrollX", "scrollY", "devicePixelRatio"):
        if key in value and (type(value[key]) not in (int, float) or not math.isfinite(value[key]) or
                             (key in ("width", "height", "devicePixelRatio") and value[key] < 0)):
            raise ValueError("定位视口或边界包含无效尺寸")


def validate_history_target(target):
    """Validate historical HTML anchors by their own kind, without source evidence lookup."""
    if not isinstance(target, dict) or target.get("kind") not in ("text", "element", "page"):
        raise ValueError("重新定位历史目标类型无效")
    kind = target["kind"]

    def text(value, maximum, required=False):
        if not isinstance(value, str) or string_length(value) > maximum or (required and not value.strip()):
            raise ValueError("重新定位历史目标文字字段无效")

    def integer(value):
        return type(value) is int and 0 <= value <= 9007199254740991

    def dom_path(value):
        if not isinstance(value, list) or len(value) > 150 or any(not integer(index) for index in value):
            raise ValueError("重新定位历史 DOM 路径无效")

    nodes = [0]
    def tree(value, depth=0):
        nodes[0] += 1
        if nodes[0] > 30000 or depth > 24:
            raise ValueError("重新定位历史目标过于复杂")
        if isinstance(value, dict):
            for key, child in value.items():
                if key in ("__proto__", "prototype", "constructor"):
                    raise ValueError("重新定位历史包含不安全字段")
                tree(child, depth + 1)
        elif isinstance(value, list):
            for child in value:
                tree(child, depth + 1)
        elif isinstance(value, str):
            text(value, 250000)
        elif type(value) in (int, float) and not math.isfinite(value):
            raise ValueError("重新定位历史包含无效数字")
    tree(target)
    for key in ("text", "selector", "tag", "id", "scope", "textFingerprint"):
        if key in target:
            text(target[key], 20000 if key == "text" else 4096)
    if kind != "page":
        text(target.get("selector"), 4096, True)
    if kind == "element" and (not isinstance(target.get("tag"), str) or not re.fullmatch(r"[a-zA-Z][\w:-]*", target["tag"])):
        raise ValueError("重新定位历史元素类型无效")
    if kind == "page" and target.get("scope") == "page":
        if any(type(target.get(key)) is not int for key in ("pageIndex", "pageCount")) or not 1 <= target["pageIndex"] <= target["pageCount"] <= 1000:
            raise ValueError("重新定位历史页码无效")
        text(target.get("pageTitle"), 100)
        text(target.get("selector"), 4096)
        if not target.get("tag"):
            raise ValueError("重新定位历史单页目标缺少元素类型")
    if "quote" in target or kind == "text":
        quote = target.get("quote")
        if not isinstance(quote, dict):
            raise ValueError("重新定位历史原文无效")
        for key in ("exact", "prefix", "suffix"):
            if key in quote or (key == "exact" and kind == "text"):
                text(quote.get(key), 20000, key == "exact" and kind == "text")
    if "attributes" in target:
        if not isinstance(target["attributes"], dict):
            raise ValueError("重新定位历史元素属性无效")
        for value in target["attributes"].values():
            text(value, 16000)
    if "classes" in target:
        if not isinstance(target["classes"], list) or len(target["classes"]) > 4000:
            raise ValueError("重新定位历史样式类无效")
        for value in target["classes"]:
            text(value, 4096)
    if "domPath" in target:
        dom_path(target["domPath"])
    if "range" in target:
        if not isinstance(target["range"], dict):
            raise ValueError("重新定位历史文字范围无效")
        for key in ("start", "end"):
            endpoint = target["range"].get(key)
            if not isinstance(endpoint, dict) or not integer(endpoint.get("offset")):
                raise ValueError("重新定位历史文字范围无效")
            dom_path(endpoint.get("path"))
    if "position" in target:
        value = target["position"]
        if not isinstance(value, dict) or not integer(value.get("start")) or not integer(value.get("end")) or value["start"] >= value["end"]:
            raise ValueError("重新定位历史文字偏移无效")
    if "textLength" in target and not integer(target["textLength"]):
        raise ValueError("重新定位历史文字长度无效")
    if "textFingerprint" in target and not re.fullmatch(r"[a-f0-9]{8}", target["textFingerprint"]):
        raise ValueError("重新定位历史文字指纹无效")
    if "attributeFingerprints" in target:
        if not isinstance(target["attributeFingerprints"], dict):
            raise ValueError("重新定位历史属性指纹无效")
        for value in target["attributeFingerprints"].values():
            if not isinstance(value, dict) or not integer(value.get("length")) or not isinstance(value.get("hash"), str) or not re.fullmatch(r"[a-f0-9]{8}", value["hash"]):
                raise ValueError("重新定位历史属性指纹无效")
    if "context" in target:
        context = target["context"]
        if not isinstance(context, dict):
            raise ValueError("重新定位历史上下文无效")
        if "sourcePath" in context:
            text(context["sourcePath"], 4096, True)
        for key in ("ancestor", "siblingBefore", "siblingAfter"):
            neighbor = context.get(key)
            if neighbor is None:
                continue
            if not isinstance(neighbor, dict):
                raise ValueError("重新定位历史相邻上下文无效")
            for field in ("tag", "id", "text"):
                if field in neighbor:
                    text(neighbor[field], 4096)
    for key in ("rect", "viewport"):
        if key in target:
            validate_dimensions(target[key])


def validate_target_history(annotation, revision):
    history = annotation.get("targetHistory", [])
    if not isinstance(history, list) or len(history) > 100:
        raise ValueError("重新定位历史无效或超过 100 条")
    previous_revision = 0
    for event in history:
        if not isinstance(event, dict) or type(event.get("revision")) is not int or not previous_revision < event["revision"] < revision:
            raise ValueError("重新定位历史 revision 必须严格递增且小于当前版本")
        previous_revision = event["revision"]
        validate_history_target(event.get("target"))
        if "view" in event:
            validate_dimensions(event["view"])
        if not valid_time(event.get("at")):
            raise ValueError("重新定位历史时间无效")


def normalize_annotations(annotations):
    ids = set()
    for annotation in annotations:
        if not isinstance(annotation, dict):
            raise ValueError("批注记录无效")
        annotation_id = annotation.get("id")
        if not isinstance(annotation_id, str) or not annotation_id.strip() or string_length(annotation_id) > 200:
            raise ValueError("批注 ID 无效")
        if annotation_id in ids:
            raise ValueError("批注 ID 重复：" + annotation_id)
        ids.add(annotation_id)
        if not valid_time(annotation.get("updatedAt")):
            raise ValueError("批注更新时间无效：" + annotation_id)
        revision = annotation.get("revision", 1)
        if type(revision) is not int or revision < 1 or revision > 9007199254740991:
            raise ValueError("批注 revision 必须是正整数：" + annotation_id)
        validate_target_history(annotation, revision)
        status = annotation.get("status", "open")
        if status not in ("open", "resolved"):
            raise ValueError("批注状态无效：" + annotation_id)
        history = annotation.get("history", [])
        if not isinstance(history, list) or len(history) > 500:
            raise ValueError("批注历史无效：" + annotation_id)
        batches = set()
        previous_revision = 0
        for event in history:
            if not isinstance(event, dict) or type(event.get("revision")) is not int or not 1 <= event["revision"] <= revision or event["revision"] < previous_revision:
                raise ValueError("批注历史 revision 无效：" + annotation_id)
            if not isinstance(event.get("batchId"), str) or not event["batchId"].strip() or string_length(event["batchId"]) > 200:
                raise ValueError("批注历史 batchId 无效：" + annotation_id)
            if event["batchId"] in batches:
                raise ValueError("批注历史 batchId 重复：" + annotation_id)
            batches.add(event["batchId"])
            previous_revision = event["revision"]
            if event.get("status") not in ("open", "resolved"):
                raise ValueError("批注历史状态无效：" + annotation_id)
            if not isinstance(event.get("summary"), str) or string_length(event["summary"]) > 4000:
                raise ValueError("批注历史说明无效：" + annotation_id)
            if not isinstance(event.get("by"), str) or not event["by"].strip() or string_length(event["by"]) > 200 or not valid_time(event.get("at")):
                raise ValueError("批注历史作者或时间无效：" + annotation_id)
            if "annotationUpdatedAt" in event and not valid_time(event["annotationUpdatedAt"]):
                raise ValueError("批注历史对应的更新时间无效：" + annotation_id)
        annotation.update(revision=revision, status=status, history=history)
    return annotations


def task_state(annotation):
    if annotation.get("status", "open") == "resolved":
        return "completed"
    history = annotation.get("history", [])
    if not history:
        return "new"
    if history[-1]["revision"] < annotation.get("revision", 1):
        return "updated"
    return "pending"


def read_review(review_path):
    """Read and validate a review independently of the current source file."""
    data, input_kind = read_review_data(review_path)
    if not isinstance(data, dict) or type(data.get("schemaVersion")) is not int or data["schemaVersion"] not in (1, 2):
        raise ValueError("不支持的数据格式或版本")
    source, expected = require_source(data)
    normalize_annotations(data["annotations"])
    if data["schemaVersion"] == 2:
        validate_docx_targets(data, expected)
    elif source.get("type") == "docx":
        raise ValueError("DOCX 必须使用 schemaVersion 2")

    if data.get("format") == FULL_FORMAT:
        if not isinstance(source.get("base64"), str):
            raise ValueError("完整批注副本缺少原文件快照")
        validate_full_snapshot(data, source, expected)
        if data["schemaVersion"] == 2:
            docx_evidence(data, base64.b64decode(source["base64"], validate=True))
    elif data.get("format") == ANNOTATIONS_FORMAT:
        validate_lightweight_data(data)
    else:
        raise ValueError("不支持的数据格式或版本")
    return data, input_kind


def inspect(review_path, original_path):
    data, input_kind = read_review(review_path)
    source, expected = require_source(data)

    actual_bytes = Path(original_path).read_bytes()
    actual = sha256(actual_bytes)
    print("输入类型：", input_kind)
    print("原文件名称：", source["name"])
    print("导入时路径：", source.get("path", ""))
    print("批注时 SHA-256：", expected)
    print("当前原文件 SHA-256：", actual)
    if data["schemaVersion"] == 2:
        print("原文件类型： DOCX；适配器版本：", source["adapterVersion"])
    else:
        print("文本编码：", source.get("encoding", "未注明"))
    print("批注数量：", len(data["annotations"]))
    displayed = []
    for annotation in data["annotations"]:
        item = {key: value for key, value in annotation.items() if key != "targetHistory"}
        item["taskState"] = task_state(annotation)
        if "targetHistory" in annotation:
            item["targetHistorySummary"] = [{"revision": event["revision"], "kind": event["target"]["kind"]}
                                            for event in annotation["targetHistory"]]
        displayed.append(item)
    print(json.dumps(displayed, ensure_ascii=False, indent=2))
    if actual != expected or len(actual_bytes) != source["byteLength"]:
        print(
            "版本不一致：请先比较原文件版本并核实每个目标；不要直接套用定位或覆盖文件。",
            file=sys.stderr,
        )
        return 2
    if data["schemaVersion"] == 2:
        print("DOCX 对应原文证据：")
        print(json.dumps(docx_evidence(data, actual_bytes), ensure_ascii=False, indent=2))
    if data["format"] == ANNOTATIONS_FORMAT:
        print("版本校验通过：轻量批注不含源文件快照；可结合收到的原文件、批注和上下文逐条定位。")
    else:
        print("版本校验通过：内嵌快照和当前原文件均已校验；可结合原文、元素内容与上下文逐条定位。")
    return 0


if __name__ == "__main__":
    configure_stdio()
    usage = "用法：python inspect_review.py 批注副本.review.html|.review.html.gz|.review.json 原始.html|原始.docx"
    if len(sys.argv) == 2 and sys.argv[1] in ("-h", "--help"):
        print(usage)
        raise SystemExit(0)
    if len(sys.argv) != 3:
        raise SystemExit(usage)
    try:
        raise SystemExit(inspect(sys.argv[1], sys.argv[2]))
    except (OSError, EOFError, UnicodeDecodeError, ValueError, KeyError, TypeError, binascii.Error, gzip.BadGzipFile, BadZipFile, RuntimeError, RecursionError) as error:
        raise SystemExit("检查失败：" + str(error))
