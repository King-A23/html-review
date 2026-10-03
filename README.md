# HTML Review · 本地 HTML 批注

在 HTML 的渲染页面上写下“改哪里、改什么”，下载一个可以继续编辑、也方便 coding agent 读取的批注副本。

工具独立运行，不绑定任何 agent、AI 服务或前端框架。打开根目录的 **`index.html`** 即可使用，无需安装依赖、启动服务器、登录或配置数据库。优先支持普通独立 HTML 页面。

![带批注的 HTML 页面](docs/preview.png)

## 开始使用

1. 下载或克隆本仓库，双击根目录 `index.html`，用现代桌面浏览器打开。推荐先用 Chrome 或 Edge 验证完整流程。
2. 点击**体验示例**立即试用，或点击**打开 HTML**选择一个本地 `.html` 文件，例如 `examples/demo.html`。文件只会被读取，工具不会覆盖它。
3. 在渲染结果上添加批注：
   - **文字**：拖选文字，再填写修改意见。适合替换文案、修改句子或解释术语。
   - **元素**：点选图片、按钮、卡片等元素，再填写修改意见。点击**选父级容器**可向外选择整张卡片或区块，适合明确指出布局区域。
   - **整页**：直接填写意见。适合页面布局、整体配色、间距和响应式需求。
   - **浏览**：使用页面按钮和页内锚点等交互；跨页链接会被阻止并提示。添加元素批注时再切换回元素模式。
4. 填写意见后点击**保存批注**，或按 `Ctrl+Enter` / `⌘+Enter`。在批注列表中查看、定位、编辑或删除批注；编辑后点击**更新批注**。
5. 下载批注副本，例如 `demo.review.html`。原始 HTML 保持不变。
6. 双击下载的副本，或把它重新导入本工具，即可继续查看、修改批注，再下载新副本。
7. 将**批注副本和对应的原始 HTML**交给 coding agent，配合 [`AGENT_PROMPT.md`](AGENT_PROMPT.md) 中的通用提示词使用。

**批注在下载之前保存在当前页面内存中。** 刷新、关闭页面、重新导入文件前，请先下载需要保留的副本。工具不依赖浏览器本地存储来保证保存。

批注编辑器与列表位于左侧，原页面在右侧独立 iframe 中渲染，页面样式不会扩散到批注界面。右上方**视口**可选择自适应、390px、768px 或 1280px；这些是预览页面的宽度，不是整个浏览器窗口的宽度。需要复现布局意见时先设好视口，再保存批注。**重载页面**会重置原页面脚本运行状态，并保留已保存到列表的批注。

## 怎样写清楚批注

批注既保存人的修改意见，也保存文字或元素内容、定位线索及上下文。屏幕尺寸可以帮助复现布局，但屏幕坐标不是唯一的定位依据。

| 意图 | 建议方式 | 可直接采用的批注示例 |
| --- | --- | --- |
| 修改一句话 | 文字 | 将“具体的建议”改为“可执行的修改意见”，保留当前字体和强调样式。 |
| 调整一张卡片 | 元素 | 这张“协作修改”卡片的按钮与其他卡片底部对齐，卡片标题保持不变。 |
| 修改图片 | 元素 | 将这张流程插图的圆角改成 16px，宽度继续跟随容器。 |
| 调整整体布局 | 整页 | 桌面宽度下保持三列卡片；窄于 720px 时改成一列，每张卡片间距 16px。 |
| 同一句话出现多次 | 文字或元素 | 修改第三张卡片里的“了解详情”为“开始协作”，其他卡片不变。 |

尽量写出**目标、动作和希望保留的效果**。对于宽度、间距、顺序、颜色等布局反馈，写明条件和预期值会比“这里不太好看”更有效。整页批注应明确提到区域，例如“顶部导航”和“页脚”，不要只写“这里”。

文字批注记录选中文字、前后文及 DOM 定位线索；元素批注记录元素内容与定位信息；整页批注记录页面和视口上下文。页面变化导致定位线索失效或有歧义时，应结合原文与上下文核查，不要把自动定位当作源代码修改指令。

点击**定位**后，列表会显示原文核对成功、通过上下文重新定位、存在多个候选或无法确认目标等状态；有歧义或缺失时不会静默选中一个替代目标。**查看数据**可以检查 JSON 摘要，其中省略了 Base64 内容；完整字节快照在下载副本的数据块中。

