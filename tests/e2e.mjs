import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const resultDir = path.join(root, 'test-results');
await mkdir(resultDir, {recursive: true});
let modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
if (modulePath && (await stat(modulePath)).isDirectory()) modulePath = path.join(modulePath, 'index.mjs');
const {chromium} = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const checks = [];
const errors = [];
let server;
let browser;
let cleanup = false;
let exportSizes;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const appUrl = pathToFileURL(path.join(root, 'index.html')).href;
const originalPath = path.join(root, 'examples/demo.html');
const originalBytes = await readFile(originalPath);
const originalHash = digest(originalBytes);
const dataPattern = /(<script\b[^>]*\bid="html-review-data"[^>]*>)([\s\S]*?)(<\/script>)/i;
const extract = async filename => {
  const text = await readFile(filename, 'utf8');
  const match = text.match(dataPattern);
  assert(match, 'Export contains exactly identifiable JSON data block');
  return JSON.parse(match[2]);
};
async function check(name, task) {
  await task();
  checks.push(name);
  console.log(`PASS ${name}`);
}
async function frameFor(page) {
  await page.locator('#preview-frame').waitFor({state: 'visible'});
  const frame = await page.locator('#preview-frame').contentFrame();
  await page.waitForFunction(() => !document.querySelector('#open-button').disabled);
  await frame.locator('body').waitFor();
  await frame.locator('body').evaluate(() => new Promise(resolve => {
    if (document.readyState !== 'loading') resolve();
    else document.addEventListener('DOMContentLoaded', resolve, {once: true});
  }));
  await page.waitForFunction(() => !document.querySelector('#open-button').disabled);
  return frame;
}
async function waitCount(page, count) {
  await page.waitForFunction(expected => document.querySelector('#annotation-count').textContent === String(expected), count);
}
async function download(page, filename, expectedName) {
  const pending = page.waitForEvent('download');
  await page.locator('#download-button').click();
  const downloaded = await pending;
  if (expectedName) assert.equal(downloaded.suggestedFilename(), expectedName);
  const destination = path.join(resultDir, filename);
  await downloaded.saveAs(destination);
  assert.equal(await downloaded.failure(), null);
  return destination;
}
async function selectText(page, selector) {
  await page.locator('[data-mode="text"]').click();
  const frame = await frameFor(page);
  await frame.locator(selector).scrollIntoViewIfNeeded();
  await frame.locator(selector).evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    element.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
  });
  await page.locator('#target-preview').waitFor({state: 'visible'});
}
async function saveNote(page, text) {
  await page.locator('#comment-input').fill(text);
  await page.locator('#save-button').click();
}

