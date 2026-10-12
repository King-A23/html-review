# Word 和 PDF 审阅示例

这是完全虚构的 Harbor 试点复盘，所有数字、计划和组织均为演示内容，无个人信息或外部链接。文件可随项目公开分发，适用项目 MIT 许可证。

| 原文档 | 轻量批注 | 已保存意见 |
| --- | --- | --- |
| [review.docx](review.docx) | [docx.review.json](docx.review.json) | 两条段落意见：明确完成率口径、补充负责人和日期 |
| [review.pdf](review.pdf) | [pdf.review.json](pdf.review.json) | 一条表格区域意见、一条第二页意见 |

先在 HTML Review 中打开相应 `.review.json`，再按提示选择同一行的原文档，即可恢复这两条批注。也可以直接打开原文档练习添加意见。DOCX 是标准 OOXML 文档，在工具中以连续内容预览；PDF 是可选择文字的两页原页文档，包含表格和条形图。

试用流程：查看原文并写意见 → 保存批注 → 点击“交给 agent” → 同时提供原文档和轻量批注 → 让 agent 返回修改文件与处理记录 → 导入处理记录并逐条复核。示例只包含审阅意见，没有伪造已经完成的修改或处理结果。修改 PDF 版式时可同时提供本目录的 DOCX 作为可编辑参考，但两份文件的布局不同，须核对修改后的 PDF。

生成源文件：`python3 scripts/create_document_examples.py`，依赖 `python-docx` 和 `reportlab`。重新生成 DOCX 后，其 ZIP 字节可能变化，应重新运行 `node scripts/capture_documents.mjs` 导出与新源文件 SHA-256 配对的批注；录屏脚本依赖仓库 Playwright 和 Chrome，可通过 `BROWSER_PATH` 指定浏览器。

验证：DOCX 经 LibreOffice 独立渲染为两页，PDF 经 Poppler 独立渲染为两页；每页均人工检查。批注由真实 Chrome UI 保存和下载，每个文件两条，运行时无外网请求或页面错误。截图见 `docs/docx-preview.png`、`docs/pdf-preview.png`；独立文档短片见 `docs/media/documents-demo.mp4`。
