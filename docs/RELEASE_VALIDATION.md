# v0.2.0 发布候选验收

日期：2026-10-12（Asia/Shanghai）。本次是发布准备；没有公开 Release 或部署官网。源码版本、单文件版本元数据和候选资产均为 `0.2.0`。

## 实际验收

本机为 macOS / Node 24.16.0，使用 Playwright 驱动 Chromium，并补充 Microsoft Edge 检查。以下均实际运行，不能等同于 Windows 实体机或手机实测。

| 检查 | 结果 |
| --- | --- |
| 构建与核心测试 | `npm run check`；93 项 Node 测试通过，无失败、无跳过。 |
| DOCX / PDF 主回归 | `npm run test:documents` 的 17 套浏览器检查通过，覆盖导入、拒绝损坏文件、定位、草稿与会话、交接、返回复核、阅读与导航。 |
| PDF 独立验证 | 强制要求 Python、中文字体及 Poppler 的结构和栅格检查通过，0 跳过；验证文字、页面几何、媒体、修订和确定性。 |
| 密码与取消 | 修复快速关闭后重开密码框可能操作上一提示框的问题；关闭时同步清空密码、释放弹窗。重复 Esc / 背景关闭、错误重试、加密副本重开、超时及密码不进入导出均有浏览器覆盖。 |
| 界面与动画 | `test:ui`、`test:motion` 通过；导航检查改为有时限地等待当前动画，避免等待已经被替换的动画 Promise。 |
| 官网候选 | `test:site` 的 9 组检查通过：响应式布局、真实媒体、下载字节与校验值、示例批注配对、在线导入和离线重开。官网构建产物仅保存在本地。 |
| 实际交付文件 | `test:release` 使用 `dist/html-review.html` 和 ZIP 解压应用：真实 v0.1.0 同地址 IndexedDB 升级保留原文、意见、完成历史与未保存草稿；DOCX / PDF 交接原文逐字节一致；JSON、HTML、gzip 导出及离线继续编辑通过。外部网络请求和浏览器错误均为 0。 |
| ZIP 独立安装 | 系统 unzip 解压到临时目录，独立 `npm ci`、`npm run check`、93 项测试通过。补齐此前遗漏的 Python 测试、文档开发说明和公开示例；ZIP 校验、可复现性及 CLI 的 Unix 可执行权限有断言。 |
| 示例与素材 | 两页 DOCX / PDF 使用虚构资料，配套真实 UI 导出的批注。独立渲染逐页检查；截图、20 秒录屏和 GIF 与当前界面一致。未声称在 Microsoft Word 中完成排版实测。 |

单文件候选：7,064,615 字节，SHA-256 `8da013454fcd72f9c3d6314871dfd3166831b545c2a431e94ffd5198e7407176`。ZIP 校验值随文档冻结变化，以同次构建的 `dist/SHA256SUMS.txt` 为准；不在 ZIP 内嵌它自己的校验值。

浏览器证据写入被忽略的 `test-results/` 与 `output/`，不混入发布包。GitHub CI 的准确状态以候选 PR 对应 SHA 的检查为准；本记录不把 CI 配置当作执行成功。CI 包含 Linux / Windows、Node 22.13 / 24、Windows Edge，以及两档 Node 的文档专项门禁。

## 依赖审计

锁定依赖的 `npm audit` 报告 **3 个 moderate、0 个 high、0 个 critical**，三项来自同一条链：`mammoth@1.13.0 → argparse@1.0.10 → sprintf-js@1.0.3`。公告 [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) 涉及不受控格式精度造成 RangeError / 拒绝服务，当前无已公布的修复版本。

产品只使用 Mammoth 库入口；argparse / sprintf-js 属于 Mammoth 的 CLI 路径，不在本项目的浏览器打包输入中，也未被本项目 CLI 调用。已核对 Mammoth 的 bin/lib 引用与 esbuild 打包输入。保留这项依赖树风险记录；没有执行会降级 Mammoth 的强制自动修复，也不将审计报告描述为零漏洞。若未来引入 Mammoth CLI，需重新评估。

## 发布前仍需由实际发布动作完成

合并后等待默认分支最终提交 CI 成功，重建并核对资产，更新 Release 草稿 target，然后公开 Release。官网部署还需要仓库管理员启用 Pages 与 `PAGES_ENABLED=true`；本次没有更改这些开关。公开后的真实 URL、下载和回退验证按 [发布与回退](RELEASE_PROCESS.md) 执行。

Windows 实体机与实体手机未验收；Chrome / Edge 自动化及窄屏模拟的证据不能替代这些实测。DOCX 非 Word 分页还原、PDF 无 OCR 等支持边界见 [版本说明](releases/v0.2.0.md)。
