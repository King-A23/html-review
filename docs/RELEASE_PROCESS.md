# 发布与回退

当前准备版本为 **0.2.0 public beta**。发布准备、Release 草稿和公开发布是三个不同阶段；下面的公开操作仅在决定正式发布时执行。v0.1.0 的远端 Release 仍为草稿，不能作为公开下载或回退已上线的证明。

## 冻结与验收候选

1. 在候选提交中统一 `package.json`、锁文件、CHANGELOG 与 `docs/releases/v版本.md`。运行 `npm ci`、`npm run build`、`npm run check`、`npm test`。
2. 安装 `tests/pdf-requirements.txt`、中文 TrueType 字体和 Poppler；运行 `npm run test:documents`，再运行 `PDF_FIXTURE_REQUIRED=1 PDF_FIXTURE_RENDER=1 node --test tests/pdf-fixtures.test.mjs`。这两项不能在缺失测试工具时跳过。
3. 运行 `npm run site:build`、`npm run test:release`、`npm run test:site`。候选专项实际使用 `dist/html-review.html` 与 ZIP 解压的应用，检查旧版恢复、三种格式、交接原文与离线完整副本。
4. 解压 ZIP 到独立目录，运行 `npm ci`、`npm run check`、`npm test`，确认发布包中的工具、说明、素材和测试依赖齐全。示例 DOCX/PDF 的独立渲染和浏览器截图应与实际示范批注配套。
5. 提交完整候选，再等待该提交的 GitHub CI 全部通过。把验收记录、CI run 和提交 SHA 一起保留。当前本机记录见 [RELEASE_VALIDATION.md](RELEASE_VALIDATION.md)。不要用较早提交的绿色结果批准后续候选。

## 准备 Release 草稿

在冻结的候选提交上运行 `npm run release:prepare`。三个资产均从该次构建取得：`html-review.html`、`html-review-v0.2.0.zip`、`SHA256SUMS.txt`。使用 SHA256SUMS 校验，单文件内的 `html-review-version` 元数据应为 `0.2.0`。

创建 `v0.2.0` Release 草稿，target 指向通过 CI 的候选提交，附上上述三个文件。发布文案以 `docs/releases/v0.2.0.md` 的用户变化和限制为基础；实际公开时才将“尚未发布”的准备状态改成发布通知。若文案变更进入源码，必须重新冻结、验收和打包该提交，不能混用旧资产。

草稿不代表公开发布，也不自动部署官网。不要覆盖 v0.1.0 的历史资产。正式开放前，检查 README 下载入口、格式说明、示例、校验值和反馈入口。

## 公开与官网部署

先将候选 PR 合入默认分支，确保新版 Website workflow 已在默认分支生效。合并若产生不同提交 SHA，必须等待该提交 CI 成功，再从该提交重建、核对三个资产并更新 Release 草稿 target；不要仅用 PR 分支提交的绿色检查替代合并提交验收。

1. 发布已经验收的 `v0.2.0` Release。随后 Website workflow 在 `release.published` 事件上检出该 tag，要求对应提交有成功 CI，并逐字节核对 Release 三个资产与重建结果。
2. 管理员需在仓库启用 GitHub Pages 的 Actions 构建，设置仓库变量 `PAGES_ENABLED=true`。本次发布准备不自行修改仓库开关。只有开关启用且验证通过，才会部署。
3. `main` 普通推送不再自动公开候选。PR 仅做网站构建与浏览器检查；需要重新部署时，手动运行 Website workflow 并填写**已公开**的 `release_tag`。
4. 实际访问官网、在线应用和三个下载入口。核对 `version.json` 的版本、单文件字节数及 SHA-256；在线导入公开 DOCX/PDF 示例，再下载副本离线重开。

## 回退

保留上一份经过验收的源码、资产和校验文件。若上一版本已经公开，可手动运行 Website workflow，选择其 Release tag，重新部署同一版本；该 tag 对应的 CI 必须成功，资产必须与源码重建一致。不能选择未公开草稿作为已有线上版本。

若候选或线上验证失败，先停止开放新版本，不覆盖旧资产。修复使用新候选提交；已经公开的版本号不复用来静默替换不同内容。记录失败原因、受影响版本、实际恢复版本和验证结果。
