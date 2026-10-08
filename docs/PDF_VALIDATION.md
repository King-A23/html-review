# PDF 本地开发版验收记录

> 本记录对应 PDF 初版验收。`output/pdf-review/` 测试素材可能被后续回归重新生成，不应将不同运行生成的批注 ID 与旧回传结果混用。后续交接、定位对照及阅读体验验收见 [UX_VALIDATION.md](UX_VALIDATION.md)。

验收日期：2026-10-08。开发分支：`codex/pdf-review`，从 DOCX 开发版本 `e47eaff` 建立。此次只在本机开发、构建和验收，没有推送、创建 PR、部署或修改线上发布资产。

## 本地交付

- `index.html`：可双击打开的开发版，保留 HTML、DOCX；新增 PDF 原页预览和文字、区域、单页、整体批注。
- `output/pdf-review/复杂审阅.pdf`：五页复杂测试原件；`demo.review.json`：真实保存的四种范围批注。
- `output/pdf-review/demo.review.html`、`demo.review.html.gz`：从实际下载流程生成的完整离线工作区，保留一份原 PDF 快照。
- `output/pdf-review/agent-task.txt`：真实复制任务；`复杂审阅.review-results.json`：独立交接 agent 的回传结果，四条均保留待处理，因为未提供可编辑源文件、图表真实单位及术语标准，不能把核对定位当作完成修改。
- `output/pdf-review/comparison.html`：逐页并排比较 macOS 预览、工具完整画布和 Poppler；各截图可点开查看原尺寸。
- 自动化验证的机器可读记录位于同一目录。交付产物被 Git 忽略，可按测试脚本重新生成。

## 功能与协议

PDF.js 固定为 6.4.299；库、经典 Worker、字体、CMap、WASM、ICC 与许可证全部嵌入单文件。开发与命令行最低 Node 版本为 22.13，本机实际使用 Node 24.16.0。直接打开工具不需要 Node、Word、网络或服务器。

PDF 使用版本 3，HTML 版本 1、DOCX 版本 2 保持兼容。原始字节与派生预览分开保存；轻量 JSON 不包含 Base64、页面画面、全文或全篇定位索引。文字范围记录精确原文、上下文、UTF-16 文字项范围及原始 PDF 坐标，页码从 1 开始，保留裁剪边界、旋转与 UserUnit。区域和单页记录页面指纹，重载不覆盖原定位或完成历史。唯一匹配才显示恢复位置，重复页/重复目标返回歧义，文字删除返回缺失，区域画面变化要求人工确认。

加密文件可输入密码，错误可重试、可取消；密码等待不计入导入的 30 秒预算。密码不写入自动保存、导出或任务文本，重新打开仍需输入。原页原生表单已有外观及值显示为只读；原生批注不成为工具任务。没有 appearance stream 的文字便笺使用阅读器生成的只读标记，不同阅读器的图标外观可能不同。

## 验证范围与结果

| 验证 | 结果与实际范围 |
| --- | --- |
| 核心、CLI、Python、协议与定位测试 | 84 项通过，0 失败、0 跳过；覆盖三种数据版本、PDF 坐标/UTF-16、历史、哈希、恶意结构、Windows 驱动器及 UNC 路径、中文名称和 UTF-8 输出。Python 检查器明确只校验 PDF 哈希与定位结构，未解析 PDF 正文时不声称原文匹配。 |
| Chrome / Edge 完整 PDF 流程 | macOS Chrome 154.0.8037.98、Edge 154.0.4258.62 实际运行：四种范围、缩放定位、轻量配对、复制任务、结果回传、插入/重复页、新版文字删除、区域/扫描页变化、完整副本重开通过；请求记录无外部网络请求，页面异常为空。 |
| 导入与错误处理 | 错/对密码、密码取消（按钮、Esc、点击遮罩）、加密副本再次输入、伪装格式、损坏、20 MiB 超限、1001 页超限、真实 30 秒超时、取消、哈希不一致配对均检查；失败保留已有批注和草稿。实际跨样式和跨相邻页 DOM 文字选区通过。 |
| 生命周期与阅读 | 搜索、目录、内部链接、区域点击取消、刷新草稿恢复、关联原文件及文件夹重载、结果读取通过。原生文件句柄使用 Chrome OPFS，选择器界面由测试返回句柄；不是系统文件选择窗口的手动操作验收。 |
| 独立逐页对照 | 五页在 macOS 预览中用 computer use 实际打开、逐页检查；与完整工具画布和 Poppler 图像检查中英字体、双栏、表格、矢量图、PNG、扫描页、原生表单及便笺、混合尺寸、90°旋转和非零裁剪。独立 pypdf 核对文字、内容流、几何、表单/批注与链接。 |
| 独立 agent 交接 | gpt-6.1-sol 仅收到原 PDF、轻量 JSON 和任务文本，不读取产品实现。核对哈希、页数、原文、矢量图区域及旋转裁剪定位；能区分单页与整体并返回有效结果。没有复算 PDF.js 项索引和页面指纹，也没有擅自标记修改完成。 |
| 完整副本交付验证 | 实际下载 HTML/gzip，离线解压重开、继续编辑；原 PDF 与轻量批注不变，原始快照只保存一次，无派生预览缓存，无外部请求。 |
| 原有功能回归 | HTML、DOCX 完整流程以及原有 bridge、session、UI、motion、资源导入、结果回传、定位、DOCX 错误/恢复、原文件与文件夹重载、分批重载定位、易用性、静态网站和下载验收运行。多标签恢复发现的延迟就绪通知覆盖存档问题已修复，加入真实通知重放回归；原有易用性与简化流程均通过。具体命令见下方。 |

