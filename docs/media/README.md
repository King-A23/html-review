# HTML Review · 演示与分享素材

- [15 秒真实操作演示](https://king-a23.github.io/html-review/media/demo.mp4)：1920×1080，30 fps，静音，0.97 MB。
- [完整宣传片](https://king-a23.github.io/html-review/media/launch.mp4)：1920×1080，30 fps，62.83 秒，5.11 MB，保留原 MiniMax Gentleman 配音。
- `demo.gif`：同一演示，960×540，8 fps，循环播放，1.83 MB，适合 README。
- `social-preview.png`：1200×630，87 KB，仓库、官网和社交分享统一封面。

官网链接在对应发布版本部署后可用；完整宣传片不随离线 ZIP 分发。短演示、GIF 和封面可离线打开。

## 来源与内容

完整宣传片复用 `videos/html-review-launch/renders/html-review-landscape-v7.mp4`（该工程 README 指定的最新完整成片），仅重新编码画面以缩小传输体积。声音直接拷贝，两份 AAC 音轨 SHA-256 完全一致：`4e65496f276a591f85405c0ef2e49353b31e39cdd8df2529b2dc1527cd632b09`。原片 14.20 MB，官网版本 5.11 MB，减少约 64%。

短演示复用该工程 `assets/demo-v6/text-clean.mp4`、`assets/demo-v6/element-clean.mp4` 和 `assets/export.mp4` 的真实 Playwright 录制。画面显示实际的文字选择、输入意见并保存、点击图表元素、复制任务以及选择轻量批注导出；固定比例，无重新绘制产品 UI 或演示自动 AI 修改。演示报告中的公司和财务数据为虚构。

新剪辑、标签、封面与本地字体子集的可编辑工程在 `videos/html-review-site-demo/`；完整片工程及声音未修改。封面右侧是原录制的真实批注截图。字体授权附于新工程 `assets/fonts/OFL-NotoSansSC.txt`。此次没有新增云端配音、图片生成或其他付费请求。

## 验证

HyperFrames 检查通过：无运行、布局、动画、静态结构错误或警告，25/25 文本对比度检查通过。检查了每段操作关键帧与交接菜单，确认文字和图表批注在录屏中保存；导出后再次抽帧检查，视频时长和画面比例一致。GIF 120 帧、时长 15.01 秒（GIF 10 毫秒精度舍入）、无限循环。MP4 使用 H.264、YUV 4:2:0 和 faststart，兼容网页播放。

本次启动的 HyperFrames 预览、渲染 worker 和封面截图浏览器均已退出。`PROCESS_CLEANUP_COMPLETE`。

## 第三方素材来源与授权

工具代码采用项目 MIT 许可证；第三方音乐、音效与字体依照各自提供方的授权，不因嵌入宣传片而改为 MIT 素材。

- 背景音乐来自原工程的 HeyGen 音乐库，provider `heygen.audio.sounds`，track ID `19500e2f72894242aa057259adc18d85`。HeyGen [官方音乐库说明](https://www.heygen.com/blog/add-music-ai-video-creations)将其介绍为 royalty-free 曲目库；这里只分发合成后的宣传片，不单独提供原音乐。
- 点击音效为 HyperFrames `media-use` 的 `click-soft`。保留[包内来源原文](licenses/HyperFrames-SFX-CREDITS.md)，适用 [Pixabay Content License](https://pixabay.com/service/license-summary/)。包内音效、原工程收录与成片所用文件的 SHA-256 相同：`075e17bdac5c13662a1c9530050e0046f81d4138e00eb3bf30427a7b4404103d`。音效仅作为成片的一部分使用，不单独分发 MP3。
- 字体使用 Noto Sans SC 与 JetBrains Mono；留存 [Noto OFL](licenses/OFL-NotoSansSC.txt) 和 [JetBrains Mono OFL](licenses/OFL-JetBrainsMono.txt)。此次公开素材只有渲染后的文字画面，不包含字体软件。

来源说明与官方许可核对日期：2026-10-06。原配音、音乐与音效均保留，没有额外生成或付费调用。

## Word 和 PDF 新功能演示

- `documents-demo.mp4`：20 秒，1600×1000，30 fps，H.264 / YUV 4:2:0 / faststart，静音，约 2.03 MiB。
- `documents-demo.gif`：同一独立文档演示，640×400，6 fps，循环播放。
- `../docx-preview.png` 和 `../pdf-preview.png`：1600×1000 的真实 Chrome 工作区截图。
- 可打开的原文档和轻量批注在 `examples/documents/`，每个文档均有两条真实保存的批注，详见该目录 README。

新增片段全部取自 `scripts/capture_documents.mjs` 的真实 Chrome 录屏：DOCX 点击段落并写意见；PDF 框选表格区域、对第二页写意见；分别保存、下载轻量批注并打开交接窗口。录制没有伪造 AI 修改结果，没有重新绘制产品 UI；播放速度为原录屏的 0.75 倍，以便阅读。示例使用虚构 Harbor 复盘，无个人信息、外部链接或未授权素材。原 HTML 演示及完整宣传片保持原样。

可复现命令：先运行 `python3 scripts/create_document_examples.py`，再运行 `node scripts/capture_documents.mjs`。临时录屏和 HyperFrames 0.8.149 可编辑工程保存在 `output/playwright/release-demo/`，此目录已被 Git 忽略；在 `film/` 内运行 `npx hyperframes check` 与 `npx hyperframes render --quality delivery --output <输出路径>`。原始 WebM 已转为每秒关键帧的 H.264 素材，避免浏览器跳转时冻结；最终成片再次压缩并写入 faststart。GIF 从成片生成，没有新增声音、图片或付费调用。

验证：DOCX 经 LibreOffice、PDF 经 Poppler 各独立渲染两页并逐页检查。真实 UI 导出的 JSON 与源文件 SHA-256 一致；重新打开 JSON 并配对原文档，两条批注均能准确定位。录屏阶段无 HTTP 请求和页面错误。HyperFrames 检查通过，0 静态、运行、布局与动画问题，9 个布局样本；画面全为录屏，无新增文本对比度检查。最终视频关键帧已检查，时长与像素格式经 ffprobe 确认。本次新增预览、浏览器及渲染进程均已退出，`PROCESS_CLEANUP_COMPLETE`。
