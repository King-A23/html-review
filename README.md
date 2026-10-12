# HTML Review

## 在页面上圈出问题，让 agent 知道改哪里。

打开 HTML、Word（DOCX）或 PDF，在预览中的文字、图片或区域上写下修改意见。HTML Review 将**原文、目标位置和上下文**一起交给人或 coding agent；改完后读取返回文件，核对结果，继续下一轮。

**[立即体验 →](https://king-a23.github.io/html-review/app.html?demo=1)** · **[查看发布与下载 ↓](https://github.com/King-A23/html-review/releases)** · [完整官网](https://king-a23.github.io/html-review/)

下载后用浏览器打开即可使用，无需安装、登录、启动服务器或配置 AI 服务。界面目前为中文，面向 Windows、macOS 和 Linux 的现代桌面浏览器；推荐 Chrome 或 Edge。

**v0.2.0 首次加入 DOCX / PDF。** 版本说明、支持边界和下载资产见 [Releases](https://github.com/King-A23/html-review/releases)；公开状态以 Releases 为准。

![HTML Review 的 Word 与 PDF 真实批注操作](docs/media/documents-demo.gif)

[旧版 HTML 流程演示视频](https://king-a23.github.io/html-review/media/launch.mp4) · [分享封面](docs/media/social-preview.png) · [English](README.en.md) · [快速开始](docs/QUICKSTART.md) · [Windows 使用](docs/WINDOWS.md)

## 从“这里要改”到可以执行的修改任务

| 想改什么 | 怎么指出目标 |
| --- | --- |
| 一句话 | 拖选文字，写出替换文案或修改要求。 |
| 图片、按钮、卡片 | 点选元素；需要时选中父级容器。 |
| 一页幻灯片或打印页 | 选择 HTML 已有的页区块，或 PDF 的物理页。 |
| PDF 图表、图片或扫描页 | 使用区域模式框选目标。 |
| 全文结构或布局 | 写整体意见，说明条件和预期效果。 |

批注保留选中内容、相邻上下文和定位线索，帮助区分重复文字与相似区块。源页面改变后，定位会提示目标是否确认、有歧义或缺失，便于核查。

## 三步开始

1. **打开文档。** 点击**打开文档**选择 HTML、DOCX 或 PDF；HTML 带本地资源时使用**导入文件夹**。可从[文档示例](examples/documents/README.md)体验新格式。
2. **写下意见。** 选择文字、元素、PDF 区域、单页或整体，填写意见并点击**保存批注**。DOCX 提供连续预览，无单页模式。
3. **交给 agent，再核对。** 点击**交给 agent**复制修改任务或**下载交接包**，自行附给 agent。收到返回文件后进入**读取返回文件**，读取修改后的文档并导入处理记录 JSON，再逐条复核。**保存副本**用于另存备份。
工具只读取原文件，不会覆盖它，也不会自动调用 agent。下载的 `.review.html` 可以直接打开继续编辑。本机自动保存用于恢复草稿，长期保留或跨设备使用请下载副本。

## 保存与交接

| 保存格式 | 适合什么场景 |
| --- | --- |
| `.review.html` | 完整可编辑副本，包含工具、原文档、已导入 HTML 资源和批注；直接打开继续审阅。 |
| `.review.html.gz` | 压缩后的完整副本；解压后打开。 |
| `.review.json` | 交给 agent 的轻量批注；同时提供原文档及 HTML 资源；DOCX / PDF 可与哈希匹配的原文件配对恢复。 |

**下载交接包**将原文档、HTML 资源、轻量批注和 `review/TASK.md` 一起打包；普通副本备份不算交接。agent 可用仓库中的 `scripts/inspect_review.py` 读取批注并核对原文件版本，再用 `scripts/update_review.py` 按批注 ID 回传处理结果。只读提取后的批注和元数据，避免把完整副本或 Base64 放进上下文。已关联文件夹时，重载会读取对应的结果文件；也可手动导入。意见更新后重新进入待处理，旧回报不能关闭新意见。

[交接提示词](AGENT_PROMPT.md) · [agent 结果接口](docs/AGENT_RESULTS.md) · [格式与定位字段参考](docs/REFERENCE.md#下载的副本包含什么)

## 支持范围与边界

HTML 主要面向**独立 HTML**，以及所选文件夹内带相对 CSS、图片和脚本的页面。只导入可信文件；页面脚本可以运行，网络资源仍可能联网。选择文件夹时只收录本页面需要的文件，分享副本也会分享这些资源。

- DOCX 支持文字、段落、表格和图片审阅，预览不还原 Word 分页与完整排版；不将意见写回为 Word 原生批注。复杂域、文本框、修订及特殊格式可能无法完整显示。
- PDF 保留原页显示，支持文字、区域、单页与整体批注；扫描页使用区域框选，当前无 OCR。修改可能需要另附 DOCX、HTML 或设计稿等可编辑源。
- 原始 HTML / DOCX / PDF 上限 **20 MiB**；文件夹合计 **50 MiB / 500 个文件**，HTML 单资源 **40 MiB**；PDF 最多 1000 页；批注 HTML 重新导入上限 **100 MiB**。
- 服务器接口、ES 模块依赖、嵌套 iframe、跨页跳转及需要原站点同源环境的应用，可能无法完整重现。导入文件夹不会启动服务器或构建项目。
- 单页模式需要页面已有分页结构。图片文字、canvas、Shadow DOM 和跨 iframe 内容无法像普通文字一样定位。
- Chrome、Edge 可通过文件选择器保留只读文件关联；其他浏览器重载时可能需要重新选择文件。本机恢复依赖浏览器存储，每个工具地址保留最近一个工作区，暂不支持多人协同编辑。

更多保存行为、快捷键、编码、资源处理和定位限制见[完整参考](docs/REFERENCE.md)。

## 文档与示例

[快速开始](docs/QUICKSTART.md) · [Windows / PowerShell](docs/WINDOWS.md) · [完整参考](docs/REFERENCE.md) · [验证记录](VERIFICATION.md) · [v0.2.0 候选发布说明](docs/releases/v0.2.0.md) · [v0.1.0 历史说明](docs/releases/v0.1.0.md)

新格式：[DOCX](examples/documents/review.docx) · [PDF](examples/documents/review.pdf) · [示范批注与闭环操作](examples/documents/README.md)。预览：[Word](docs/docx-preview.png) · [PDF](docs/pdf-preview.png) · [真实操作短录屏](docs/media/documents-demo.mp4)。

HTML 示例：[独立页面](examples/demo.html) · [已有分页](examples/pages.html) · [带本地资源](examples/with-assets/index.html) · [可编辑批注副本](examples/demo.review.html)

计划发布资产为 `html-review.html`、`html-review-v0.2.0.zip` 和 `SHA256SUMS.txt`。发布完成后可在 [v0.2.0](https://github.com/King-A23/html-review/releases/tag/v0.2.0) 获取；在此之前使用候选源码构建，此前 v0.1.0 Release 当前仍是草稿，不能作为已公开下载入口；历史版本与源码可用于回退。
## 开发与反馈

开发需 Node.js 22.13+、Python 3.8+；成品工具无需这些运行环境。`npm ci` 后运行 `npm run build`、`npm run check` 和 `npm test`。文档功能发布门槛为 `npm run test:documents`（17 套必跑检查），依赖安装见[开发参考](docs/REFERENCE.md#开发与测试)。浏览器测试与可选命令行入口见[开发参考](docs/REFERENCE.md#开发与测试)；Windows 操作见[专门说明](docs/WINDOWS.md)。

采用 [MIT 许可证](LICENSE)。v0.2.0 继续作为 public beta，界面和数据接口可能调整。通过 [GitHub Issues](https://github.com/King-A23/html-review/issues) 反馈问题时，请附浏览器版本、复现步骤和可公开的最小文档示例。

本次未进行 Windows 实体机或实体手机测试；浏览器窄屏模拟不等同于手机实测，CI 配置也不等同于已通过的运行记录。
