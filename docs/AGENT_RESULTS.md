# Agent 处理结果接口

Windows 的 PowerShell 命令与解释器说明见 [Windows 使用](WINDOWS.md)。

接口通过本地 JSON 文件交接，无需服务、账号或 API Key。agent 修改原 HTML 和资源、原 DOCX 或原 PDF 后回传处理结果；工具按批注 ID 更新状态，原批注、目标与上下文保留作为记录。

## 意见与处理状态

每条批注包含稳定的 `id`、用户意见版本 `revision`、`status` 和 `history`。旧副本缺失这些字段时，按第 1 版、`open`、空历史读取。

| 字段 | 含义 |
| --- | --- |
| `status: "open"` | 尚未完成，需要处理或澄清。 |
| `status: "resolved"` | 已完成，仅作历史记录，下一轮不要重复执行。 |
| `revision` | 用户保存新意见为 1；再次编辑同一条意见时加 1，并回到 `open`。 |
| `updatedAt` | 用户最后保存这版意见的时间。agent 回报不改变它。 |
| `history` | 处理者、时间、结果说明及其对应的意见版本。 |

轻量导出、复制任务和静态检查器还提供派生的 `taskState`：

- `new`：新增意见，没有处理回报。
- `updated`：用户修改了此前已回报的意见，需要按新版本处理。
- `pending`：已有当前版本的回报，但仍未完成。
- `completed`：已完成记录。

每轮只执行 `status=open` 的意见。`new`、`updated` 和 `pending` 都属于待处理；未收到反馈的旧意见仍属于 `new`，这里的“新增”指尚无处理记录，不是按导出时间推测 agent 是否读过。

## 用脚本回报

先使用 `scripts/inspect_review.py` 校验收到的原文件，再理解、修改和验证目标。完成后：

```sh
python3 scripts/update_review.py report.review.json \
  --id "批注-ID" \
  --status resolved \
  --summary "已删除旧句，并检查剩余内容与布局。" \
  --output report.review-results.json
```

输入也支持 `.review.html` 和 `.review.html.gz`。脚本读取并校验批注快照，生成带版本保护的轻量结果；不会修改批注副本或原 HTML/DOCX/PDF，也不会将 Base64 输出到上下文。回报发生在修改之后，不要求当前原文件仍与修改前的哈希一致。

