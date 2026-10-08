# DOCX 本地开发与验证记录

验证日期：2026-10-08。开发分支：`codex/docx-review`。

本轮仅进行本地开发、构建与测试，没有推送、创建 PR、部署网站或更新 GitHub 发布资产。产品名称仍为 HTML Review。

## 使用与交接

打开根目录 `index.html`，选择“打开文档”，导入 `.docx`。预览采用连续内容排版，支持文字、元素与整体意见；HTML 的单页功能保留。DOCX 不还原 Word 原生版式，不编辑原文件，不写入 Word 原生批注。

DOCX 默认导出轻量 `.review.json`。交给 agent 时必须附上对应的原始 DOCX；或者使用“复制修改任务”，任务中已包含按格式区分的版本校验与定位说明。重新打开轻量 JSON 后，选择哈希匹配的原 DOCX 可恢复批注。版本不匹配时保留当前工作区，审阅新版应使用现有工作区的“重载”。

完整 `.review.html` 携带一份原始 DOCX 快照，可离线继续编辑；`.review.html.gz` 解压后同样可用。文件夹关联、草稿恢复、批注 ID/revision/状态/历史和 `html-review-results` 版本 1 结果接口沿用现有机制。

协议与静态检查方法见 [完整参考](REFERENCE.md#docx-数据与定位) 和 [agent 结果接口](AGENT_RESULTS.md)。

真实用户模拟与三轮独立 agent 交接的补充验收见 [DOCX 用户测试](DOCX_USER_TEST.md)。系统选择器无法使用时，设置 → 使用说明 → 支持范围与文件限制提供兼容打开、导入文件夹和重载入口；轻量配对提示也提供“兼容选择”。兼容方式不能建立持久读取关联，每次重载仍需重新选择原文件或目录。

## 本地交付

验收脚本可以重复生成下列文件（`output/docx-review/` 是本地生成目录，不随开发提交发布）：

- `review.docx`：中英文、跨样式、重复段落、列表、合并/嵌套表格、多图片、脚注/尾注、链接、修订与显式分页测试文档。
- `review.review.json`：三种范围的演示批注，不含源文件或图片快照。
- `review.review.html`：可离线继续批注的完整工作区。
- `review.agent-task.txt`：从实际保存批注生成的交接任务。
- `review.source-map.json`：验收用映射证据，不属于轻量批注协议。

桌面与窄屏截图位于 `output/playwright/docx-review-*.png`。人工检查了连续排版、表格、四种模式和窄屏编辑区；390px 窗口下工具没有横向溢出。

## 构建与复现

依赖固定为 Mammoth 1.13.0、JSZip 3.10.2、@xmldom/xmldom 0.8.15；构建工具 esbuild 0.25.12。转换代码及实际打包依赖的许可证嵌入单文件工具，运行时不访问网络，不依赖 Word 或本地服务器。

```sh
npm ci
npm run build
npm run check
npm test
npm run test:docx
npm run test:docx-location
npm run test:docx-errors
npm run test:docx-session
```

生成本地演示文件，在 macOS / Linux 终端运行：

```sh
DOCX_ARTIFACT_DIR=output/docx-review npm run test:docx
```

PowerShell 对应设置：

```powershell
$env:DOCX_ARTIFACT_DIR = 'output/docx-review'
npm run test:docx
Remove-Item Env:DOCX_ARTIFACT_DIR
```

`BROWSER_PATH` 可以指定本机 Chrome 或 Edge 可执行文件；不指定时使用 Playwright Chromium。测试文档也可独立生成：`node tests/docx-fixtures.mjs output.docx [variant]`。

## 验证结果

- 61 项 Node/Python 单元及协议测试通过，覆盖 schema 1/2、原始字节身份、轻量快照排除、CLI、中文文件名、Windows drive/UNC 路径和 UTF-8 输出，以及六种测试文档的独立结构与图片完整性检查。
- DOCX 浏览器主流程通过：导入、文字/元素/整体批注、轻量配对恢复、复制任务、结果回传、新版本重载、完整副本离线编辑。
- 对导出定位重新解析原始 OOXML，验证段落路径、脚注后 UTF-16 偏移、跨样式、跨段落、跨单元格、外层/嵌套表格、已有段落 ID 与图片关系/哈希。插入段落、移动表格、删除目标、替换图片都不复用未经核实的旧 DOM 路径；删除重复目标时返回歧义。
- 原生 OPFS 文件/目录 handle 测试通过：直接重载无需第二次选择、目录结果读取、刷新恢复批注/草稿/关联、取消和缺失源文件保留工作区、已有目录中的 JSON 配对、gzip 离线恢复与 CLI 配对工作区。
- 损坏 ZIP、加密标记、损坏 XML、DTD/外部实体、不支持扩展名、源文件超限、条目数超限、声明与实际解压超限、错误哈希均被拒绝；原工作区与草稿保留。实际输出用流式上限约束，不能仅靠伪造 ZIP 声明大小绕过限制。
- 取消和超时测试使用原生 Worker，只延迟任务投递/加速 30 秒定时器；验证 Worker terminate 和 Blob URL revoke，旧工作区保持不变。正常转换完成也终止 Worker。
- 现有 HTML、桥接、自动恢复、易用性、UI、动画、文件重载、生命周期与结果接口回归通过；本地网站构建和 7 组网站验收通过，没有在线部署。

实际浏览器：macOS Chrome 154.0.8037.98、Microsoft Edge 154.0.4258.62。两者的 DOCX 主流程、定位与错误处理均通过；Chrome 原生关联套件通过。Edge 原生关联套件曾发生一次浏览器进程 SIGTRAP 崩溃，macOS 崩溃记录指向 ThreadPoolForegroundWorker，不能据此确定根因；随后同一套件连续 6 次通过，另有 50 次独立 OPFS/IndexedDB handle 恢复通过。保留这项偶发现象，未宣称已修复浏览器崩溃。OPFS 是真实浏览器 handle，但不能替代用户手选磁盘目录权限的真机检查。

**未进行 Windows 真机验证。** Windows 路径、启动参数和编码契约的自动测试不等于 Windows Chrome/Edge 实测。

## Word 兼容性修复

2026-10-08 用户反馈测试文档无法用 Word 打开。本机复现了同一错误；此前浏览器和 Python 可以读取该测试文件，不能作为 Word 能打开的证据。

生成器修正了四处缺陷：首张 PNG 的 IDAT 校验和错误；`numbering.xml` 把 `abstractNum` 与 `num` 交错排列；脚注/尾注使用了不允许的 `w:author` 属性；空 `c:plotArea` 缺少必需图表。编号与注释规则见 [Microsoft WordprocessingML schema](https://raw.githubusercontent.com/dotnet/Open-XML-SDK/main/data/schemas/schemas_openxmlformats_org_wordprocessingml_2006_main.json)，图表规则见 [Microsoft Chart schema](https://raw.githubusercontent.com/dotnet/Open-XML-SDK/main/data/schemas/schemas_openxmlformats_org_drawingml_2006_chart.json)。仅修正图片的诊断副本仍被 Word 拒绝，不能把错误归因于图片这一项。

四项修正后的副本已由本机 Microsoft Word 16.113.1 正常打开，显示两页，标题、正文、列表和表格可读。正式 `review.docx` 已从修正后的生成器重新生成，其 ZIP 内各部件与 Word 成功打开的诊断副本逐字一致；配套 JSON、完整工作区、任务与映射同时重新生成，使用新的源文件哈希。原演示文件保留在 `output/docx-review/word-qa/original/`。

使用 bundled LibreOffice 和 `render_docx.py` 渲染正式交付文档，并检查两页 PNG。渲染器默认字体配置遗漏中文字体，已仅通过本轮 QA 的 `FONTCONFIG_FILE` 指向系统中文字体解决，没有修改文档内容或系统字体配置。脚注/尾注、显式分页和修订测试内容保留；外部图片及危险链接是故意的负面测试内容，不能据此判断完整 Word 排版还原。

新增 `tests/docx-fixtures.test.mjs` 对全部六种有效变体独立检查 ZIP/PNG CRC、图片解压数据、编号分组顺序、注释允许属性与图表必要结构。原生成器六项失败，修正后六项通过；DOCX 浏览器主流程、定位、恢复与协议回归通过。

## 已知预览边界

页眉页脚、复杂图形、嵌入对象、文本框和部分特殊格式不保证完整呈现。依赖符号字体的 `w:sym` 段落不提供精确文字定位，界面提示使用整体意见。外部图片不加载，危险链接被清理，普通外链仅由用户点击后外部打开。原生 Word 批注不转换为任务；修订预览当前正文，原始修订记录不被改写。

结构序号是当前文件版本的线索，不承诺跨版本稳定。批注保留创建目标时的源文件哈希，重载不会篡改旧定位；不能确认的目标显示缺失或歧义，交接时需核对原文与上下文。

`npm audit` 当前报告 Mammoth 的未打包命令行依赖链存在 3 项 moderate；浏览器转换包不包含该 CLI 链。本轮未通过降级固定版本或替换不可用版本来隐藏报告。

本轮测试浏览器、临时服务器与 Worker 均已关闭。既有且不属于本轮的进程未停止。

`PROCESS_CLEANUP_COMPLETE`
