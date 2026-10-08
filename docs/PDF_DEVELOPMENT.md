# Repeatable PDF review fixtures

The product uses PDF.js. Python and Poppler are optional development tools used
only to create and independently verify the fixture corpus. They are not product
runtime dependencies.

Use Python with `reportlab`, `pypdf` and `Pillow` installed:

```sh
python3 tests/helpers/pdf-fixture.py output/pdf-review/fixtures --all
node --test tests/pdf-fixtures.test.mjs
PDF_FIXTURE_RENDER=1 node --test tests/pdf-fixtures.test.mjs
```

The generator embeds Chinese glyphs from a TrueType font to avoid viewer-specific
fallbacks. It discovers macOS STHeiti, Linux AR PL UMing or Windows SimSun;
otherwise set `PDF_FIXTURE_CJK_FONT` to a Chinese `.ttf` or `.ttc` file.

On Codex desktop the JavaScript helper automatically discovers the bundled Python
and Poppler. Elsewhere set `PDF_FIXTURE_PYTHON` to the appropriate interpreter.
The test skips when the optional Python packages are absent and reports when
Poppler raster verification is unavailable. The rendering comparison is opt-in
because font discovery can be slow on some machines. No network calls or package installs
occur during fixture tests. Each subprocess exits after its operation and all
test temporary directories are removed in `finally` blocks.

The generator emits `manifest.json` with SHA-256 hashes and byte sizes. PDFs use
fixed metadata and identifiers so repeated generation with the same library
versions gives identical bytes. Library/font/rendering version differences may
change hashes. The sparse oversized rejection fixture is 64 MiB logically but
does not require writing 64 MiB of data.

| File | Intended validation |
| --- | --- |
| `base.pdf` | Five mixed-size pages: Chinese/English, styled and repeated text, lines, two columns, table, vector chart, embedded PNG, image-only scan, 90-degree rotation, nonzero crop origin, native note and form |
| `changed.pdf` | One text value changed while surrounding anchors remain |
| `inserted.pdf` | Blank 400 × 500 page inserted at index 1, later anchors shift by one page |
| `moved.pdf` | Table/chart page moved from index 2 to index 1 |
| `duplicated.pdf` | Two-column page duplicated at index 2, yielding ambiguous equal text |
| `deleted-text.pdf` | One target sentence removed |
| `chart-replacement.pdf` | Vector chart geometry changes; extracted text remains identical |
| `scan-change.pdf` | Scan pixels change; extracted page text remains empty |
| `encrypted.pdf` | Same document, password `review-secret`; wrong password must fail |
| `corrupt.pdf` | PDF header with a truncated invalid body |
| `oversized.pdf` | 64 MiB sparse byte-limit rejection fixture |
| `page-limit.pdf` | 1001 small valid blank pages, over the 1000-page cap |

Page 1 contains HTTPS and internal destination links, plus deliberately unsafe
`javascript:` and `file:` URI annotations. Tests can verify unsafe links are never
activated. Native form field `reviewer` and native `/Text` annotation verify the
review UI treats source PDF annotations separately from its own review data.

Independent checks use pypdf to assert text, images, page geometry, form/link
structure, revision ordering and password behavior. Poppler renders every base
page, compares chart and scan revisions, and verifies the encrypted document
renders identically after unlocking. Browser PDF.js tests should additionally
check text selection, review anchors, reattachment, safe link handling and export.
