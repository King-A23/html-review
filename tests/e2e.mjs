import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
  await frame.locator('body').waitFor();
  await page.waitForFunction(() => !document.querySelector('#open-button').disabled);
  return frame;
}
async function waitCount(page, count) {
  await page.waitForFunction(expected => document.querySelector('#annotation-count').textContent === String(expected), count);
}
async function download(page, filename) {
  const pending = page.waitForEvent('download');
  await page.locator('#download-button').click();
  const downloaded = await pending;
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
    await page.locator('[data-mode="page"]').click();
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
  });
  await check('edit existing annotation; unsaved draft blocks download until saved', async () => {
    await reopened.locator('.annotation-card').first().locator('[data-action="edit"]').click();
    await reopened.locator('#comment-input').fill('改为：具体的建议，让修改位置与要求一目了然。');
    await reopened.locator('#download-button').click();
    await reopened.waitForFunction(() => document.querySelector('#status').textContent.includes('尚未保存') || document.querySelector('#status').textContent.includes('未保存'));
    await reopened.locator('#save-button').click();
    await waitCount(reopened, 3);
    assert((await reopened.locator('.annotation-comment').first().textContent()).includes('一目了然'));
  });
  const injection = '把字面量 </script><script>window.__reviewXss=1</script> 当作普通文字保留。';
  let second;
  await check('literal script-closing text survives export and reopening without execution', async () => {
    await reopened.locator('[data-mode="page"]').click();
    await saveNote(reopened, injection);
    await waitCount(reopened, 4);
    second = await download(reopened, 'demo.second.review.html');
    const stored = await extract(second);
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
    await finalPage.locator('#reload-preview').click();
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
  await writeFile(path.join(resultDir, 'report.json'), JSON.stringify({checks, errors, originalSha256: originalHash, browserPid: pid, processCleanupComplete: cleanup}, null, 2));
  console.log(cleanup ? 'PROCESS_CLEANUP_COMPLETE' : 'PROCESS_CLEANUP_BLOCKED');
  if (!cleanup) process.exitCode = 1;
}
