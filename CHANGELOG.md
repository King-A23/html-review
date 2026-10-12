# Changelog

本文件记录面向使用者的版本变化。实际发布状态以 [Releases](https://github.com/King-A23/html-review/releases) 为准。

## v0.2.0 — 发布候选 / Unreleased

首次加入 Word（DOCX）与 PDF 审阅，沿用原文件、目标、意见和 agent 回报的闭环：

- **打开文档**统一读取 HTML / DOCX / PDF；Word 连续预览支持文字、元素和整体意见，PDF 按原页支持文字、区域、单页和整体意见，并提供目录、搜索与阅读导航。
- **交给 agent**可复制任务或下载包含原文档、HTML 资源、批注及任务说明的交接 ZIP；**保存副本**用于完整工作区、gzip 或轻量 JSON 备份。
- **读取返回文件**分别接收修改后的文档与处理结果，随后逐条复核；重载失败保留工作区和草稿，旧结果不能关闭新版本意见。
- HTML 保持 schema 1，DOCX 使用 schema 2，PDF 使用 schema 3；agent 结果保持版本 1。DOCX / PDF 轻量批注可与字节哈希匹配的原文件配对恢复。
- 增加可公开的文档示例、示范批注、预览截图和真实浏览器短录屏，以及文档功能的 17 套集中发布检查与解压包验收。
- 补齐离线包的 Python 测试文件，并统一说明开发依赖与各格式边界。

DOCX 不还原 Word 完整排版、不写回原生批注；PDF 暂无 OCR，部分修改需另附可编辑源。本次未进行 Windows 实体机或实体手机测试；跨平台 CI 的配置不能视为本次通过记录。

计划资产：`html-review.html`、`html-review-v0.2.0.zip`、`SHA256SUMS.txt`。候选详情和发布顺序见 [v0.2.0 发布说明](docs/releases/v0.2.0.md)。本节不代表已发布或官网已升级；下方为历史版本记录。

## v0.1.0 — Public beta

首次版本提供本地 HTML 审阅与 agent 修改交接闭环：

- 单文件工具，浏览器直接打开；独立于 agent、AI 服务和前端框架，界面目前为中文。
- 在线示例直达与一键单文件下载；官网、15 秒真实操作演示、完整宣传片和统一分享封面。README 首屏聚焦使用入口，完整协议独立成文。
- 文字、元素、已有单页和整体批注，包含原文、定位线索、上下文和预览视口。
- 批注定位、编辑、删除、撤销和重做；左/右批注栏、预览宽度、快捷键及减少动态效果支持。
- 文件夹导入与本地 CSS、图片、脚本快照收录。
- 可继续编辑的 HTML 副本、gzip 压缩副本和轻量批注 JSON。
- IndexedDB 本机恢复，保留工作区、批注、草稿与布局偏好。
- 只读关联源文件/目录，重载最新 HTML 与资源并保留批注和草稿。
- 复制修改任务、静态版本检查脚本，以及按批注 ID 与意见版本导入 agent 处理结果；支持状态筛选和处理历史。
- 可选 Node.js 命令行入口、锁定开发依赖、自动化测试和 GitHub Actions CI。
- Windows 使用说明、Control 快捷键、中文与特殊字符路径、PowerShell 脚本示例；跨平台 Python 发现与 UTF-8 输出，以及 Windows / Linux 的自动检查。
- MIT 许可证。

版本资产：`html-review.html`、`html-review-v0.1.0.zip`、`SHA256SUMS.txt`。下载与已知限制见 [v0.1.0 发布说明](docs/releases/v0.1.0.md)。
