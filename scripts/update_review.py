"""Create completion feedback without altering the review or original source."""

import argparse
import binascii
import gzip
import json
import os
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from zipfile import BadZipFile

from inspect_review import configure_stdio, read_review, string_length


RESULTS_FORMAT = "html-review-results"
SCHEMA_VERSION = 1


def create_results(data, annotation_ids=None, status="resolved", summary="", by="agent"):
    """Create a lightweight, version-guarded result batch from a validated review."""
    if status not in ("open", "resolved"):
        raise ValueError("结果状态必须是 open 或 resolved")
    if not isinstance(summary, str) or string_length(summary) > 4000:
        raise ValueError("结果说明最多 4000 个字符")
    if not isinstance(by, str) or not by.strip() or string_length(by) > 200:
        raise ValueError("结果作者最多 200 个字符")
    annotations = data["annotations"]
    if annotation_ids is None:
        selected = [annotation for annotation in annotations if annotation["status"] == "open"]
    else:
        if len(annotation_ids) != len(set(annotation_ids)):
            raise ValueError("不能重复指定批注 ID")
        lookup = {annotation["id"]: annotation for annotation in annotations}
        unknown = [annotation_id for annotation_id in annotation_ids if annotation_id not in lookup]
        if unknown:
            raise ValueError("找不到批注 ID：" + ", ".join(unknown))
        selected = [lookup[annotation_id] for annotation_id in annotation_ids]
    if not selected:
        raise ValueError("没有可回报的批注；请指定 ID 或核对未完成批注")
    if any(len(annotation["history"]) >= 500 for annotation in selected):
        raise ValueError("批注处理历史已达 500 条，不能追加结果")
    at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return {
        "format": RESULTS_FORMAT,
        "schemaVersion": SCHEMA_VERSION,
        "batchId": str(uuid.uuid4()),
        "results": [{
            "id": annotation["id"],
            "revision": annotation["revision"],
            "annotationUpdatedAt": annotation["updatedAt"],
            "status": status,
            "summary": summary,
            "by": by,
            "at": at,
        } for annotation in selected],
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description="生成轻量处理结果 JSON；批注副本和原文件不会被修改。")
    parser.add_argument("reviewfile", help="批注副本 HTML、gzip HTML 或轻量 JSON")
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--id", action="append", dest="annotation_ids", help="指定批注 ID，可重复使用选项")
    selection.add_argument("--pending", action="store_true", help="明确选择所有未完成批注")
    parser.add_argument("--status", choices=("resolved", "open"), default="resolved")
    parser.add_argument("--summary", default="", help="处理说明，最多 4000 个字符")
    parser.add_argument("--by", default="agent", help="处理作者，最多 200 个字符")
    parser.add_argument("--output", required=True, help="结果 JSON 路径；只能替换现有处理结果 JSON")
    args = parser.parse_args(argv)
    try:
        output = Path(args.output)
        if output.suffix.lower() != ".json":
            raise ValueError("结果文件必须使用 .json 扩展名")
        if output.resolve() == Path(args.reviewfile).resolve():
            raise ValueError("结果路径不能是批注副本")
        if output.is_symlink():
            raise ValueError("结果路径不能是符号链接")
        if output.exists():
            existing = json.loads(output.read_text(encoding="utf-8-sig"))
            if not isinstance(existing, dict) or existing.get("format") != RESULTS_FORMAT or existing.get("schemaVersion") != SCHEMA_VERSION:
                raise ValueError("只允许替换已有的 html-review-results 结果 JSON")
        data, _ = read_review(args.reviewfile)
        result = create_results(data, args.annotation_ids, args.status, args.summary, args.by)
        serialized = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
        temporary_path = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=output.parent, prefix=".review-results-", delete=False) as handle:
                temporary_path = Path(handle.name)
                handle.write(serialized)
            os.replace(temporary_path, output)
        finally:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)
        print(str(output.resolve()))
        return 0
    except (OSError, EOFError, UnicodeDecodeError, ValueError, KeyError, TypeError, binascii.Error, gzip.BadGzipFile, BadZipFile, RuntimeError, RecursionError) as error:
        print("生成结果失败：" + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    configure_stdio()
    raise SystemExit(main())
