/* Real Chromium filesystem handles + IndexedDB, with an isolated native filesystem fixture.
 * Picker UI is stubbed; all file reads, writes, directory enumeration and handle cloning are native.
 */
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdtemp, mkdir, rm, stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:http';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let playwright = process.env.PLAYWRIGHT_MODULE_PATH;
if (playwright && (await stat(playwright)).isDirectory()) playwright = path.join(playwright, 'index.mjs');
const {chromium} = await import(playwright ? pathToFileURL(playwright).href : 'playwright');
const app = await readFile(path.join(root, 'index.html'));
const server = createServer((_req, res) => {res.setHeader('Content-Type', 'text/html;charset=utf-8'); res.end(app);});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const temp = await mkdtemp(path.join(os.tmpdir(), 'html-review-reload-'));
const contexts = [];
async function isolatedContext(options = {}) {
  // Native handle persistence uses a normal disk-backed profile, as in daily use.
  // Empty userDataDir asks Playwright to create and clean an isolated temporary one.
  const context = await chromium.launchPersistentContext('', {headless: true, ...(process.env.BROWSER_PATH ? {executablePath: process.env.BROWSER_PATH} : {}), ...options});
  contexts.push(context);
  return context;
}
const html = version => `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="assets/theme.css"><h1 id="summary">报告版本 ${version}</h1><img id="chart" src="assets/chart.svg">`;
const svg = color => `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="${color}"/></svg>`;
const ready = page => page.waitForFunction(() => !document.getElementById('open-button').disabled);
const preview = page => page.frameLocator('#preview-frame');
const report = async page => {
  await page.locator('#data-button').click();
  const value = JSON.parse(await page.locator('#data-preview').textContent());
  await page.locator('#data-dialog [data-close]').click();
  await page.locator('#data-dialog').waitFor({state: 'hidden'});
  return value;
};
async function nativeWrite(page, filename, text) {
  await page.evaluate(async ({filename, text}) => {
    const root = await navigator.storage.getDirectory();
    const parts = filename.split('/'); let directory = root;
    for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part, {create: true});
    const file = await directory.getFileHandle(parts.at(-1), {create: true});
    const writer = await file.createWritable(); await writer.write(text); await writer.close();
  }, {filename, text});
}
try {
  const context = await isolatedContext({viewport: {width: 1440, height: 1000}});
  await context.addInitScript(() => {
    window.__pickerCounts = {file: 0, directory: 0};
    window.showOpenFilePicker = async () => {
      ++window.__pickerCounts.file;
      return [await (await navigator.storage.getDirectory()).getFileHandle('report.html')];
    };
    window.showDirectoryPicker = async () => {++window.__pickerCounts.directory; return navigator.storage.getDirectory();};
  });
  const page = await context.newPage();
  page.on('dialog', dialog => dialog.accept());
  await page.goto(url); await ready(page);
  await nativeWrite(page, 'report.html', html(1));
  await nativeWrite(page, 'index.html', '<!doctype html><h1>其他入口</h1>');
  await nativeWrite(page, 'assets/theme.css', '#summary{color:rgb(10,20,30)}');
  await nativeWrite(page, 'assets/chart.svg', svg('red'));
  await page.locator('#open-button').click(); await ready(page);
  await preview(page).locator('#summary').waitFor();
  await page.locator('#comment-input').fill('保留这条整体修改意见');
  await page.locator('#save-button').click();
  const original = await report(page);
  await page.locator('[data-mode=element]').click();
  await preview(page).locator('#summary').click();
  await page.locator('#target-text').filter({hasText: '报告版本 1'}).waitFor();
  await page.locator('#comment-input').fill('未保存的草稿');
  await nativeWrite(page, 'report.html', html(2));
  await page.locator('#reload-preview').click(); await ready(page);
  await preview(page).locator('#summary').filter({hasText: '报告版本 2'}).waitFor();
  assert.equal(await page.locator('#annotation-count').textContent(), '1');
  assert.equal(await page.locator('#comment-input').inputValue(), '未保存的草稿');
  assert.equal((await page.evaluate(() => window.__pickerCounts)).file, 1);
  assert.equal(await page.locator('[data-mode=element]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#target-text').textContent(), '报告版本 1');
  console.log('PASS single file: fresh native getFile() reads changed contents without another picker; annotations and draft survive');

  await page.locator('#folder-button').click(); await ready(page);
  assert.equal(await page.locator('#entry-select').inputValue(), 'report.html');
  assert.equal(await page.locator('#annotation-count').textContent(), '1');
  assert.equal(await page.locator('#comment-input').inputValue(), '未保存的草稿');
  assert.equal(await preview(page).locator('#summary').evaluate(e => getComputedStyle(e).color), 'rgb(10, 20, 30)');
  const linked = await report(page);
  await nativeWrite(page, 'report.html', html(3));
  await nativeWrite(page, 'assets/theme.css', '#summary{color:rgb(40,50,60)}');
  await nativeWrite(page, 'assets/chart.svg', svg('green'));
  await nativeWrite(page, 'assets/new.txt', '新资源');
  await page.locator('#reload-preview').click(); await ready(page);
  await preview(page).locator('#summary').filter({hasText: '报告版本 3'}).waitFor();
  assert.equal(await preview(page).locator('#summary').evaluate(e => getComputedStyle(e).color), 'rgb(40, 50, 60)');
  assert(await preview(page).locator('#chart').evaluate(e => e.complete && e.naturalWidth > 0));
  const updated = await report(page);
  assert.notEqual(updated.source.sha256, linked.source.sha256);
  assert.notEqual(updated.resources.find(r => r.path === 'assets/chart.svg').sha256, linked.resources.find(r => r.path === 'assets/chart.svg').sha256);
  assert(updated.resources.some(r => r.path === 'assets/new.txt'));
  assert.deepEqual(updated.annotations, original.annotations);
  assert.deepEqual(await page.evaluate(() => window.__pickerCounts), {file: 1, directory: 1});
  console.log('PASS folder: existing association reloads HTML, CSS, images and new resources; current entry, annotations and draft survive');

  await page.waitForFunction(() => document.getElementById('autosave-state').textContent.startsWith('本机已保存'));
  await page.reload(); await ready(page);
  assert.equal(await page.locator('#entry-select').inputValue(), 'report.html');
  assert.equal(await page.locator('#annotation-count').textContent(), '1');
  assert.equal(await page.locator('#comment-input').inputValue(), '未保存的草稿');
  await nativeWrite(page, 'report.html', html(4));
  await page.locator('#reload-preview').click(); await ready(page);
  await preview(page).locator('#summary').filter({hasText: '报告版本 4'}).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__pickerCounts), {file: 0, directory: 0});
  console.log('PASS recovery: IndexedDB restores genuine directory handles; browser refresh does not require folder reimport');

  await page.evaluate(() => {
    window.__query = FileSystemHandle.prototype.queryPermission;
    window.__request = FileSystemHandle.prototype.requestPermission;
    FileSystemHandle.prototype.queryPermission = async () => 'denied';
    FileSystemHandle.prototype.requestPermission = async () => 'denied';
  });
  await page.locator('#reload-preview').click(); await ready(page);
  assert.match(await page.locator('#status').textContent(), /未获得读取权限/);
  assert.equal(await preview(page).locator('#summary').textContent(), '报告版本 4');
  assert.equal(await page.locator('#comment-input').inputValue(), '未保存的草稿');
  await page.evaluate(() => {FileSystemHandle.prototype.queryPermission = window.__query; FileSystemHandle.prototype.requestPermission = window.__request;});
  await page.evaluate(async () => (await navigator.storage.getDirectory()).removeEntry('report.html'));
  await page.locator('#reload-preview').click(); await ready(page);
  assert.match(await page.locator('#status').textContent(), /找不到/);
  assert.equal(await preview(page).locator('#summary').textContent(), '报告版本 4');
  assert.equal(await page.locator('#annotation-count').textContent(), '1');
  await nativeWrite(page, 'report.html', html(5));
  await page.locator('#reload-preview').click(); await ready(page);
  await preview(page).locator('#summary').filter({hasText: '报告版本 5'}).waitFor();
  console.log('PASS failure recovery: denied permission and deleted files keep the current workspace; restoring the file allows retry');
  await mkdir(path.join(root, 'test-results'), {recursive: true});
  await page.screenshot({path: path.join(root, 'test-results/local-reload.png'), fullPage: true});
  await context.close();

  // A snapshot-only/legacy workspace establishes its directory link on the first reload.
  const legacy = await isolatedContext();
  await legacy.addInitScript(() => {
    window.__directoryPicks = 0;
    window.showDirectoryPicker = async () => { ++window.__directoryPicks; return navigator.storage.getDirectory(); };
  });
  const migrated = await legacy.newPage(); migrated.on('dialog', dialog => dialog.accept());
  await migrated.goto(url); await ready(migrated);
  await mkdir(path.join(temp, 'assets'));
  await writeFile(path.join(temp, 'report.html'), html('快照'));
  await writeFile(path.join(temp, 'assets/theme.css'), '#summary{color:rgb(1,2,3)}');
  await writeFile(path.join(temp, 'assets/chart.svg'), svg('blue'));
  await migrated.locator('#folder-input').setInputFiles(temp); await ready(migrated);
  await preview(migrated).locator('#summary').waitFor();
  await migrated.locator('#comment-input').fill('旧工作区批注'); await migrated.locator('#save-button').click();
  await migrated.locator('#comment-input').fill('旧工作区草稿');
  await nativeWrite(migrated, 'report.html', html('已关联'));
  await nativeWrite(migrated, 'assets/theme.css', '#summary{color:rgb(4,5,6)}');
  await nativeWrite(migrated, 'assets/chart.svg', svg('green'));
  await migrated.locator('#reload-preview').click(); await ready(migrated);
  await preview(migrated).locator('#summary').filter({hasText: '报告版本 已关联'}).waitFor();
  await nativeWrite(migrated, 'report.html', html('再次更新'));
  await migrated.locator('#reload-preview').click(); await ready(migrated);
  await preview(migrated).locator('#summary').filter({hasText: '报告版本 再次更新'}).waitFor();
  assert.equal(await migrated.evaluate(() => window.__directoryPicks), 1);
  assert.equal(await migrated.locator('#annotation-count').textContent(), '1');
  assert.equal(await migrated.locator('#comment-input').inputValue(), '旧工作区草稿');
  console.log('PASS legacy migration: first reload associates the original folder; later reloads require no picker and keep annotations and draft');
  await migrated.evaluate(() => { window.showOpenFilePicker = async () => { throw new DOMException('cancelled', 'AbortError'); }; });
  await migrated.locator('#open-button').click(); await ready(migrated);
  assert.match(await migrated.locator('#status').textContent(), /已取消选择/);
  assert.equal(await migrated.locator('#comment-input').inputValue(), '旧工作区草稿');
  await legacy.close();

  const fallback = await isolatedContext();
  await fallback.addInitScript(() => {window.showOpenFilePicker = undefined; window.showDirectoryPicker = undefined;});
  const other = await fallback.newPage(); other.on('dialog', dialog => dialog.accept());
  await writeFile(path.join(temp, 'report.html'), html('旧'));
  await writeFile(path.join(temp, 'assets/theme.css'), '#summary{color:rgb(1,2,3)}');
  await writeFile(path.join(temp, 'assets/chart.svg'), svg('blue'));
  await other.goto(url); await ready(other);
  await other.locator('#folder-input').setInputFiles(temp); await ready(other);
  await preview(other).locator('#summary').waitFor();
  await other.locator('#comment-input').fill('兼容浏览器批注'); await other.locator('#save-button').click();
  await other.locator('#comment-input').fill('兼容浏览器草稿');
  await writeFile(path.join(temp, 'report.html'), html('新'));
  await writeFile(path.join(temp, 'assets/theme.css'), '#summary{color:rgb(4,5,6)}');
  const picker = other.waitForEvent('filechooser');
  await other.locator('#reload-preview').click();
  await (await picker).setFiles(temp); await ready(other);
  await preview(other).locator('#summary').filter({hasText: '报告版本 新'}).waitFor();
  assert.equal(await preview(other).locator('#summary').evaluate(e => getComputedStyle(e).color), 'rgb(4, 5, 6)');
  assert.equal(await other.locator('#annotation-count').textContent(), '1');
  assert.equal(await other.locator('#comment-input').inputValue(), '兼容浏览器草稿');
  console.log('PASS compatibility: one folder selection refreshes actual disk HTML and resources without losing annotations or draft');
  await fallback.close();
} finally {
  await Promise.all(contexts.map(context => context.close()));
  await new Promise(resolve => server.close(resolve));
  await rm(temp, {recursive: true, force: true});
  console.log('PROCESS_CLEANUP_COMPLETE');
}
