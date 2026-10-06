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
