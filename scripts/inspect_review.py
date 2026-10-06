import base64
import binascii
import gzip
import hashlib
import json
import re
import sys
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path


FULL_FORMAT = "html-review"
ANNOTATIONS_FORMAT = "html-review-annotations"
SCHEMA_VERSION = 1
SHA256_RE = re.compile(r"^[0-9a-fA-F]{64}$")


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
    if not isinstance(data, dict) or type(data.get("schemaVersion")) is not int or data["schemaVersion"] != SCHEMA_VERSION:
        raise ValueError("不支持的数据格式或版本")
    source, expected = require_source(data)

    if data.get("format") == FULL_FORMAT:
        if not isinstance(source.get("base64"), str):
            raise ValueError("完整批注副本缺少原文件快照")
        validate_full_snapshot(data, source, expected)
    elif data.get("format") == ANNOTATIONS_FORMAT:
        validate_lightweight_data(data)
    else:
        raise ValueError("不支持的数据格式或版本")
    normalize_annotations(data["annotations"])
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
    print("文本编码：", source.get("encoding", "未注明"))
    print("批注数量：", len(data["annotations"]))
    print(json.dumps([{**annotation, "taskState": task_state(annotation)} for annotation in data["annotations"]], ensure_ascii=False, indent=2))
    if actual != expected or len(actual_bytes) != source["byteLength"]:
        print(
            "版本不一致：请先比较原文件版本并核实每个目标；不要直接套用定位或覆盖文件。",
            file=sys.stderr,
        )
        return 2
    if data["format"] == ANNOTATIONS_FORMAT:
        print("版本校验通过：轻量批注不含源文件快照；可结合收到的原文件、批注和上下文逐条定位。")
    else:
        print("版本校验通过：内嵌快照和当前原文件均已校验；可结合原文、元素内容与上下文逐条定位。")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("用法：python inspect_review.py 批注副本.review.html|.review.html.gz|.review.json 原始.html")
    try:
        raise SystemExit(inspect(sys.argv[1], sys.argv[2]))
    except (OSError, EOFError, UnicodeDecodeError, ValueError, KeyError, TypeError, binascii.Error, gzip.BadGzipFile) as error:
        raise SystemExit("检查失败：" + str(error))