## 带相对资源的页面

独立 HTML 中内嵌的 CSS、JavaScript、SVG 和 `data:` 图片适合直接导入。

如果 HTML 引用了本地 CSS、JavaScript 或图片，使用**导入文件夹**，选择同时包含 HTML 及其资源的目录，再选择入口 HTML。例如选择 `examples/with-assets`，入口为 `index.html`。

```text
with-assets/
  index.html
  styles/
    main.css
    palette.css
  scripts/
    interactions.js
  images/
    landscape.svg
    dots.svg
```

导入文件夹会将所选目录中的文件收进批注副本，并为预览重写普通 `src`、`href` 以及 CSS `url()`、`@import` 中的相对路径。请选择只包含本页面所需文件的目录；分享副本时，已收录的资源也会一并分享。

浏览器通过文件选择器授权读取文件，不能仅凭一个本地 HTML 的路径访问旁边的整个磁盘目录。只导入 HTML 文件时，其相对资源可能缺失。选择的目录需要覆盖资源路径；`../` 指向所选目录之外的文件不会被自动读入。

HTML 的解码会参考 BOM 或 `meta charset`，未声明时按 UTF-8 处理。浏览器不支持的编码或与声明不符的内容会提示错误；此时建议先另存为 UTF-8。无论预览采用何种文本编码，源文件快照与 SHA-256 均以原始字节为准。

界面的导入限制如下，`MiB` 表示 1,048,576 字节：

| 输入 | 上限 |
| --- | --- |
| 原始 HTML | 20 MiB。 |
| 整个文件夹 | 合计 50 MiB、最多 500 个文件；其中入口 HTML 仍限 20 MiB，单个资源限 40 MiB。 |
| 已下载的批注副本 | 整个 `.review.html` 文件可重新导入的上限为 100 MiB；其中原文件快照仍限 20 MiB。 |

Base64 和批注界面会让副本比原文件与资源的合计体积更大，原始 HTML 的 20 MiB 限制不能用于判断批注副本是否可重新导入。

外部网络资源仍依赖网络可达性。程序运行时拼接的 URL、`fetch()`/XHR、ES modules 的模块依赖、跨页面跳转、嵌套 iframe、服务器路由及必须同源运行的应用，不属于首版可靠支持范围。文件夹导入不等于运行开发服务器，也不会执行构建步骤。

## 下载的副本包含什么

批注副本是一份自包含的**批注工作区 HTML**：它携带批注界面、原页面字节、已导入的本地资源和批注数据。原页面在隔离预览中渲染，副本不是把工具栏直接插进原文件后覆盖保存。

结构化数据内嵌在副本的一个 JSON 数据块中：

```html
<script type="application/json" id="html-review-data">
  …
</script>
```

主要字段如下：

| 字段 | 说明 |
| --- | --- |
| `format` | 固定为 `html-review`。 |
| `schemaVersion` | 当前为 `1`。读取器应检查版本。 |
| `source.name`、`source.path` | 原文件名称和相对所选目录根部的路径（使用 `/` 分隔，不包含所选文件夹名称或磁盘绝对路径），用于区分文件。 |
| `source.byteLength`、`source.lastModified` | 原文件字节数，以及文件选择器提供的最后修改时间（Unix 毫秒；未知时为 `null`）等版本线索。 |
| `source.sha256` | **原始文件字节**的 SHA-256，用于校验 agent 拿到的原文件是否为批注时的版本。不是整个批注副本的哈希。 |
| `source.encoding` | 渲染原文件所用的文本编码。 |
| `source.base64` | 原始文件字节的 Base64 表示，保留批注创建时的源文件快照。 |
| `resources` | 已导入资源列表，每项包含 `path`、`mime`、`base64`、`sha256`。 |
| `annotations` | 批注列表。 |
| `annotations[].id` | 批注唯一标识，用于反馈修改结果。 |
| `annotations[].kind` | `text`（文字）、`element`（元素）或 `page`（整页）。 |
| `annotations[].comment` | 用户填写的修改意见。 |
| `annotations[].createdAt`、`updatedAt` | 创建和最后修改时间。 |
| `annotations[].target` | 相应类型的定位、原文、元素和上下文数据。读取时应检查实际字段。 |
| `annotations[].view` | 保存该批注时的预览视口 `width`、`height` 和 `devicePixelRatio`。 |

