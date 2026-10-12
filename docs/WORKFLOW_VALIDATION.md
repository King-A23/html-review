# 阅读、交接与返回的统一流程验证

2026-10-08，在本地 `codex/pdf-review` 分支完成。本轮不扩展格式、不 push、不创建 PR、不更新线上部署或 GitHub 发布资产；Windows 真机验证按用户要求继续暂缓。

## 用户能看到的变化

HTML、DOCX 和 PDF 共用一个「审阅进度与下一步」入口。打开后写意见，有草稿时先保存，保存后交给 agent；复制任务或下载交接包后提示材料已准备，仍须用户发送。普通完整工作区、gzip 和 JSON 备份不会表示任务已交付。

「agent 已返回文件」单独说明两种返回材料：修改后的文档更新预览正文，处理记录 JSON 更新状态与说明。先导入 JSON 时要求读取正文；先读取文档可以检查，随后导入记录无需重复读取。没有处理记录时，原状态保持不变。新意见对应的结果不能复用更早的正文读取；返回窗口也会提示读取本轮文档，避免显示旧的「已更新」。同一文件重新读取明确显示内容未变化。

已完成表示处理者回报，仍需核对效果；本轮没有添加另一套人工完成状态。逐条复核保持只读，原定位、revision、历史和结果协议不变。待处理位置检查收在可展开详情里，不再与第二张复核提示争夺主入口。返回 JSON 按钮采用明确边框；弹窗沿用现有展开与收起动画。使用说明按阅读、交接、返回精简，范围与限制折叠查看。

流程信息仅作为可选本机会话元数据保存，并与源文件哈希核对；不进入轻量批注协议。刷新恢复进度及草稿，旧会话没有这些字段时照常读取。结果导入的撤销与重做同步恢复流程提示；之后读取文档不会被撤销操作假装回退。完整副本清理任务全文、返回状态、位置候选和展开状态，重开后从经验证的数据重建界面。

## 浏览器与回归结果

| 检查 | 实际结果 |
| --- | --- |
| macOS Chrome 154.0.8037.98 | `test:workflow` 24 项通过，页异常及外部 HTTP(S) 请求均 0。 |
| macOS Edge 154.0.4258.62 | 同样 24 项通过，页异常及外部请求均 0。 |
| 三格式主流程 | 第一条意见、保存、两种普通备份不算交接、剪贴板失败/成功、实际交接 ZIP、下一轮、返回文件名及用途、JSON-first、导入撤销重做、变化/未变化、失败与取消保留草稿、刷新恢复均通过。 |
| 返回顺序与窄屏 | HTML document-first 后导入 JSON 无需重读；旧读取不能充当新意见对应正文。320 / 390 px 返回窗口及两个文件操作可见、无水平溢出，截图逐张检查。 |
| 真实 DOCX 回传 | 重跑此前真实 agent 返回件的 `test:roundtrip -- resume`，Chrome / Edge 通过。没有重新生成原批注或让 agent 再次修改文档。 |
| HTML 与数据 | 90 项核心、CLI、Python 与协议测试通过；`test:e2e`、`test:session`、`test:reload`、`test:results`、`test:reload-review` 通过。 |
| DOCX / PDF | `test:docx`、`test:docx-session`、`test:pdf-reading`、`test:pdf-lifecycle` 通过，包括原生 OPFS 文件 / 文件夹关联、草稿及处理记录恢复、1000 页导入和有限画布。 |
| UI 与网站 | `test:ui`、`test:motion`、`test:usability`、`test:simplification`、`test:ux-flow` 通过；本地构建网站后，原生 Chrome 的七组网站验收通过，未部署。 |

原有测试作了与界面变化对应的调整：空工作区先显示打开操作，打开文档后才检查流程引导与侧栏布局；兼容选择器按所属说明分区查找；DOCX 回报文案断言更新为「未完成说明」，原防止 HTML 注入的断言保留。没有删除定位、数据、草稿或安全断言。

PDF 生命周期最初出现一次刷新没有自动恢复、一次持久 Chrome 测试上下文意外关闭。原异步 `waitForFunction` 保存条件未可靠等待实际保存续段；改为明确等待 IndexedDB 记录、草稿、文件 handle、刷新标记及保存提示同时就绪，再刷新。全部原断言保留，随后完整生命周期通过。新流程测试最初的截图等待被暂停/无限动画阻塞，改成过滤无限动画并限制截图稳定等待；这是测试等待修正，不是产品动效跳过。

一个 `gpt-6.1-sol` agent 独立编写新浏览器验收，另一个只看截图评审首次理解：能区分两份返回材料和下一步，提出按钮外观、已完成含义及旧保存提示三项建议，本轮已据此调整。该截图评审是模拟用户理解，不是真人实验。浏览器测试使用 Playwright，兼容文件选择器或真实 OPFS handle 配合受控选择器；不能描述为 Windows 真机或本轮 computer use 全流程测试。

## 本地成果与复现

- `index.html`：当前可直接打开的开发版本，6,947,960 字节，运行时依赖仍全部内嵌。没有为本轮界面变化重新宣称导入/搜索性能提升。
- `output/playwright/workflow/`：15 张桌面及窄屏截图、`chrome-verification.json`、`edge-verification.json`。
- `output/iteration-review/修改后复核.review.html`：最新工具生成的真实返回 DOCX 工作区，六条意见（四条已完成、两条待处理），可离线继续审阅。原件、agent 实际返回件与定位完整记录见 [ROUNDTRIP_VALIDATION.md](ROUNDTRIP_VALIDATION.md)。
- [QUICKSTART.md](QUICKSTART.md)、[REFERENCE.md](REFERENCE.md)、[AGENT_RESULTS.md](AGENT_RESULTS.md)：与当前本地界面对应的说明；在线与发布下载仍为公开版本。

```sh
npm run build
npm run check
npm test
npm run test:workflow
npm run test:roundtrip -- resume
npm run test:pdf-lifecycle
npm run test:usability
```

用 `BROWSER_PATH` 指定本机 Chrome 或 Edge。`resume` 需要与同次原交接包配套的返回件；不要运行 `prepare` 改掉等待处理中的批注 ID 和 guards。测试输出保持在忽略目录，未打进公开素材。

本轮测试浏览器、Worker、临时服务及监听端口均已结束，未停止用户原有进程。`PROCESS_CLEANUP_COMPLETE`。