## 性能与体积

这些是本机小样本结果，不是性能承诺。首次导入指标为自动化计时，包含当前机器和浏览器环境。

| 项目 | 本机测量 |
| --- | --- |
| 单文件工具 | 6,780,765 字节，约 6.47 MiB；体积来自完整离线渲染依赖。 |
| 五页原 PDF | 54,053 字节；SHA-256 `c97c7468d121417a4c73d58a09e9af5d79c8c145040527fcd161e180584f122b`。 |
| 四条轻量 JSON | 紧凑序列化 4,280 字节；不携带原件或渲染库。 |
| 完整 HTML / gzip | 当前下载 6,855,670 / 3,166,966 字节；这是可独立重开的工具副本，交给 agent 优先使用原 PDF 加轻量 JSON。 |
| 五页导入 | Chrome 约 245 ms，Edge 约 205 ms；完整画布专项约 183 ms。 |
| 五十页复杂样本 | 重复五页复杂原件十次，约 179 ms 导入；DPR 2、200% 缩放仍保留不超过三张页面画布，每张不超过 800 万像素。 |
| 一千页样本 | 1,000 个空白 Letter 页面，约 264 ms 导入；可跳转第 500/1000 页，保留二至三张画布。不能将空白页结果推广为一千页复杂内容的性能。 |

页面画布上限是**每页** 800 万像素，并非全工具合计；高分辨率时三张画布合计可超过该值。仅缓存有限文字层数据，页面指纹按需计算；全篇新版本核对会随文档复杂度增加耗时，可查看进度并取消。

## 边界与未完成的实机验证

- 扫描件不做 OCR；扫描页用区域批注。双栏/异常文字项顺序不承诺可靠的语义阅读顺序。
- 不修改 PDF、不写回原生 PDF 批注、不填写表单。修改内容可能需要用户另行提供可编辑源文件。
- Windows 路径、启动参数和编码已经自动化检查，**没有 Windows 真机实测**；不能称已通过 Windows 端到端验收。
- computer use 的浏览器入口拒绝本机 `file://` URL，因此没有绕过策略改用其他方式操作产品页面。产品流程由真实 Chrome/Edge 的 Playwright 测试完成；computer use 用于独立 macOS PDF 阅读器逐页对照，二者分别记录。
- 本机实际 Node 为 24.16.0；22.13 是设定的最低版本，此次未在该最低版本另行运行。

## 复现

```sh
npm run build
npm run check
npm test
npm run test:pdf
npm run test:pdf-errors
npm run test:pdf-lifecycle
npm run test:pdf-visual
npm run test:pdf-copy
PDF_FIXTURE_RENDER=1 node --test tests/pdf-fixtures.test.mjs
npm run test:e2e
npm run test:bridge
npm run test:session
npm run test:ui
npm run test:motion
npm run test:usability
npm run test:simplification
npm run test:reload
npm run test:reload-review
npm run test:results
npm run test:docx
npm run test:docx-errors
npm run test:docx-location
npm run test:docx-session
npm run site:build
npm run test:site
```

浏览器可用 `BROWSER_PATH` 指定本机 Chrome 或 Edge；独立测试素材生成的可选 Python/Poppler 环境见 `PDF_DEVELOPMENT.md`。命令各自清理测试上下文和临时服务器；网站构建只是本机回归，没有部署。

## 进程收尾

本次临时服务器、测试浏览器及其 Worker 均已退出；用于独立阅读器对照的 macOS 预览文档已关闭，任务启动的预览进程随后退出。未停止用户原有服务或浏览器。最终状态：`PROCESS_CLEANUP_COMPLETE`。
