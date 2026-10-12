/* Upgrade an authentic v0.1.0 workspace, then exercise the delivered offline apps. */
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir, mkdtemp, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import JSZip from 'jszip';
import {createDocxFixture} from './docx-fixtures.mjs';
import {createPdfFixture} from './pdf-fixtures.mjs';
import {ensureBackup, openAnnotationData} from './backup-ui.mjs';
import {runPython} from '../scripts/python.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = await mkdtemp(path.join(tmpdir(), 'html-review-release-'));
const {version} = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const standalone = await readFile(path.join(root, 'dist/html-review.html'));
const legacy = await readFile(path.join(root, 'examples/demo.review.html'));
const checks = [], errors = [], externalRequests = [];
let serving = legacy, browser;
const server = createServer((_request, response) => {response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(serving);});
const ready = page => page.waitForFunction(() => !document.querySelector('#open-button').disabled);
const observe = page => {
  page.on('dialog', dialog => dialog.accept());
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:')) externalRequests.push(request.url());});
};
async function data(page) {
  await openAnnotationData(page);
  const value = JSON.parse(await page.locator('#data-preview').textContent());
  await page.locator('#data-dialog [data-close]').click();
  await page.locator('#data-dialog').waitFor({state:'hidden'});
  return value;
}
async function download(page, format, filename) {
  await ensureBackup(page); await page.locator('#export-format').selectOption(format);
  const pending = page.waitForEvent('download'); await page.locator('#download-button').click();
  const output = path.join(temp, filename); await (await pending).saveAs(output); return output;
}
function opinions(records) {
  return records.map(({id,kind,comment,target,revision,status,history,targetHistory}) => ({id,kind,comment,target,revision,status,history,targetHistory}));
}
try {
  assert.deepEqual(standalone, await readFile(path.join(root, 'index.html')));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({headless:true, ...(process.env.BROWSER_PATH ? {executablePath:process.env.BROWSER_PATH} : {})});
  const context = await browser.newContext({viewport:{width:1440,height:1000}, acceptDownloads:true});
  const page = await context.newPage(); observe(page);
  const url = `http://127.0.0.1:${server.address().port}/`;
  await page.goto(url); await ready(page);
  await page.locator('.annotation-card [data-action=status]').first().click();
  await page.locator('#comment-input').fill('升级前尚未保存的草稿。');
  const before = await page.evaluate(async key => {
    const until = performance.now() + 10000;
    while (performance.now() < until) {
      const record = await HRSession.load(key);
      if (record?.draft.comment === '升级前尚未保存的草稿。' && record.data.annotations.some(a => a.status === 'resolved')) return record;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Legacy session did not persist');
  }, 'workspace:' + url);
  serving = standalone;
  await page.reload(); await ready(page);
  await page.locator('#preview-frame[aria-busy=false]').waitFor();
  assert.equal(await page.locator('#comment-input').inputValue(), before.draft.comment);
  const upgraded = await data(page);
  assert.equal(upgraded.source.sha256, before.data.source.sha256);
  // Export requires explicitly saving or discarding the preserved draft first.
  await page.locator('#cancel-edit').click();
  const upgradedCopy = await readFile(await download(page, 'html', 'legacy-upgraded.review.html'), 'utf8');
  const upgradedSnapshot = JSON.parse(upgradedCopy.match(/<script id="html-review-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert(upgradedSnapshot.source.base64 === before.data.source.base64, 'Legacy source bytes survive upgrade');
  assert.deepEqual(opinions(upgraded.annotations), opinions(before.data.annotations));
  checks.push('Authentic v0.1.0 same-URL IndexedDB upgrade preserves original bytes, opinions, completion history and unsaved draft');
  await context.close();

  const unpacked = path.join(temp, 'unpacked');
  await runPython(['-c', 'import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', path.join(root, `dist/html-review-v${version}.zip`), unpacked]);
  const packaged = path.join(unpacked, 'html-review/index.html');
  assert.deepEqual(await readFile(packaged), standalone);
  for (const app of [path.join(root, 'dist/html-review.html'), packaged]) {
    const offline = await browser.newContext({viewport:{width:1440,height:1000}, offline:true, acceptDownloads:true});
    const page = await offline.newPage(); observe(page);
    await page.addInitScript(() => {window.showOpenFilePicker = undefined; window.showDirectoryPicker = undefined;});
    await page.goto(pathToFileURL(app).href); await ready(page);
    await page.locator('#file-input').setInputFiles(path.join(root, 'examples/demo.review.html')); await ready(page);
    await page.locator('#preview-frame[aria-busy=false]').waitFor();
    const legacyData = JSON.parse(legacy.toString().match(/<script id="html-review-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    assert.deepEqual(opinions((await data(page)).annotations), opinions(legacyData.annotations));
    for (const type of ['docx', 'pdf']) {
      const bytes = type === 'docx' ? await createDocxFixture() : await createPdfFixture();
      const source = path.join(temp, `原始示例.${type}`); await writeFile(source, bytes);
      await page.locator('#file-input').setInputFiles(source); await ready(page);
      await page.locator(type === 'pdf' ? '.pdf-page[data-page-number="1"][data-rendered=true]' : '#preview-frame[aria-busy=false]').waitFor();
      await page.locator('[data-mode=browse]').click();
      await page.locator('#comment-input').fill(`${type} 发布候选：核对术语与单位。`); await page.locator('#save-button').click();
      const before = await data(page);
      assert.equal(before.source.sha256, createHash('sha256').update(bytes).digest('hex'));
      await page.locator('#handoff-button').click();
      const handoff = page.waitForEvent('download'); await page.locator('#handoff-export-package').click();
      const handoffPath = path.join(temp, `${type}-handoff.zip`); await (await handoff).saveAs(handoffPath);
      const zip = await JSZip.loadAsync(await readFile(handoffPath));
      assert.deepEqual(Buffer.from(await zip.file('original/' + before.source.path).async('uint8array')), bytes);
      await page.keyboard.press('Escape');
      const light = JSON.parse(await readFile(await download(page, 'annotations', `${type}.json`), 'utf8'));
      assert(!('base64' in light.source)); assert.equal(light.annotations.length, 1);
      const full = await download(page, 'html', `${type}.review.html`);
      const gzip = await download(page, 'gzip', `${type}.review.html.gz`);
      const decompressed = path.join(temp, `${type}.unpacked.html`); await writeFile(decompressed, gunzipSync(await readFile(gzip)));
      for (const copy of [full, decompressed]) {
        const exported = JSON.parse((await readFile(copy, 'utf8')).match(/<script id="html-review-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
        assert(Buffer.from(exported.source.base64, 'base64').equals(bytes), 'Exported original bytes remain identical');
        const reopened = await offline.newPage(); observe(reopened); await reopened.goto(pathToFileURL(copy).href); await ready(reopened);
        await reopened.locator(type === 'pdf' ? '.pdf-page[data-page-number="1"][data-rendered=true]' : '#preview-frame[aria-busy=false]').waitFor();
        const restored = await data(reopened);
        assert.equal(restored.source.sha256, before.source.sha256); assert.deepEqual(restored.annotations, before.annotations);
        await reopened.locator('[data-mode=browse]').click(); await reopened.locator('#comment-input').fill('离线继续审阅'); await reopened.locator('#save-button').click();
        assert.equal(await reopened.locator('#annotation-count').textContent(), '2'); await reopened.close();
      }
    }
    checks.push(`${app === packaged ? 'Extracted ZIP' : 'Standalone download'}: legacy import, DOCX/PDF handoff source identity, lightweight JSON, HTML/gzip offline reopen and continued editing`);
    await offline.close();
  }
  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);
  await mkdir(path.join(root, 'test-results'), {recursive:true});
  await writeFile(path.join(root, 'test-results/release-candidate.json'), JSON.stringify({version, status:'PASS', browser:await browser.version(), standaloneSha256:createHash('sha256').update(standalone).digest('hex'), checks, errors, externalRequests}, null, 2));
  checks.forEach(check => console.log('PASS ' + check));
} finally {
  await browser?.close();
  if (server.listening) await new Promise(resolve => server.close(resolve));
  await rm(temp, {recursive:true, force:true});
  console.log('PROCESS_CLEANUP_COMPLETE');
}