文字和元素目标的主要定位字段包括：

| `target` 内的字段 | 含义 |
| --- | --- |
| `selector`、`domPath` | 元素 CSS 选择器，以及从 `document.documentElement` 开始的索引数组路径。`domPath` 每一级遍历元素子节点并排除工具拥有的节点。 |
| `tag`、`id`、`classes`、`attributes` | 元素标签、标识、类名以及 `alt`、`src`、`href` 等辅助属性。资源属性会尽量保留原相对路径供 agent 核对。 |
| `text` | 文字批注中为选中文字的精确快照；元素批注中为规范化空白后元素文本的前 1,600 个 UTF-16 码元。 |
| `quote.exact`、`quote.prefix`、`quote.suffix` | 文字批注中为精确原文及其在文本流中的前后文（各最多 72 个 UTF-16 码元），用于确认目标并区分重复文字。 |
| `textLength`、`textFingerprint` | 元素批注中为规范化空白后的完整元素文本长度与指纹；文字批注中这两项描述选区共同祖先元素的规范化文本，不能当作选中文字的长度或哈希。该指纹不是 `source.sha256`。 |
| `context.ancestor`、`context.siblingBefore`、`context.siblingAfter` | 祖先与相邻元素的上下文。 |
| `range.start`、`range.end` | 文字范围的起止 `path` 与 `offset`。路径从 `document.documentElement` 开始，逐级遍历含文本节点的 `childNodes` 并排除工具拥有的节点；`offset` 遵循 DOM Range 的节点内偏移。 |
| `position.start`、`position.end` | 下述文本流中的 UTF-16 偏移，不能直接当作源文件字节位置。 |
| `rect` | 批注时的元素或文字范围矩形，包含视口中的 `x/y/width/height` 和 `scrollX/scrollY`，以 CSS 像素计；用于辅助理解位置。 |

文字定位的文本流由 `body` 中合格文本节点按 DOM 顺序直接拼接而成，排除 `script`、`style`、`head`、`noscript`、`template` 及工具拥有的内容；拼接过程不压缩空白，也不根据 CSS 可见性筛选。因此这些偏移不是 HTML 源码偏移，也不是浏览器复制出的纯文本偏移。对于 emoji，UTF-16 码元数还可能与用户看到的字符数不同。

整页目标使用 `kind: "page"`、`scope: "whole-document"`、页面标题 `text`、`context.sourcePath` 和 `viewport`。复现保存批注时的布局，读取该批注的 `view`；保存时也会将整页 `target.viewport` 同步为当前视口。

原文件字节是版本比对的依据，页面运行后产生的 DOM 可能与磁盘源码不同。CSS 选择器和 DOM 路径是辅助线索，agent 还应核对选中原文、相邻内容、元素属性及源码。

## 交给 coding agent

使用 [`AGENT_PROMPT.md`](AGENT_PROMPT.md) 提供的完整提示词。最短流程是：

1. 从 `html-review-data` 中读取 JSON，确认格式及版本；不要运行副本来提取数据。
2. 解码 `source.base64` 并校验 `source.sha256`，确认内嵌快照完整。
3. 计算收到的原始 HTML 的字节哈希，与 `source.sha256` 比较。版本不一致时先报告差异并重新核对定位。
4. 按批注原文、元素内容、选择器与上下文定位源代码；定位失效或目标有歧义时说明情况，避免猜测修改。
5. 修改原始 HTML 或原项目的相应资源，逐条检查实现效果，并按批注 ID 报告结果。

如果批注要求修改外部 CSS 或 JavaScript，请同时交给 agent 对应的原项目文件。副本内的资源快照可辅助核对，但实际交付应修改原项目中的文件。

本工具不自动调用 agent，不执行自然语言修改意见，也不自动修改源文件。

## 示例与验证

- [`examples/demo.html`](examples/demo.html)：无外部依赖，包含中文、emoji、跨行内元素文字、重复文案、三列卡片、内嵌 SVG，以及可点击按钮。
- [`examples/demo.review.html`](examples/demo.review.html)：实际下载得到的可编辑批注副本，含文字、卡片区域和整页布局三类反馈，直接打开即可继续使用。
- [`examples/with-assets/index.html`](examples/with-assets/index.html)：外部 CSS、CSS `@import`、CSS 背景图片、相对路径 SVG 和外部 JavaScript，用于检查文件夹导入。

