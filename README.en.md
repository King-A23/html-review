# HTML Review

## Point to the problem. Give your agent the context to change it.

Open HTML, Word (DOCX) or PDF and leave feedback on text, images or regions in the preview. HTML Review preserves **the original content, target and surrounding context** for a person or coding agent. Read the returned document, check the result and continue the review.

**[Try it now →](https://king-a23.github.io/html-review/app.html?demo=1)** · **[Releases and downloads ↓](https://github.com/King-A23/html-review/releases)** · [Website](https://king-a23.github.io/html-review/)

Download the file and open it in your browser. No installation, account, server or AI configuration is required. **The interface is currently in Chinese.** Modern desktop browsers on Windows, macOS and Linux are the target; Chrome or Edge is recommended.

**v0.2.0 introduces DOCX and PDF.** See [Releases](https://github.com/King-A23/html-review/releases) for version notes, supported features and downloads; public availability is shown there.

![Review Word and PDF documents, save feedback and hand off the original files](docs/media/documents-demo.gif)

[Previous HTML workflow video](https://king-a23.github.io/html-review/media/launch.mp4) · [Sharing cover](docs/media/social-preview.png) · [中文](README.md) · [Quick start](docs/QUICKSTART.md) · [Windows guide](docs/WINDOWS.md)

## Feedback with a target

| What needs changing | How to identify it |
| --- | --- |
| A sentence | Select the text and describe the replacement. |
| An image, button or card | Click the element; select its parent container if needed. |
| One existing slide or print page | Select the page block already present in the HTML. |
| The whole document | Describe the structure or layout change and its conditions. |

Annotations retain the selected content, nearby context and DOM clues to distinguish repeated text or similar sections. After a source change, locating an annotation reports confirmed, ambiguous or missing targets so you can check the match.

## Start in three steps

1. **Open a document.** Click **打开文档** for HTML, DOCX or PDF. Use **导入文件夹** for HTML with local resources. Try the [document samples](examples/documents/README.md).
2. **Add feedback.** Select text, an element, a PDF region, a page or the whole document, then click **保存批注**. DOCX uses a continuous preview without page mode.
3. **Hand it off and check.** Click **交给 agent** to copy a task or download a handoff ZIP, then attach the materials to your agent. Use **读取返回文件** to read the edited document and import its result JSON before reviewing each change. **保存副本** saves a backup.
The tool reads the original file without overwriting it and does not call an agent automatically. Open a downloaded `.review.html` directly to continue editing. Local browser recovery helps with drafts; download a copy for long-term retention or another device.

## Save and hand off

| Export | Use |
| --- | --- |
| `.review.html` | Complete editable copy with the tool, source, imported resources and annotations. Open it directly. |
| `.review.html.gz` | Compressed complete copy. Extract before opening. |
| `.review.json` | Lightweight annotations for an agent. Provide the source and HTML resources alongside it; DOCX / PDF can restore a workspace when paired with a source matching the recorded hash. |

The handoff ZIP includes the original document, imported HTML resources, lightweight annotations and `review/TASK.md`. Saving an ordinary backup does not mark a handoff. Agents can use `scripts/inspect_review.py` to extract annotations and check the source version, then `scripts/update_review.py` to return results by annotation ID. Read the extracted data rather than placing the full copy or Base64 in the agent’s context. Reloading an associated folder also reads its matching result file; manual result import is available. Updated feedback becomes pending again, and old results cannot close newer feedback.

[Handoff prompt](AGENT_PROMPT.md) · [Result protocol](docs/AGENT_RESULTS.md) · [Data and target reference](docs/REFERENCE.md#下载的副本包含什么) — detailed guides are in Chinese.

## Supported documents and limits

The main target is **self-contained HTML**, including local relative CSS, images and scripts imported from a folder. Import trusted HTML only: page scripts can run and network resources may make requests. Choose a folder containing only the intended files; sharing the review copy shares those bundled resources too.

- DOCX supports text, paragraphs, tables and images in a reading preview. It does not reproduce Word pagination or full layout, or write native Word comments. Complex fields, text boxes and special formatting may be incomplete.
- PDF supports text, region, physical-page and whole-document feedback. Scanned pages use region selection; OCR is unavailable. Editing may require a separate editable source such as DOCX, HTML or a design file.
- Original HTML / DOCX / PDF: **20 MiB**; PDF: **1000 pages**. Folder: **50 MiB / 500 files**, with **40 MiB** per resource. Review HTML reimport: **100 MiB**.
- Server APIs, ES module dependencies, nested iframes, cross-page navigation and apps requiring the original origin may not reproduce fully. Folder import does not start a server or build a project.
- Page mode requires existing page blocks. Image text, canvas, Shadow DOM and cross-iframe content cannot be targeted like ordinary DOM text.
- Chrome and Edge can retain read-only source associations through the file picker; other browsers may ask you to select files again on reload. Local recovery depends on browser storage, keeps the latest workspace per tool address and does not provide collaborative editing.

See the [full reference](docs/REFERENCE.md) for encoding, resource handling, shortcuts, saving behavior and positioning limits.

## Documentation and examples

[Quick start](docs/QUICKSTART.md) · [Windows / PowerShell](docs/WINDOWS.md) · [Full reference](docs/REFERENCE.md) · [Verification](VERIFICATION.md) · [v0.2.0 release notes](docs/releases/v0.2.0.md) · [v0.1.0 history](docs/releases/v0.1.0.md)

New formats: [DOCX](examples/documents/review.docx) · [PDF](examples/documents/review.pdf) · [sample annotations and workflow](examples/documents/README.md). Previews: [Word](docs/docx-preview.png) · [PDF](docs/pdf-preview.png) · [recorded browser demo](docs/media/documents-demo.mp4).

HTML examples: [standalone page](examples/demo.html) · [existing pages](examples/pages.html) · [local resources](examples/with-assets/index.html) · [editable review copy](examples/demo.review.html)

Release assets are `html-review.html`, `html-review-v0.2.0.zip` and `SHA256SUMS.txt`, available from [the v0.2.0 Release](https://github.com/King-A23/html-review/releases/tag/v0.2.0) once the draft is published. You can also build from source. Each Release links to its verification and CI results; see the [publication and rollback process](docs/RELEASE_PROCESS.md).
## Development and feedback

Development requires Node.js 22.13+ and Python 3.8+; the standalone tool requires neither. Run `npm ci`, then `npm run build`, `npm run check` and `npm test`. Rebuild and commit `index.html` with source changes. Browser suites and the optional CLI are documented in the [development reference](docs/REFERENCE.md#开发与测试). The document release gate is `npm run test:documents` (17 mandatory suites); see the development reference for Python, font and Poppler dependencies. Each Release links to actual Windows / Linux, Node 22.13 / 24, Windows Edge and document CI runs.

[MIT license](LICENSE). v0.2.0 remains a public beta; the interface and data APIs may evolve. Report issues through [GitHub Issues](https://github.com/King-A23/html-review/issues) with your browser version, reproduction steps and a shareable minimal document example.

No physical Windows machine or physical phone was tested for this preparation. Narrow browser viewports are simulations, not device validation.
