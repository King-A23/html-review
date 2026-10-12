# 参与改进 / Contributing

感谢你帮助 HTML Review 更好用。可以在 Issues 中报告问题、提出建议，或提交 Pull Request。请不要上传私人报告、密钥或包含敏感内容的批注副本；用可公开的最小 HTML / DOCX / PDF 示例复现即可。

## 本地开发

需要 Node.js 22.13+；静态检查与打包使用 Python 3.8+，完整文档回归的锁定依赖需要 Python 3.10+。工具本身不需要这些依赖，开发与检查才需要。

```sh
npm ci
npx playwright install chromium
python3 -m pip install -r tests/pdf-requirements.txt
npm run build
npm run check
npm test
```

界面与逻辑源文件在 `src/`，`index.html` 是生成的独立应用。修改源文件后运行 `npm run build`，一并提交生成结果。不要只修改生成文件。

DOCX / PDF 发布前必跑 `npm run test:documents`，集中执行 17 套文档检查；PDF 视觉测试另需 Poppler 和中文字体。浏览器可通过 `BROWSER_PATH` 指定，reading-tools 套件也支持 `BROWSER_CHANNEL`。完整依赖见[开发参考](docs/REFERENCE.md#开发与测试)。

按改动范围运行相关浏览器检查：`test:e2e`、`test:bridge`、`test:session`、`test:usability`、`test:ui`、`test:motion`、`test:reload`、`test:results`。完整命令见 [README](README.md)。CI 配置包含 Windows / Linux 与浏览器检查，并构建下载包；是否通过须查对应提交的实际运行，不能由配置推断。本次发布准备未进行 Windows 实体机或实体手机测试。

Pull Request 请说明用户遇到的问题、修改后如何操作，以及实际验证结果。涉及界面时附截图；涉及导出与 agent 协议时保持旧副本兼容，增加针对真实交接流程的验证。

## English

Issues and pull requests are welcome in Chinese or English. Include browser/OS details, reproduction steps, expected behavior, and a minimal public HTML / DOCX / PDF fixture. Keep private reports and credentials out of attachments.

Development requires Node.js 22.13+. Python 3.8+ supports inspection and packaging; the locked document test dependencies require Python 3.10+. Run `npm ci`, `npx playwright install chromium`, and `python3 -m pip install -r tests/pdf-requirements.txt`. Edit `src/`, regenerate `index.html` with `npm run build`, then run the relevant checks. Explain the user-visible change and validation in your pull request. Preserve compatibility with existing review copies and result files.
