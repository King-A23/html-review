import {runPython} from '../scripts/python.mjs';
/* Full feedback loop: actual exports → Python agent interface → native directory reload → next handoff. */
import assert from 'node:assert/strict';
import {readFile, mkdtemp, rm, mkdir, stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
let modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
if (modulePath && (await stat(modulePath)).isDirectory()) modulePath = path.join(modulePath, 'index.mjs');
const {chromium} = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const app = await readFile(path.join(root, 'index.html'));
const server = createServer((_req, res) => {res.setHeader('Content-Type', 'text/html;charset=utf-8'); res.end(app);});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const workspace = await mkdtemp(path.join(os.tmpdir(), 'html-review-results-'));
const ready = page => page.waitForFunction(() => !document.getElementById('open-button').disabled);
const frame = page => page.frameLocator('#preview-frame');
const card = (page, id) => page.locator(`.annotation-card[data-annotation-id="${id}"]`);
async function writeNative(page, filename, text) {
  await page.evaluate(async ({filename, text}) => {
    const root = await navigator.storage.getDirectory(); const file = await root.getFileHandle(filename, {create: true});
    const writer = await file.createWritable(); await writer.write(text); await writer.close();
  }, {filename, text});
}
async function exported(page, filename) {
  await page.locator('#export-format').selectOption('annotations');
  const downloading = page.waitForEvent('download'); await page.locator('#download-button').click();
  const target = path.join(workspace, filename); await (await downloading).saveAs(target);
  return {target, data: JSON.parse(await readFile(target, 'utf8'))};
}
async function result(review, filename, id, status, summary) {
  const output = path.join(workspace, filename);
  await runPython([path.join(root, 'scripts/update_review.py'), review, '--id', id, '--status', status, '--summary', summary, '--output', output]);
  return {output, text: await readFile(output, 'utf8')};
}
let context;
try {
  // A disposable normal profile exercises handle persistence without incognito storage.
  context = await chromium.launchPersistentContext('', {headless: true, ...(process.env.BROWSER_PATH ? {executablePath: process.env.BROWSER_PATH} : {}), viewport: {width: 1440, height: 1000}, acceptDownloads: true});
  await context.addInitScript(() => {window.showDirectoryPicker = () => navigator.storage.getDirectory();});
  const page = await context.newPage(); page.on('dialog', dialog => dialog.accept());
  await page.goto(`http://127.0.0.1:${server.address().port}/`); await ready(page);
  await writeNative(page, 'report.html', '<!doctype html><meta charset="utf-8"><h1>测试报告</h1><p id="obsolete">这句话需要删除。</p>');
  await page.locator('#folder-button').click(); await ready(page);
  await frame(page).locator('#obsolete').waitFor();
  await page.locator('[data-mode=element]').click(); await frame(page).locator('#obsolete').click();
  await page.locator('#target-text').filter({hasText: '这句话需要删除。'}).waitFor();
  await page.locator('#comment-input').fill('删除这句内容'); await page.locator('#save-button').click();
  await page.locator('[data-mode=whole]').click();
  await page.locator('#comment-input').fill('统一页面风格'); await page.locator('#save-button').click();
  const first = await exported(page, 'report.review.json');
  const [deleted, pending] = first.data.annotations;
  assert.equal(deleted.taskState, 'new');
  const completion = await result(first.target, 'report.review-results.json', deleted.id, 'resolved', '已删除旧句，核对剩余内容正常');
  await writeNative(page, 'report.html', '<!doctype html><meta charset="utf-8"><h1>测试报告 · 已更新</h1>');
  await writeNative(page, 'report.review-results.json', completion.text);
  await page.locator('#comment-input').fill('正在输入的新草稿');
  await page.locator('#reload-preview').click(); await ready(page);
  await frame(page).locator('h1').filter({hasText: '已更新'}).waitFor();
  assert.equal(await frame(page).locator('#obsolete').count(), 0);
  assert.equal(await card(page, deleted.id).getAttribute('data-review-state'), 'completed');
  assert.equal(await card(page, deleted.id).locator('[data-action=locate]').isDisabled(), true);
  assert.equal(await card(page, deleted.id).locator('.annotation-quote').textContent(), '这句话需要删除。');
  assert.equal(await page.locator('#comment-input').inputValue(), '正在输入的新草稿');
  await page.locator('#cancel-edit').click();
  let next = await exported(page, 'after-completion.review.json');
  assert.equal(next.data.annotations[0].history.length, 1);
  assert.equal(next.data.annotations[0].updatedAt, deleted.updatedAt);
  assert.equal(next.data.annotations[0].comment, deleted.comment);
  assert.deepEqual(next.data.annotations[0].target, deleted.target);
  assert(!next.data.resources.some(resource => resource.path.endsWith('.review-results.json')));
  await page.locator('#reload-preview').click(); await ready(page);
  next = await exported(page, 'replayed.review.json');
  assert.equal(next.data.annotations[0].history.length, 1);
  console.log('PASS automatic feedback: deleted target becomes completed history; original context and draft survive; repeated reload is idempotent');

  const unresolved = await result(next.target, 'pending.review-results.json', pending.id, 'open', '风格方向需要补充');
  await page.locator('#results-input').setInputFiles(unresolved.output); await ready(page);
  assert.equal(await card(page, pending.id).getAttribute('data-review-state'), 'pending');
  await page.locator('#undo-button').click();
  assert.equal(await card(page, pending.id).getAttribute('data-review-state'), 'new');
  await page.locator('#redo-button').click();
  assert.equal(await card(page, pending.id).getAttribute('data-review-state'), 'pending');
  await page.locator('#annotation-filter-trigger').click();
  await page.locator('.select-popover [data-value=resolved]').click();
  await page.locator('.select-popover').waitFor({state: 'hidden'});
  assert.equal(await page.locator('.annotation-card').count(), 1);
  await page.locator('#annotation-filter').selectOption('open');
  assert.equal(await page.locator('.annotation-card').count(), 1);
  await page.locator('#annotation-filter').selectOption('all');
  console.log('PASS manual feedback: unresolved work remains pending; status imports undo/redo as a batch and filters preserve records');

  await card(page, deleted.id).locator('[data-action=edit]').click();
  await page.locator('#comment-input').fill('新增要求：调整标题字号'); await page.locator('#save-button').click();
  assert.equal(await card(page, deleted.id).getAttribute('data-review-state'), 'updated');
  await page.locator('#reload-preview').click(); await ready(page);
  assert.equal(await card(page, deleted.id).getAttribute('data-review-state'), 'updated');
  await page.locator('[data-mode=whole]').click();
  await page.locator('#comment-input').fill('新增要求：补充来源说明'); await page.locator('#save-button').click();
  next = await exported(page, 'next-round.review.json');
  assert.deepEqual(next.data.annotations.map(annotation => annotation.taskState), ['updated', 'pending', 'new']);
  assert.equal(next.data.annotations[0].revision, 2);
  assert.equal(next.data.annotations[0].history.length, 1);
  // New batch from an old review is stale: reject feedback while still refreshing source.
  const stale = await result(first.target, 'stale.review-results.json', deleted.id, 'resolved', '旧意见完成回报');
  await writeNative(page, 'report.review-results.json', stale.text);
  await writeNative(page, 'report.html', '<!doctype html><meta charset="utf-8"><h1>最新版本 · 继续审阅</h1>');
  await page.locator('#reload-preview').click(); await ready(page);
  await frame(page).locator('h1').filter({hasText: '继续审阅'}).waitFor();
  assert.match(await page.locator('#status').textContent(), /结果未导入.*过期/);
  assert.equal(await card(page, deleted.id).getAttribute('data-review-state'), 'updated');
  console.log('PASS revision guard: editing completed opinions reopens work; old feedback cannot close new requests or block source refresh');

  await card(page, pending.id).locator('[data-action=status]').click();
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async text => { window.__copiedTask = text; }}}));
  await page.locator('#copy-agent-task').click();
  const copied = await page.evaluate(() => window.__copiedTask);
  assert.match(copied, /仅处理 status=open/);
  assert.deepEqual(JSON.parse(copied.slice(copied.indexOf('{'))).annotations.map(annotation => annotation.taskState), ['updated', 'completed', 'new']);
  // Clipboard access may fall back to the dialog on isolated browsers.
  if (await page.locator('#agent-task-dialog').isVisible()) {
    const task = await page.locator('#agent-task-text').inputValue();
    assert.match(task, /仅处理 status=open/); assert.match(task, /completed/); assert.match(task, /updated/);
    await page.locator('#agent-task-dialog [data-close]').click(); await page.locator('#agent-task-dialog').waitFor({state: 'hidden'});
  }
  await page.locator('#export-format').selectOption('html');
  const downloading = page.waitForEvent('download'); await page.locator('#download-button').click();
  const full = path.join(workspace, 'complete.review.html'); await (await downloading).saveAs(full);
  const reopened = await context.newPage(); await reopened.goto(pathToFileURL(full).href); await ready(reopened);
  assert.equal(await card(reopened, pending.id).getAttribute('data-review-state'), 'completed');
  assert.equal(await card(reopened, deleted.id).getAttribute('data-review-state'), 'updated');
  await reopened.locator('#annotation-filter').selectOption('resolved');
  assert.equal(await reopened.locator('.annotation-card').count(), 1);
  await mkdir(path.join(root, 'test-results'), {recursive: true});
  await page.screenshot({path: path.join(root, 'test-results/results-workflow.png'), fullPage: true});
  console.log('PASS handoff: new/pending/updated/completed states survive lightweight and full exports, copied tasks, and direct reopening');
  await context.close();
} finally {
  await context?.close(); await new Promise(resolve => server.close(resolve));
  await rm(workspace, {recursive: true, force: true}); console.log('PROCESS_CLEANUP_COMPLETE');
}
