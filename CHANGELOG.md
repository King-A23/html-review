# Changelog

本文件记录面向使用者的版本变化。实际发布状态以 [Releases](https://github.com/King-A23/html-review/releases) 为准。

## v0.1.0 — Public beta

首次版本提供本地 HTML 审阅与 agent 修改交接闭环：

- 单文件工具，浏览器直接打开；独立于 agent、AI 服务和前端框架，界面目前为中文。
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