HTML 批注使用 schemaVersion 1；DOCX 批注使用 schemaVersion 2，PDF 批注使用 schemaVersion 3。定位协议见[DOCX 数据与定位](REFERENCE.md#docx-数据与定位)及[PDF 数据与定位](REFERENCE.md#pdf-数据与定位)。`inspect_review.read_review()` 与回报脚本均接受这三种批注。**处理结果协议继续使用 schemaVersion 1**：结果只关联批注 ID、意见版本和更新时间，不复制 DOCX / PDF 原文、OOXML / PDF 定位或文件快照。先用 `python3 scripts/inspect_review.py "报告.review.json" "报告.docx"` 核对原 ZIP 哈希及目标段落、表格或图片证据，再修改并验证 DOCX，最后使用上述回报命令。不要把原始 DOCX 的 schemaVersion 2 或 PDF 的 schemaVersion 3 填入结果 JSON。

`--id` 可重复使用，明确选择本次处理的 ID；`--pending` 明确选择全部未完成意见。仅在选中的意见均完成并验证后，才回报 `resolved`。未完成可回报 `--status open --summary "待澄清原因"`。`--by` 默认 `agent`。

同一次脚本调用选中的意见使用相同状态与说明。需要逐条回报不同状态或说明时，按下方协议生成一个包含全部结果的 JSON。不要连续覆盖同一文件而遗失尚未导入的上一批结果。

输出可以替换已有的处理结果 JSON，以便下一轮继续回报；脚本拒绝覆盖输入批注、其他 JSON、HTML、DOCX 或符号链接。

### PDF 交接与核对

PDF 轻量批注要求 `format: "html-review-annotations"`、`schemaVersion: 3`、`source.type: "pdf"`、`source.adapterVersion: "1"`。将原 PDF 与 `.review.json` 一起交给 agent，或附上工具生成的“复制修改任务”。完整 HTML / gzip 副本也可由检查器提取批注；不要把工作区代码或 Base64 快照放进上下文。

```sh
python3 scripts/inspect_review.py "报告.review.json" "报告.pdf"
python3 scripts/update_review.py "报告.review.json" \
  --id "PDF批注-ID" --status open \
  --summary "原页面内容已变化，框选目标需重新确认。" \
  --output "报告.review-results.json"
```

PDF 的 Python 检查仅确认源文件字节哈希、快照一致性与定位结构，包括页码、有限坐标、页面范围和 UTF-16 数值约束。它不解析 PDF 正文，不渲染页面，也不验证原文或重新计算页面文字/视觉指纹；检查成功不能作为“目标正文已验证”的证据。只有当前批注所需的原文快照与坐标会进入输出，不包含整份 PDF 正文、图片字节或 Base64。agent 应独立查看实际页面，校验所选原文与意见对应关系。

`target.pdf.pages[].pageNumber` 是从 1 开始的物理页码，`label` 是辅助页标签。`viewBox`、`rotation`、`userUnit` 描述页面变换；`rects` 与 `quads` 属于原始 PDF 用户空间，不能直接当作屏幕像素或已旋转页面的左上角坐标。文字片段的 `itemIndex` 及 `start/end` 属于批注时适配器文字项与 UTF-16 码元偏移，不能直接套用其他解析器的文字索引。`kind: "region"` 代表一个物理页中的框选区域；`kind: "page"` 的 `single-page` 只针对该物理页，`whole-document` 覆盖整份 PDF，后者 `pages` 为空。

`target.pdf.sourceSha256` 保存该目标创建时的源版本，可以与重载后的 `source.sha256` 不同。旧定位和 `targetHistory` 应保留为记录，本轮修改以当前 `target` 为依据。新版本中的唯一文字及上下文匹配只提供核对候选；重复文字、重复页、目标删除或页面顺序变化都可能导致歧义或缺失。区域或单页所在页面发生变化而没有唯一页面指纹匹配时，需要人工确认并重新选择，不能只沿用旧页码和坐标。无法确认、意见与选区不符，或缺少可编辑源文件时回报 `open` 并说明原因，不能把未执行的修改标成 `resolved`。

解锁密码只用于本次打开，不保存到批注、下载副本、复制任务或本机恢复记录。交接加密原 PDF 时，接收者仍须自行获得解锁方式；不要把密码添加到批注 JSON 或处理结果。完成修改后交回修改后的 PDF 与**结果协议版本 1**的 JSON；工具导入结果只更新状态，用户还需重载新 PDF 查看内容。

## 工具如何读取

已通过“导入文件夹”关联原项目时，把结果放在原 HTML、DOCX 或 PDF 旁边，文件名去掉 `.html`、`.htm`、`.xhtml` 、`.docx` 或 `.pdf` 后加 `.review-results.json`：

```text
report.html                   → report.review-results.json
slides/index.html             → slides/index.review-results.json
report.docx                   → report.review-results.json
report.pdf                    → report.review-results.json
```

用户点击“重载页面”，工具同步更新原 HTML 和资源，或重新生成原 DOCX 的内容预览、重新渲染原 PDF，并读取对应结果文件。结果文件不作为页面资源打包。仅关联单个 HTML、DOCX 或 PDF 的读取权限不包含旁边的 JSON；此时使用批注列表的“导入 agent 处理结果”，或先关联整个资源文件夹。不支持持久文件访问的浏览器可在重载时选择目录。

状态可以在列表筛选、手动完成或重新待处理，也可以撤销与重做。收到结果后需等待本机保存，或下载新副本长期保留。结果导入不会覆盖未保存草稿。

处理结果 JSON 只更新状态，不包含修改后的正文。agent 应同时交回修改后的原文档；手动导入结果后，再重载原文档查看新内容。当前版本的待处理回报会在卡片直接显示“处理反馈”摘要，完整说明仍在处理记录中；用户编辑意见后，旧反馈继续留作历史。

## JSON 协议

```json
{
  "format": "html-review-results",
  "schemaVersion": 1,
  "batchId": "唯一批次-ID-建议使用-UUID",
  "results": [
    {
      "id": "批注-ID",
      "revision": 1,
      "annotationUpdatedAt": "2026-10-06T10:00:00.000Z",
      "status": "resolved",
      "summary": "修改内容和验证结果。",
      "by": "agent",
      "at": "2026-10-06T10:15:00.000Z"
    }
  ]
}
```

`id`、`revision`、`annotationUpdatedAt` 必须逐字对应收到的批注；后者来自批注的 `updatedAt`，不是结果生成时间。状态只允许 `open` 或 `resolved`；`summary` 必须是字符串，最多 4000 个 UTF-16 码元，可为空；`by` 默认 `agent`，最多 200 个码元；`at` 可省略，由工具在首次导入时记录。时间使用 ISO 8601 UTC，批次 ID 非空、最多 200 个码元。每批最多 10000 条结果，导入文件不超过 20 MiB；每条批注最多保留 500 条处理事件。

同一批次重复读取不会追加历史，也不会把用户新编辑的意见重新关闭。不得复用同一 `batchId` 修改结果或增加/减少 ID；新回报应使用新批次。未知 ID、重复 ID、旧意见版本或冲突批次会拒绝整批状态更新，不部分套用。自动重载遇到无效结果时仍显示最新原页面，并提示处理结果未导入，原批注状态与草稿保留。

导入只接受处理状态与说明，结果文件不能修改用户意见、原文、定位、视口或源文件。`resolved` 表示回报者标记完成，不是工具对修改正确性的自动认证。

JavaScript 集成也可调用工具中的 `HRCore.applyAgentResults(data, patch)`，返回 `{data, applied, skipped}`；函数不改变传入对象，调用方须校验并保存返回的数据。离线 Python 集成可调用 `inspect_review.read_review()` 和 `update_review.create_results()`。
