# HTML Review

[中文](README.md) · [Quick start (中文)](docs/QUICKSTART.md) · [Windows guide (中文)](docs/WINDOWS.md) · [v0.1.0 release notes](docs/releases/v0.1.0.md)

Review a rendered HTML page, attach specific feedback to text, elements, an existing page or the whole document, and hand it to a person or coding agent. Reload updated source files and import completion results to continue the review.

**Download one HTML file and open it in your browser.** No installation, server, account or AI configuration is required. The interface is currently in Chinese; button labels below match the interface. HTML Review works independently of any agent, AI service or frontend framework.

## Download and start

**v0.1.0 is the first public beta.** Select a version in [Releases](https://github.com/King-A23/html-review/releases); the files below belong to v0.1.0.

| File | Use |
| --- | --- |
| [html-review.html](https://github.com/King-A23/html-review/releases/download/v0.1.0/html-review.html) | Standalone tool. Download and open it directly. |
| [html-review-v0.1.0.zip](https://github.com/King-A23/html-review/releases/download/v0.1.0/html-review-v0.1.0.zip) | Offline bundle with the tool, examples, agent handoff scripts and documentation. Scripts require Python 3. |
| [SHA256SUMS.txt](https://github.com/King-A23/html-review/releases/download/v0.1.0/SHA256SUMS.txt) | SHA-256 checksums for the assets above. |

1. Open `html-review.html` in a modern desktop browser. Chrome or Edge is recommended for the file-access workflow. Alternatively, download or clone the source and open the root `index.html`.
2. Click **体验一份审阅示例** to try the built-in example, or **打开 HTML** to select a local file. Use **导入文件夹** when the page has relative CSS, images or scripts.
3. Choose **文字** (text), **元素** (element), **单页** (existing page/slide) or **整体** (whole document). Select the target, write feedback and click **保存批注**. Whole-document feedback needs no selection.
4. Click **下载批注副本** to save an editable review copy. Use **复制修改任务** to prepare an agent task and provide the original HTML and its resources alongside it.

The original file is read-only to the tool. A downloaded `.review.html` can be opened directly to continue editing. Local browser recovery is useful for drafts; download a copy for long-term retention or use on another device.

![Rendered HTML with annotations](docs/preview.png)

## Review and return results

The tool records feedback with the selected text or element, DOM clues, surrounding context and the preview viewport. It can report ambiguous or missing targets after source changes; review the context before editing source code.

To read the latest HTML and local resources, click **重载页面** (reload page). Chrome and Edge can retain a read-only file or directory association after selection. A downloaded copy or dragged file contains a snapshot; its first reload asks you to select the original file or folder. Browsers without persistent file access ask again on each reload. Saved annotations, drafts, the current mode and undo history are retained. The tool never writes source files.

Agents should inspect a review file before editing:

```sh
python3 scripts/inspect_review.py report.review.json report.html
```

The inspector also accepts `.review.html` and `.review.html.gz`, checks source versions and extracts annotation data without putting the full embedded HTML or Base64 in the agent's context. Provide the original HTML and resources with a lightweight JSON review. See the reusable handoff prompt in [AGENT_PROMPT.md](AGENT_PROMPT.md) (Chinese).

After making and verifying a change, an agent can create a result file:

```sh
python3 scripts/update_review.py report.review.json \
  --id "annotation-ID" \
  --status resolved \
  --summary "Updated the requested text and checked the layout." \
  --output report.review-results.json
```

When the original directory is associated, **重载页面** also reads the matching result JSON beside the HTML. A single-file association does not grant access to a neighboring result file; use **导入 agent 处理结果** to import it manually. Results update status and history while retaining the original feedback and target. Old revisions cannot close newer feedback, and repeated batches do not duplicate history. Completion is reported by the sender and should be checked against the actual change. See [the result protocol](docs/AGENT_RESULTS.md) (Chinese).

![Annotation status and notes after importing agent results](docs/agent-feedback.png)

## Saving and local recovery

| Export | Contents | How to use |
| --- | --- | --- |
| `.review.html` | Editor, source/resource snapshots and annotations | Open directly to continue editing. |
| `.review.html.gz` | Gzip-compressed complete HTML copy | Extract before opening; the inspector can read it directly. |
| `.review.json` | Metadata, source/resource hashes and full annotations | Provide alongside the source and resources. It cannot restore an editable workspace by itself. |

IndexedDB stores the latest workspace for each tool address, including drafts and layout preferences. Refreshing the same tab restores it after a successful save; opening the address again offers recovery. Browser data cleanup, private browsing, permissions or quota can prevent recovery. Concurrent tabs share the latest workspace at that address; download separate copies to preserve parallel reviews. Undo/redo history covers the latest 50 operations and does not survive refresh.

## Supported pages and limits

Self-contained HTML is the primary target. Folder import bundles local resources and rewrites ordinary `src`, `href`, CSS `url()` and `@import` paths. Choose a directory containing only the intended page and resources; bundled files are shared with the review copy. Resources outside that directory are not read automatically.

| Input | Limit |
| --- | --- |
| Original HTML | 20 MiB |
| Folder | 50 MiB total, 500 files; entry HTML 20 MiB, individual resource 40 MiB |
| Review HTML reimport | 100 MiB total; original source snapshot remains limited to 20 MiB |

1 MiB is 1,048,576 bytes. Base64 and the editor increase the exported file size. Text decoding uses the BOM or declared charset, falling back to UTF-8; source hashes always refer to the original bytes.

- Import trusted HTML only. Page scripts run in a sandboxed iframe, and pages or resources can still make network requests. The tool is not a malicious-file analysis environment.
- Network resources require network access. Dynamic URLs, `fetch`/XHR, ES module dependencies, nested iframes, server routes and applications requiring the original origin are outside the reliable scope of this beta. Folder import does not start a development server or build the project.
- Existing page/slide structures are recognized; a continuous page is not automatically paginated. Use element or whole-document feedback instead.
- Shadow DOM, canvas text, image text and cross-iframe content cannot be targeted like ordinary DOM text. Use an outer element or describe the whole-document change.
- Runtime DOM changes, fonts, timing and responsive layout can affect positioning. The copy retains source bytes and feedback, not a recording of runtime state.
- Browser file policies and enterprise settings can affect import, download and reload. CSP and refresh meta tags are removed for the preview with a warning; original bytes are retained. Forms, login, storage and cross-page navigation are constrained by the sandbox.
- Local recovery depends on browser storage. There is no collaborative editing. Hashes identify versions and snapshot consistency; they are not digital signatures.

The [Chinese README](README.md) contains the full data schema, target semantics and limitations.

## Development

Use Node.js 20+ and Python 3.8+. The standalone tool needs neither. Install the locked development dependencies, then build and test:

```sh
npm ci
npm run build
npm run check
npm test
npx playwright install chromium
npm run test:bridge
npm run test:session
npm run test:e2e
npm run test:usability
npm run test:ui
npm run test:motion
npm run test:reload
npm run test:results
```

Commit `index.html` with source changes after rebuilding. GitHub Actions checks generated output and runs the Node and browser suites on Windows and Linux with Node 20 and 24; Windows also runs workflow checks in Microsoft Edge. On Linux, install Chromium system dependencies with `npx playwright install --with-deps chromium`.

Tests use installed Playwright and its Chromium by default. Override `BROWSER_PATH` with a browser executable, or `PLAYWRIGHT_MODULE_PATH` with an absolute Playwright directory or its `index.mjs`. The session suite also accepts `.js` entries and `file:` URLs. Most suites open local files; reload/results tests create and close a temporary local server.

For optional command-line opening, run `npm link` in the source repository after `npm ci`:

```sh
html-review
html-review "./report.html"
html-review "./report.review.html"
html-review "./report.html" --no-open
```

The command creates a review copy without overwriting an existing file. It does not automatically bundle external resources; use folder import for those. macOS opens Google Chrome by default; Windows and Linux use the default browser. Download the review copy after annotating to retain changes.

## License and feedback

[MIT](LICENSE). v0.1.0 is a public beta; supported behavior, interface and data APIs may evolve. Report reproducible problems through [GitHub Issues](https://github.com/King-A23/html-review/issues), including browser version and a shareable minimal HTML example.