try {
  server = await chromium.launchServer({headless: true, ...(process.env.BROWSER_PATH ? {executablePath: process.env.BROWSER_PATH} : {})});
  browser = await chromium.connect(server.wsEndpoint());
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, acceptDownloads: true});
  context.on('page', page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
  });
  const page = await context.newPage();
  await check('file:// opens standalone workbench without server or runtime dependencies', async () => {
    await page.goto(appUrl);
    assert.equal(await page.locator('#source-name').textContent(), '尚未打开页面');
    assert(await page.locator('#example-button').isVisible());
    assert(await page.locator('#download-button').isDisabled());
    await page.screenshot({path: path.join(resultDir, '01-workbench.png')});
  });
  await check('import original HTML; sandbox preserves rendering and browse-mode interaction', async () => {
    await page.locator('#file-input').setInputFiles(originalPath);
    const frame = await frameFor(page);
    await frame.locator('#hero-title').waitFor();
    assert.equal(await page.locator('#source-name').textContent(), 'demo.html');
    assert.equal(await page.locator('#preview-frame').getAttribute('sandbox'), 'allow-scripts');
    await frame.locator('#demo-button').click();
    assert.equal(await frame.locator('#demo-count').textContent(), '已点击 1 次');
    assert.equal(await frame.locator('body').evaluate(() => {try { return parent.document.body.innerHTML; } catch (_) { return 'isolated'; }}), 'isolated');
    assert.equal(await page.locator('.source-info').innerText(), '当前文档\ndemo.html');
    assert.equal(await page.locator('#preview-label').textContent(), 'demo.html');
    assert.equal(await page.locator('#source-meta, #source-version').count(), 0);
  });
  await check('whole-file feedback works directly in browse mode and after repeated saves', async () => {
    const wholeFile = await context.newPage();
    await wholeFile.goto(appUrl);
    await wholeFile.locator('#file-input').setInputFiles(originalPath);
    await frameFor(wholeFile);
    assert.equal(await wholeFile.locator('[data-mode="browse"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await wholeFile.locator('#target-text').textContent(), '整个文件 · demo.html');
    assert.match(await wholeFile.locator('#target-selector').textContent(), /^视口 [1-9]\d* × [1-9]\d*px$/);
    assert(await wholeFile.locator('#cancel-edit').isHidden());
    await saveNote(wholeFile, '整个文件统一术语，并调整章节顺序。');
    await waitCount(wholeFile, 1);
    await saveNote(wholeFile, '全篇使用统一的配色与字体。');
    await waitCount(wholeFile, 2);
    await wholeFile.locator('[data-mode="text"]').click();
    await wholeFile.locator('#comment-input').fill('调整整个文件的说明顺序。');
    assert(await wholeFile.locator('#save-button').isDisabled());
    assert(await wholeFile.locator('#target-preview').isHidden());
    await wholeFile.locator('[data-mode="whole"]').click();
    assert.equal(await wholeFile.locator('#comment-input').inputValue(), '调整整个文件的说明顺序。');
    await wholeFile.locator('#save-button').click();
    await waitCount(wholeFile, 3);
    await saveNote(wholeFile, '所有章节的标题层级保持一致。');
    await waitCount(wholeFile, 4);
    await selectText(wholeFile, '#cross-node-text');
    await wholeFile.locator('[data-mode="browse"]').click();
    assert.equal(await wholeFile.locator('#target-text').textContent(), '整个文件 · demo.html');
    await saveNote(wholeFile, '对整个文件补充导读。');
    await waitCount(wholeFile, 5);
    const wholeCopy = await download(wholeFile, 'demo.whole-file.review.html');
    const stored = await extract(wholeCopy);
    assert.equal(stored.annotations.length, 5);
    for (const annotation of stored.annotations) {
      assert.equal(annotation.kind, 'page');
      assert.equal(annotation.target.scope, 'whole-document');
      assert.equal(annotation.target.text, 'demo.html');
      assert.equal(annotation.target.context.sourcePath, 'demo.html');
      assert.equal(annotation.target.selector, undefined);
      assert.equal(annotation.target.quote, undefined);
    }
    await wholeFile.goto(pathToFileURL(wholeCopy).href);
    await frameFor(wholeFile); await waitCount(wholeFile, 5);
    await wholeFile.locator('.annotation-card').first().locator('[data-action="edit"]').click();
    assert.equal(await wholeFile.locator('[data-mode="whole"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await wholeFile.locator('#draft-status').textContent(), '');
    await wholeFile.locator('#comment-input').fill('整个文件统一术语，并合并重复章节。');
    await wholeFile.locator('#save-button').click();
    await waitCount(wholeFile, 5);
    await wholeFile.locator('.annotation-card').first().locator('[data-action="locate"]').click();
    assert.equal(await wholeFile.locator('.location-status.exact').textContent(), '整体反馈 · 适用于整个文件');
    const edited = await extract(await download(wholeFile, 'demo.whole-file-edited.review.html'));
    assert.equal(edited.annotations[0].id, stored.annotations[0].id);
    assert.equal(edited.annotations[0].comment, '整个文件统一术语，并合并重复章节。');
    assert.equal(edited.annotations[0].target.scope, 'whole-document');
    await wholeFile.close();
  });
  await check('sidebar can switch sides without losing preview, selection or draft; preference survives reopening', async () => {
    const layout = await context.newPage();
    await layout.goto(appUrl);
    const sidebar = () => layout.locator('.sidebar').boundingBox();
    const preview = () => layout.locator('.preview-section').boundingBox();
    assert((await sidebar()).x < (await preview()).x);
    await layout.locator('#file-input').setInputFiles(originalPath);
    const frame = await frameFor(layout);
    await frame.locator('#demo-button').click();
    await selectText(layout, '#cross-node-text');
    await layout.locator('#comment-input').fill('保留选中的原文，简化表达。');
    const previewWidth = (await preview()).width;
    await layout.locator('#sidebar-position').selectOption('right');
    assert((await sidebar()).x >= (await preview()).x + (await preview()).width);
    assert.equal((await preview()).width, previewWidth);
    assert.equal(await frame.locator('#demo-count').textContent(), '已点击 1 次');
    assert.equal(await layout.locator('#comment-input').inputValue(), '保留选中的原文，简化表达。');
    assert.equal(await layout.locator('#target-kind').textContent(), '文字');
    assert.equal(await layout.locator('#target-text').textContent(), '每一条具体的建议，都让下一次修改更清楚。');
    await layout.screenshot({path: path.join(resultDir, '04-right-sidebar.png')});
    await layout.locator('#save-button').click();
    const copy = await download(layout, 'demo.right-sidebar.review.html');
    assert.equal((await extract(copy)).annotations[0].kind, 'text');
    await layout.reload();
    assert.equal(await layout.locator('#sidebar-position').inputValue(), 'right');
    await layout.locator('#sidebar-position').selectOption('left');
    assert((await sidebar()).x < (await preview()).x);
    const isolated = await browser.newContext({viewport: {width: 1440, height: 1000}});
    try {
      await isolated.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', {get() { throw new Error('Storage is unavailable'); }});
      });
      const portable = await isolated.newPage();
      portable.on('pageerror', error => errors.push(error.message));
      await portable.goto(pathToFileURL(copy).href);
      await frameFor(portable); await waitCount(portable, 1);
      assert.equal(await portable.locator('#sidebar-position').inputValue(), 'right');
      await portable.locator('.annotation-card [data-action="edit"]').click();
      assert.equal(await portable.locator('#comment-input').inputValue(), '保留选中的原文，简化表达。');
      await portable.locator('#sidebar-position').selectOption('left');
      assert((await portable.locator('.sidebar').boundingBox()).x < (await portable.locator('.preview-section').boundingBox()).x);
      assert.equal(await portable.locator('#target-kind').textContent(), '文字');
      await portable.locator('#sidebar-position').selectOption('right');
      await portable.setViewportSize({width: 900, height: 900});
      assert.equal((await portable.locator('.sidebar').boundingBox()).width, 320);
      assert((await portable.locator('.sidebar').boundingBox()).x > (await portable.locator('.preview-section').boundingBox()).x);
      await portable.setViewportSize({width: 600, height: 900});
      assert((await portable.locator('.sidebar').boundingBox()).y >= (await portable.locator('.preview-section').boundingBox()).y + (await portable.locator('.preview-section').boundingBox()).height);
      assert(await portable.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await portable.screenshot({path: path.join(resultDir, '05-narrow-sidebar.png')});
    } finally { await isolated.close(); }
    await layout.close();
  });
  await check('text target can be cancelled explicitly or by clicking the preview; draft and saved annotations remain', async () => {
    const cancel = await context.newPage();
    await cancel.goto(appUrl);
    await cancel.locator('#file-input').setInputFiles(originalPath);
    const frame = await frameFor(cancel);
    await selectText(cancel, '#cross-node-text');
    await cancel.locator('#comment-input').fill('这条意见在取消选择后仍保留。');
    await cancel.locator('#clear-target').click();
    assert(await cancel.locator('#target-preview').isHidden());
    assert(await cancel.locator('#save-button').isDisabled());
    assert.equal(await cancel.locator('#comment-input').inputValue(), '这条意见在取消选择后仍保留。');
    await frame.locator('body').evaluate(() => new Promise(resolve => setTimeout(resolve, 30)));
    assert.equal(await frame.locator('body').evaluate(() => getSelection().rangeCount), 0);
    await selectText(cancel, '#cross-node-text');
    await frame.locator('#hero-title').click();
    await cancel.locator('#target-preview').waitFor({state: 'hidden'});
    assert(await cancel.locator('#save-button').isDisabled());
    assert.equal(await cancel.locator('#comment-input').inputValue(), '这条意见在取消选择后仍保留。');
    await selectText(cancel, '#cross-node-text');
    await cancel.locator('#save-button').click();
    await waitCount(cancel, 1);
    await cancel.locator('.annotation-card [data-action="edit"]').click();
    await cancel.locator('#clear-target').click();
    assert(await cancel.locator('#save-button').isDisabled());
    assert.equal(await cancel.locator('.annotation-comment').textContent(), '这条意见在取消选择后仍保留。');
    await selectText(cancel, '#cross-node-text');
    await saveNote(cancel, '重新选择后更新的意见。');
    await waitCount(cancel, 1);
    assert.equal(await cancel.locator('.annotation-comment').textContent(), '重新选择后更新的意见。');
    await cancel.close();
  });
  await check('full, gzip and lightweight exports preserve annotations while reducing stored bytes', async () => {
    const formats = await context.newPage();
    await formats.goto(appUrl);
    await formats.locator('#file-input').setInputFiles(originalPath);
    await frameFor(formats);
    const comment = '统一全文结构，保留字面量 </script><script>window.__exportXss=1</script>。';
    await saveNote(formats, comment);
    const fullPath = await download(formats, 'exports.review.html', 'demo.review.html');
    const fullBytes = await readFile(fullPath);
    const stored = await extract(fullPath);
    assert.match(fullBytes.toString('utf8'), /id="html-review-example">null<\/script>/);
    assert(!fullBytes.toString('utf8').match(dataPattern)[2].includes('\n'));
    await formats.locator('#export-format').selectOption('gzip');
    const packedPath = await download(formats, 'exports.review.html.gz', 'demo.review.html.gz');
    const packed = await readFile(packedPath);
    const unpackedPath = path.join(resultDir, 'exports.unpacked.review.html');
    await writeFile(unpackedPath, gunzipSync(packed));
    assert.deepEqual(await extract(unpackedPath), stored);
    const unpacked = await context.newPage();
    await unpacked.goto(pathToFileURL(unpackedPath).href);
    await frameFor(unpacked); await waitCount(unpacked, 1);
    assert.equal(await unpacked.locator('.annotation-comment').textContent(), comment);
    assert.equal(await unpacked.evaluate(() => window.__exportXss), undefined);
    await formats.locator('#export-format').selectOption('annotations');
    const lightPath = await download(formats, 'exports.review.json', 'demo.review.json');
    const lightBytes = await readFile(lightPath);
    const light = JSON.parse(lightBytes);
    assert.equal(light.format, 'html-review-annotations');
    assert.equal(light.source.base64, undefined);
    assert.equal(light.source.sha256, originalHash);
    assert.deepEqual(light.annotations, stored.annotations.map(annotation => ({...annotation, taskState: 'new'})));
    assert(!lightBytes.includes(Buffer.from(stored.source.base64)));
    assert((await formats.locator('#save-state').textContent()).includes('连同原文件保留'));
    assert(packed.length < fullBytes.length);
    assert(lightBytes.length < packed.length);
    exportSizes = {original: originalBytes.length, html: fullBytes.length, gzip: packed.length, annotations: lightBytes.length};
    await formats.screenshot({path: path.join(resultDir, '06-export-formats.png')});
    await unpacked.close(); await formats.close();
  });
  await check('text selection across inline nodes records quote, range and modification', async () => {
    await selectText(page, '#cross-node-text');
    assert.equal(await page.locator('#target-text').textContent(), '每一条具体的建议，都让下一次修改更清楚。');
    await saveNote(page, '将这段说明压缩为一句，保留“具体建议”和“修改位置”。');
    await waitCount(page, 1);
  });
  await check('element and parent-container selection identifies a layout region', async () => {
    await page.locator('[data-mode="element"]').click();
    const frame = await frameFor(page);
    await frame.locator('#card-collaborate h3').click();
    await page.locator('#parent-target').click();
    await page.waitForFunction(() => document.querySelector('#target-selector').textContent === '#card-collaborate');
    await saveNote(page, '这张卡片增加浅绿色背景；三张卡片保持等高，按钮底部对齐。');
    await waitCount(page, 2);
  });
  await check('whole-page feedback records responsive viewport and layout instruction', async () => {
    await page.locator('[data-mode="whole"]').click();
    await page.locator('#preview-width').selectOption('390');
    await saveNote(page, '手机宽度下缩小标题与说明之间的间距，卡片改为单列，正文保持易读。');
    await waitCount(page, 3);
  });
  let first;
  await check('download real HTML copy; original bytes and version stay unchanged', async () => {
    first = await download(page, 'demo.first.review.html');
    const stored = await extract(first);
    assert.equal(stored.annotations.length, 3);
    assert.deepEqual(stored.annotations.map(a => a.kind), ['text', 'element', 'page']);
    assert.equal(stored.annotations[0].target.quote.exact, '每一条具体的建议，都让下一次修改更清楚。');
    assert(stored.annotations[0].target.range.start.path.length > 0);
    assert(stored.annotations[0].target.position.end > stored.annotations[0].target.position.start);
    assert.equal(stored.annotations[1].target.selector, '#card-collaborate');
    assert.equal(stored.annotations[2].view.width, 390);
    assert.equal(stored.annotations[2].target.viewport.width, 390);
    assert.equal(stored.source.sha256, originalHash);
    assert.deepEqual(Buffer.from(stored.source.base64, 'base64'), originalBytes);
    assert.equal(digest(await readFile(originalPath)), originalHash);
    assert(!(await readFile(first, 'utf8')).includes('srcdoc="'));
  });
  const reopened = await context.newPage();
  await check('directly reopen downloaded copy; render source and locate saved annotations', async () => {
    await reopened.goto(pathToFileURL(first).href);
    const frame = await frameFor(reopened);
    await frame.locator('#hero-title').waitFor();
    await waitCount(reopened, 3);
    assert.equal(await frame.locator('#demo-count').textContent(), '已点击 0 次');
    await reopened.locator('.annotation-card').nth(0).locator('[data-action="locate"]').click();
    await reopened.locator('.location-status.exact').first().waitFor();
    await reopened.locator('.annotation-card').nth(1).locator('[data-action="locate"]').click();
    await reopened.locator('.annotation-card').nth(1).locator('.location-status.exact').waitFor();
    await reopened.locator('.annotation-card').nth(1).locator('[data-action="edit"]').click();
    await reopened.locator('[data-mode="browse"]').click();
    assert.equal(await reopened.locator('#target-kind').textContent(), '元素');
    assert.equal(await reopened.locator('#target-selector').textContent(), '#card-collaborate');
    await reopened.locator('#save-button').click();
    await reopened.locator('.annotation-card').nth(2).locator('[data-action="edit"]').click();
    assert.equal(await reopened.locator('#preview-width').inputValue(), '390');
    assert.equal(await reopened.locator('#draft-status').textContent(), '');
    await reopened.locator('#cancel-edit').click();
  });
  await check('edit existing annotation; unsaved draft blocks download until saved', async () => {
    await reopened.locator('.annotation-card').first().locator('[data-action="edit"]').click();
    await reopened.keyboard.press('Escape');
    assert.equal(await reopened.locator('[data-mode="text"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await reopened.locator('#target-preview').isVisible(), false);
    assert.equal(await reopened.locator('#comment-input').inputValue(), (await reopened.locator('.annotation-comment').first().textContent()));
    await selectText(reopened, '#cross-node-text');
    await reopened.locator('#comment-input').fill('改为：具体的建议，让修改位置与要求一目了然。');
    await reopened.locator('#download-button').click();
    await reopened.waitForFunction(() => document.querySelector('#status').textContent.includes('尚未保存') || document.querySelector('#status').textContent.includes('未保存'));
    await reopened.locator('#save-button').click();
    await waitCount(reopened, 3);
    assert((await reopened.locator('.annotation-comment').first().textContent()).includes('一目了然'));
    assert.equal(await reopened.locator('[data-mode="text"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await reopened.locator('#comment-input').inputValue(), '');
  });
  const injection = '把字面量 </script><script>window.__reviewXss=1</script> 当作普通文字保留。';
  let second;
  await check('literal script-closing text survives export and reopening without execution', async () => {
    await reopened.locator('[data-mode="whole"]').click();
    await saveNote(reopened, injection);
    await waitCount(reopened, 4);
    second = await download(reopened, 'demo.second.review.html');
    const stored = await extract(second);
    assert.equal(stored.annotations[0].kind, 'text');
    assert.equal(stored.annotations[0].target.quote.exact, '每一条具体的建议，都让下一次修改更清楚。');
    assert.equal(stored.annotations[1].kind, 'element');
    assert.equal(stored.annotations[1].target.selector, '#card-collaborate');
    assert.equal(stored.annotations[3].comment, injection);
    assert.equal(stored.source.sha256, originalHash);
  });
  const finalPage = await context.newPage();
  let finalArtifact;
  await check('second reopen, delete a note, add/edit workflow remains available, export again', async () => {
    await finalPage.goto(pathToFileURL(second).href);
    await frameFor(finalPage); await waitCount(finalPage, 4);
    assert.equal(await finalPage.evaluate(() => window.__reviewXss), undefined);
    assert.equal(await finalPage.locator('.annotation-comment').last().textContent(), injection);
    await finalPage.locator('.annotation-card').last().locator('[data-action="delete"]').click();
    await waitCount(finalPage, 3);
    await finalPage.locator('#preview-width').selectOption('fluid');
    await finalPage.locator('[data-mode="browse"]').click();
    // A portable review copy has no disk permission: first reload associates the original.
    await finalPage.evaluate(() => { window.showOpenFilePicker = undefined; });
    const reloadPicker = finalPage.waitForEvent('filechooser');
    await finalPage.locator('#reload-preview').click();
    await (await reloadPicker).setFiles(path.join(root, 'examples/demo.html'));
    await finalPage.waitForFunction(() => !document.querySelector('#reload-preview').disabled);
    await finalPage.locator('#preview-frame').contentFrame().locator('#hero-title').waitFor();
    finalArtifact = await download(finalPage, 'demo.review.html');
    const stored = await extract(finalArtifact);
    assert.equal(stored.annotations.length, 3);
    assert(stored.annotations[0].comment.includes('一目了然'));
    await finalPage.locator('.sidebar').evaluate(element => { element.scrollTop = 0; });
    await finalPage.screenshot({path: path.join(resultDir, '02-annotated-page.png')});
  });
  const imported = await context.newPage();
  await check('import an annotated copy into a fresh workbench; corrupt hash rejected transactionally', async () => {
    await imported.goto(appUrl);
    await imported.locator('#file-input').setInputFiles(finalArtifact);
    await frameFor(imported); await waitCount(imported, 3);
    const stored = await extract(finalArtifact);
    stored.source.sha256 = '0'.repeat(64);
    const corrupt = (await readFile(finalArtifact, 'utf8')).replace(dataPattern, (_, start, old, end) => start + JSON.stringify(stored).replace(/</g, '\\u003c') + end);
    const corruptPath = path.join(resultDir, 'corrupt.review.html'); await writeFile(corruptPath, corrupt);
    await imported.locator('#file-input').setInputFiles(corruptPath);
    await imported.waitForFunction(() => document.querySelector('#status').classList.contains('error') && document.querySelector('#status').textContent.includes('完整性'));
    await waitCount(imported, 3);
    assert.equal(await imported.locator('#source-name').textContent(), 'demo.html');
    assert(await imported.locator('#preview-frame').contentFrame().locator('#hero-title').isVisible());
    const malformed = await extract(finalArtifact);
    malformed.annotations[0].target.quote.exact = 42;
    const malformedPath = path.join(resultDir, 'malformed.review.html');
    await writeFile(malformedPath, (await readFile(finalArtifact, 'utf8')).replace(dataPattern, (_, start, old, end) => start + JSON.stringify(malformed).replace(/</g, '\\u003c') + end));
    await imported.locator('#file-input').setInputFiles(malformedPath);
    await imported.waitForFunction(() => !document.querySelector('#open-button').disabled && document.querySelector('#status').classList.contains('error'));
    await waitCount(imported, 3);
    await imported.locator('.annotation-card').first().locator('[data-action="edit"]').click();
    assert((await imported.locator('#comment-input').inputValue()).includes('一目了然'));
  });
  const assets = await context.newPage();
  let assetCopy;
  await check('single HTML warns about missing relative assets; directory import bundles CSS/images/scripts', async () => {
    await assets.goto(appUrl);
    await assets.locator('#file-input').setInputFiles(path.join(root, 'examples/with-assets/index.html'));
    await frameFor(assets);
    assert(await assets.locator('#warnings').isVisible());
    await assets.locator('#folder-input').setInputFiles(path.join(root, 'examples/with-assets'));
    const frame = await frameFor(assets);
    await frame.locator('#landscape').waitFor();
    await frame.locator('#landscape').evaluate(image => image.decode());
    assert((await frame.locator('#landscape').evaluate(image => image.naturalWidth)) > 0);
    assert.equal(await frame.locator('body').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(246, 244, 235)');
    const before = await frame.locator('#save-status').textContent();
    await frame.locator('#save-note').click();
    assert.notEqual(await frame.locator('#save-status').textContent(), before);
    await assets.locator('[data-mode="element"]').click();
    await frame.locator('#landscape').click();
    await saveNote(assets, '保持插图比例，将图注与图片左侧对齐。');
    await waitCount(assets, 1);
    assetCopy = await download(assets, 'with-assets.review.html');
    const stored = await extract(assetCopy);
    assert.equal(stored.annotations[0].target.attributes.src, 'images/landscape.svg');
    assert.equal(stored.resources.length, 5);
    await assets.locator('#export-format').selectOption('annotations');
    const light = JSON.parse(await readFile(await download(assets, 'with-assets.review.json'), 'utf8'));
    assert.equal(light.resources.length, 5);
    assert(light.resources.every((resource, index) => resource.sha256 === stored.resources[index].sha256 && resource.base64 === undefined));
  });
  await check('portable asset copy reopens with working relative resources and element locator', async () => {
    const reopenedAssets = await context.newPage();
    await reopenedAssets.goto(pathToFileURL(assetCopy).href);
    const frame = await frameFor(reopenedAssets);
    await frame.locator('#landscape').evaluate(image => image.decode());
    assert.equal(await frame.locator('body').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(246, 244, 235)');
    await waitCount(reopenedAssets, 1);
    await reopenedAssets.locator('.annotation-card [data-action="locate"]').click();
    await reopenedAssets.locator('.location-status.exact').waitFor();
    await reopenedAssets.screenshot({path: path.join(resultDir, '03-bundled-assets.png')});
  });
  await check('original HTML remains unchanged and no app runtime exception occurred', async () => {
    assert.equal(digest(await readFile(originalPath)), originalHash);
    assert.deepEqual(errors, []);
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
  if (browser) {
    for (const context of browser.contexts()) for (const [i, page] of context.pages().entries()) {
      await page.screenshot({path: path.join(resultDir, `failure-${i}.png`)}).catch(() => {});
    }
  }
  errors.push(String(error.stack || error));
} finally {
  const pid = server?.process().pid;
  if (browser) await browser.close().catch(() => {});
  if (server) await server.close();
  cleanup = !server || server.process().exitCode !== null || server.process().signalCode !== null;
  await writeFile(path.join(resultDir, 'report.json'), JSON.stringify({checks, errors, exportSizes, originalSha256: originalHash, browserPid: pid, processCleanupComplete: cleanup}, null, 2));
  console.log(cleanup ? 'PROCESS_CLEANUP_COMPLETE' : 'PROCESS_CLEANUP_BLOCKED');
  if (!cleanup) process.exitCode = 1;
}
