import base64
import binascii
import hashlib
import json
import sys
from html.parser import HTMLParser
from pathlib import Path


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


def inspect(review_path, original_path):
    parser = ReviewDataParser()
    parser.feed(Path(review_path).read_text(encoding="utf-8-sig"))
    parser.close()
    if len(parser.blocks) != 1 or parser.collecting:
        raise ValueError("必须恰好有一个完整的 html-review-data 数据块")
    data = json.loads(parser.blocks[0])
    if not isinstance(data, dict) or data.get("format") != "html-review" or data.get("schemaVersion") != 1:
        raise ValueError("不支持的数据格式或版本")

    source = data["source"]
    snapshot = base64.b64decode(source["base64"], validate=True)
    expected = source["sha256"].lower()
    if sha256(snapshot) != expected:
        raise ValueError("内嵌原文件快照 SHA-256 不一致；请勿按此副本修改")
    if len(snapshot) != source["byteLength"]:
        raise ValueError("内嵌原文件字节数不一致")

    for resource in data.get("resources", []):
        raw = base64.b64decode(resource["base64"], validate=True)
        if sha256(raw) != resource["sha256"].lower():
            raise ValueError("资源快照哈希不一致：" + resource["path"])

    actual = sha256(Path(original_path).read_bytes())
    print("原文件名称：", source["name"])
    print("导入时路径：", source.get("path", ""))
    print("批注时 SHA-256：", expected)
    print("当前原文件 SHA-256：", actual)
    print("文本编码：", source.get("encoding", "未注明"))
    print("批注数量：", len(data["annotations"]))
    print(json.dumps(data["annotations"], ensure_ascii=False, indent=2))
    if actual != expected:
        print(
            "版本不一致：请先比较内嵌快照与当前源码，核实每个目标；"
            "不要直接套用定位或覆盖文件。",
            file=sys.stderr,
        )
        return 2
    print("版本校验通过：可结合原文、元素内容与上下文逐条定位。")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("用法：python inspect_review.py 批注副本.review.html 原始.html")
    try:
        raise SystemExit(inspect(sys.argv[1], sys.argv[2]))
    except (OSError, ValueError, KeyError, TypeError, binascii.Error) as error:
        raise SystemExit("检查失败：" + str(error))
