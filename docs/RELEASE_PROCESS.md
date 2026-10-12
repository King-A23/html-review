# 发布与回退

当前版本为 **0.2.0 public beta**。准备完成的标准是：默认分支最终提交 CI 成功，Release 草稿目标与该提交一致，三个已上传资产与重建结果相同，Pages 已配置，Release preflight 通过。此时只需公开 Release 草稿，不再修改代码、文案、版本号或资产。

## 冻结与验收

1. 统一 `package.json`、锁文件、CHANGELOG 与版本说明。运行 `npm ci`、`npm run build`、`npm run check`、`npm test`。
2. 安装 `tests/pdf-requirements.txt`、中文 TrueType 字体及 Poppler。运行 `npm run test:documents` 和 `PDF_FIXTURE_REQUIRED=1 PDF_FIXTURE_RENDER=1 node --test tests/pdf-fixtures.test.mjs`，缺失工具不能跳过门禁。
3. 运行 `npm run site:build`、`npm run test:release`、`npm run test:site`。检查真实旧工作区升级、三种格式、交接原文、HTML/gzip 离线副本和下载资产。ZIP 解压至独立目录，再执行 `npm ci`、`npm run check`、`npm test`。
4. 合并已验收 PR 到默认分支。等待合并提交的完整 CI 成功；仅有 PR 分支的绿色检查不够。新版 Website workflow 必须已进入默认分支。
5. 从最终默认分支提交生成三个资产：`html-review.html`、`html-review-v0.2.0.zip`、`SHA256SUMS.txt`。草稿 target 使用该提交的完整 SHA；文案采用可直接公开的版本说明，草稿状态由 GitHub 标记。

本机验收和已知依赖风险见 [RELEASE_VALIDATION.md](RELEASE_VALIDATION.md)。不要在冻结后混入其他改动；若默认分支或资产变化，应重新完成相应检查。

## 发布前预检

仓库 Pages 使用 GitHub Actions 构建，变量 `PAGES_ENABLED=true`。这些设置只准备发布入口；普通 main 推送和预检不部署官网。

在默认分支执行 **Release preflight** workflow，`release_tag` 填写 `v0.2.0`。它重建官网和下载文件，运行与正式 Website workflow 相同的 `scripts/verify_release.mjs`，要求：

- 草稿 target 为当前默认分支提交，版本匹配；若 tag 已存在，它也必须解析到该提交。
- 该精确 SHA 有成功的默认分支 push CI。
- 三个资产上传完整，名称、字节数、摘要与本次重建结果完全一致，SHA256SUMS 内容正确。
- Pages 为 Actions 构建，发布开关已开启。

预检不会公开 Release 或部署网站。报告保存在 Actions 的 `release-preflight` artifact。也可在干净的默认分支 checkout 中运行 `npm run release:verify -- v0.2.0`，本机版本只验证发布内容，Pages 配置由 workflow 验证。

## 直接发布

在 GitHub 打开已经通过预检的 `v0.2.0` Release 草稿，点击 **Publish release**。保留草稿的目标提交、文案和三个资产。无需先合并、改版本号、改文案或重新打包。

公开事件自动触发 Website workflow。它检出 Release tag，要求成功的主分支 CI，并再次比较资产；验证通过后部署 Pages。发布者通过网页或 `gh release edit v0.2.0 --draft=false` 公开均可触发；不要用仓库 `GITHUB_TOKEN` 创建公开事件来替代人工发布，以免 GitHub 的事件递归保护阻止后续 workflow。

部署完成后访问官网、在线应用和三个下载入口，核对 `version.json` 的版本、单文件字节数及 SHA-256，导入 DOCX/PDF 示例并将导出的副本离线重开。首次公开前无法验证真实公开下载 URL；这些是发布后的冒烟检查。

## 回退

保留上一份已公开、已验收的源码、资产与校验值。Website workflow 支持手动输入已公开的 `release_tag`，重新部署原版本；它仍要求对应提交的主分支 CI 成功及资产一致。v0.1.0 的远端 Release 仍是草稿，不能把它当作已有线上回退点。

若发布或部署检查失败，停止开放新版本，不覆盖历史资产。修复应使用新提交和新候选；已经公开的版本号不复用来静默替换不同内容。记录失败原因、影响范围、恢复版本和复核结果。