首版已经实际完成浏览器闭环验证，记录与覆盖范围见 [`VERIFICATION.md`](VERIFICATION.md)。仓库也提供 [`scripts/inspect_review.py`](scripts/inspect_review.py)，可以静态读取批注并检查原文件版本：

```sh
python scripts/inspect_review.py demo.review.html demo.html
```

可用以下步骤手动验证完整保存闭环：

1. 导入 `demo.html`，在文字模式中选中跨行内标签的“具体的建议，都让下一次修改更清楚”，保存一条文案批注。
2. 在元素模式中点击“协作修改”卡片，保存一条元素批注；再添加一条带断点、列数和间距要求的整页批注。
3. 在浏览模式中点击“试试页面交互”，确认计数会变化。
4. 下载 `demo.review.html`，关闭预览后直接打开这个下载文件，确认三条批注和原页面仍可查看。
5. 修改一条批注、删除一条、再新增一条，再次下载并重新打开，核对实际内容与数量。
6. 将副本重新导入根目录工具，核对批注；使用提示词中的提取脚本确认源文件字节哈希一致。
7. 导入 `with-assets` 文件夹，确认样式、SVG、CSS 背景图片和按钮交互，下载并重新打开检查资源仍有效。

构建和自动检查需安装 Node.js 20 或更新版本；使用成品 `index.html` 不需要 Node.js：

```sh
node scripts/build.mjs
node scripts/build.mjs --check
node --test tests/*.test.mjs
```

构建会从 `src/` 生成根目录 `index.html`。修改源代码后应重新构建，将源代码与生成的单文件产物一起提交。实际浏览器操作验证用于确认选择、下载、重新打开等行为；单元测试不能替代这个闭环。

浏览器端到端测试使用 Playwright，它只是可选的开发测试依赖。首次运行可在仓库根目录执行：

```sh
npm install --no-save playwright
npx playwright install chromium
node scripts/build.mjs
node tests/bridge.browser.mjs
node tests/e2e.mjs
```

测试通过本地 `file://` URL 打开工具和下载副本，无需启动 HTTP 服务器。已有浏览器和 Playwright 的环境可用 `BROWSER_PATH` 指定浏览器可执行文件，或用 `PLAYWRIGHT_MODULE_PATH` 指定现有 Playwright 包的绝对目录或 `.mjs` / `.js` 入口文件；未设置时按测试脚本的默认模块/浏览器选择运行。例如在 PowerShell 中：

```powershell
$env:PLAYWRIGHT_MODULE_PATH = 'C:\path\to\node_modules\playwright'
$env:BROWSER_PATH = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
node tests/e2e.mjs
```

将示例路径替换成实际安装位置；仅在使用已有测试依赖或浏览器时需要设置这些变量。

## 已知限制

- **仅导入可信 HTML。** 原页面脚本在不授予同源权限的 sandbox iframe 中运行，原页面与批注界面隔离；页面和资源仍可能发起网络请求。该隔离不是离线保证，也不是恶意文件分析环境。
- 首版面向现代桌面浏览器。文件夹选择、下载策略、`file://` 行为可能因浏览器或企业策略不同而有差异。
- 交互脚本可以继续运行，因此页面计时器、随机内容、运行时修改 DOM、延迟加载和字体加载可能影响定位。批注副本保留的是原始 HTML 字节及批注，不是浏览器运行状态的完整录像。
- Shadow DOM、canvas 内的绘图文字、跨 iframe 内容和图片中的文字无法像普通 DOM 文本一样定位。可以对外层元素或整页写出明确意见。
- 页面样式会影响实际可见内容；隐藏元素、响应式布局和不同视口可能让目标暂时不可见。整页意见应写明布局条件。
- 采用 Base64 收录资源会增加文件体积；大量图片、视频和复杂应用会让导入与下载变慢。首版没有数据库、协同编辑或自动保存。
- 工具尽量保留原页面样式和交互，但 sandbox、资源重写和浏览器本地文件策略可能影响依赖服务器或同源能力的页面。
- 为使批注桥接脚本运行并避免预览自动跳走，原页面的 CSP 和 refresh `meta` 会在预览时移除并给出提示；原文件字节快照保持原样。表单提交、登录、存储和跨页跳转也受 sandbox 限制。
- 哈希用于识别版本与检查快照一致性，不是数字签名。收到的批注仍需由人或 agent 审阅。
