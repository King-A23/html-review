# Windows 使用

## 直接打开，无需安装

下载 `html-review.html`，或解压完整 ZIP 后打开 `index.html`。右键选择“打开方式”，使用当前版本的 Microsoft Edge 或 Google Chrome。如果 HTML 默认关联到编辑器，请明确选择浏览器。

日常批注不需要 Node.js、Python、管理员权限或本地服务器。请使用普通浏览器窗口，隐私窗口不属于持久文件关联和本机恢复的支持范围。打开 HTML、导入文件夹、选择目标、保存与下载副本的操作与其他平台一致。页面带相对图片、样式或脚本时，选择包含入口与资源的文件夹；不要只选择一个 HTML。

Windows 使用 `Ctrl+O` 打开、`Ctrl+S` 下载副本、`Ctrl+Enter` 保存批注、`Ctrl+Z` 撤销，`Ctrl+Shift+Z` 重做。输入框使用浏览器原生文字撤销。完整快捷键可在右上角设置中查看。

agent 修改原文件后，点击“重载页面”。已通过 Edge/Chrome 的文件选择器关联源文件或目录时可直接读取最新内容；浏览器可能要求再次授权。下载的副本只带快照，首次重载需选择对应源文件或文件夹。

## PowerShell：交给 agent 与接收结果

只有辅助脚本需要 Python 3.8+。以下命令在解压包的 `html-review` 文件夹或源码仓库根部运行；路径包含空格时保留引号。使用 [Python 的 Windows 启动器](https://docs.python.org/3.12/using/windows.html#python-launcher-for-windows)时，命令为 `py -3`；如果没有启动器而 `python --version` 显示 Python 3，可将 `py -3` 换成 `python`。

```powershell
py -3 scripts/inspect_review.py "C:\Reports\经营 分析.review.json" "C:\Reports\经营 分析.html"
py -3 scripts/update_review.py "C:\Reports\经营 分析.review.json" --id "批注-ID" --status resolved --summary "已修改指定文案并核对布局。" --output "C:\Reports\经营 分析.review-results.json"
```

将 `--id` 替换成实际批注 ID。关联整个 `C:\Reports` 文件夹后，重载会读取源 HTML 旁边对应的 `.review-results.json`。只关联单个 HTML 时，请在列表点击“导入 agent 处理结果”。记录、版本保护和重复回报去重见 [结果接口](AGENT_RESULTS.md)。

脚本输出采用 UTF-8，支持中文与 emoji。批注的相对资源路径在导出中统一使用 `/`，不携带磁盘盘符或绝对路径。

## 可选：开发、测试与命令行入口

需要 Node.js 22.13+、Python 3.8+。在源码仓库或完整 ZIP 的根部运行：

```powershell
npm ci
npx playwright install chromium
npm run check
npm test
npm run test:e2e
npm run test:reload
npm run test:results
npm run release:prepare
```

测试与打包会自动查找 Python。安装多个 Python 时，可指定解释器的实际可执行路径，值中无需再嵌入引号或启动参数：

```powershell
$env:PYTHON = 'C:\Program Files\Python312\python.exe'
npm run release:prepare
```

可用 `npm link` 注册 `html-review`，再运行：

```powershell
html-review "C:\Reports\经营 分析.html"
html-review "C:\Reports\经营 分析.review.html"
html-review "C:\Reports\经营 分析.html" --no-open
```

自动打开使用 Windows 的默认 HTML/URL 关联，不经过命令 shell。命令支持中文、空格路径及正确编码的 `file:` URL；访问网络共享路径仍需操作系统已授予共享读取权限。

如果 PowerShell 提示禁止执行 `npm.ps1` 或 `html-review.ps1`，可使用对应的 `npm.cmd`、`npx.cmd`、`html-review.cmd`，无需更改系统执行策略。也可直接运行 `node bin/html-review.mjs "C:\Reports\经营 分析.html"`。

## 校验下载文件

```powershell
Get-FileHash .\html-review.html -Algorithm SHA256
Get-FileHash .\html-review-v0.1.0.zip -Algorithm SHA256
```

与 `SHA256SUMS.txt` 逐项比对。SHA-256 用于确认文件一致性，不是数字签名。
