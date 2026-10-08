# 交接、定位对照与 PDF 阅读优化验收

日期：2026-10-08。基于本地 `codex/pdf-review` 分支，保留 HTML / DOCX / PDF。未推送、未创建 PR、未部署，也未更新 GitHub 发布资产。Windows 真机验证按用户要求暂缓。

## 交付与实际行为

- 顶部统一为“交给 agent”，提供复制任务与下载交接 ZIP。ZIP 含字节不变的原文件、已导入 HTML 资源、轻量 JSON、任务和回报说明；轻量 JSON 不含 Base64、完整预览或全篇索引。“保存副本”作为次要入口，展开时优先完整 HTML，仍保留 gzip 和单独 JSON。
- 重载后可“查看对照”：并排显示旧定位、当前候选和上下文，并标记文字变化。多个候选必须选择后确认；图片、区域、单页需先在文档中查看。确认增加 revision，保留 targetHistory，意见仍待处理，支持撤销/重做。草稿、源文件版本或批注变化会阻止旧确认请求生效。
- PDF 提供可收起的页面缩略图、命中原文高亮和逐个上/下结果、关键词显示/修改/结束查找；同页不同命中也可区分。缩放和适应宽度保持页内阅读位置；没有文字层时提示改用区域框选。
- 取消 PDF 导入后，迟到的密码请求不再重新打开弹窗。HTML / DOCX 保存后的异步清除操作不会取消下一次新选区；主动取消或切换浏览仍使旧选区失效。

`index.html` 为最终单文件开发版（6,924,852 字节）。可直接本地打开；下面素材在忽略的 `output/ux-review/` 中，未纳入公开发布：

| 文件 | 用途 |
| --- | --- |
| `示例工作区.review.html` | 实际下载的完整 PDF 工作区，含两条意见及一次区域定位历史，可离线继续编辑。 |
| `复杂审阅.pdf`、`示例批注.review.json` | 匹配版本的原 PDF 与真实轻量导出；JSON 不含快照。 |
| `示例交接包.zip` | 实际下载的 HTML 交接包，展示新版原件、当前定位与旧定位历史。 |
| `模拟交接.review-results.json`、`blind-handoff-review.md` | 独立 agent 仅收到 ZIP 后的核对与 open 回报，明确未修改原文件。 |
| `location-comparison.png`、`handoff.png`、`pdf-reading.png` | 等待动效稳定后的实际界面截图。 |
| `chrome-verification.json`、`edge-verification.json` | 新交接与阅读流程的浏览器检查结果。 |
| `first-use-review.md` | 仅可见截图与 ZIP 的独立启发式评估，区别于运行态测试。其字号/对比度建议随后已调整。 |

## 检查结果及边界

| 检查 | 结果 |
| --- | --- |
| 核心、CLI、Python、协议、ZIP | 90 项通过，0 失败、0 跳过。覆盖原件字节/哈希、三种格式、轻量数据、历史、回报 guards、Windows 路径和 UTF-8；Windows 路径测试不代表真机测试。 |
| Chrome / Edge 新流程 | macOS Chrome 154.0.8037.98、Edge 154.0.4258.62：真实控件复制/下载、ZIP 校验、旧新差异、确认/撤销/历史、多处 DOCX 候选无默认选中、变化 PDF 区域先查看再确认、搜索/缩略图/扫描页、完整副本重开通过。记录外部 HTTP(S) 请求和页面异常均为空。 |
| 阅读与定位专项 | 逐个搜索命中、缩放/适应宽度页内锚点、缩略图收起释放；候选最多六条、旧回调防护、当前 DOCX 映射、只读候选发现不改变滚动/选区均通过。 |
| 原有功能回归 | HTML 完整流程、UI/动效/减少动态效果、DOCX 内容和 OOXML 定位/文件夹与恢复/错误导入、重载与回报生命周期、PDF 完整副本/gzip/阅读/错误处理、IndexedDB 和本地网站七组验收通过。 |
| 取消与密码 | 既有错误 suite 在内置 Chromium 和实际 Chrome 均通过：错误/正确密码、按钮/Esc/遮罩取消、加密副本再次输入、密码不导出、真实 30 秒超时、失败保留旧工作区。 |
| 独立首次使用评估 | gpt-6.1-sol 仅读取截图和 ZIP，提出关键词、后续操作说明和示例 guards 的可理解性问题；调整后复核。仅启发式模拟，没有人类用户实验，不证明所有首次使用者均能完成任务。 |
| 独立交接 | gpt-6.1-sol 仅读取最终 ZIP，校验原件哈希/唯一当前目标，区分 targetHistory 与当前 target，生成真实 guards 的 open 回报。未让其自动调用产品或宣称修改完成。 |

浏览器工程测试使用 Playwright，系统选择器部分使用可重复注入的原生 OPFS handle 或兼容 chooser；不能将其描述为 Windows 文件系统或 computer use 的产品点击实测。此前 computer use 的本机 file URL 限制仍遵守。

一次 Chrome 生命周期测试发生浏览器进程关闭；独立重复两次通过，并保存浏览器 crash/disconnect 诊断。没有把该次失败抹除或仅放宽断言。DOCX 恢复测试发现异步 IndexedDB 等待条件过早完成，已改为实际等待当前源哈希、完成回报、草稿及目录 handle 写入，全部原断言保留。

完整页画布仍限当前页与邻近页（最多三张）、每页最多 800 万像素；可见缩略图另限十二张，并在收起/销毁时释放。搜索最多保留 10,000 个导航命中，列表先显示 50 个。源文本缓存仍可能随搜索增长，未声称大型文档零内存成本；本轮未重新做全部千页性能基准，初版性能记录见 [PDF_VALIDATION.md](PDF_VALIDATION.md)。

## 本地复现

```sh
npm run build
npm run check
npm test
npm run test:ux-flow
npm run test:pdf-reading
npm run test:location-candidates
npm run test:docx-session
npm run test:pdf-errors
npm run test:motion
npm run site:build
npm run test:site
```

使用 `BROWSER_PATH` 指定本机 Chrome / Edge。网站和 release 打包仅为本地回归，不发布。测试生成素材可能改变批注 ID，独立回报须与同次运行的 ZIP 配套。

测试浏览器、worker、临时服务器和测试会话均已结束；没有保留本次任务的后台进程。`PROCESS_CLEANUP_COMPLETE`。
