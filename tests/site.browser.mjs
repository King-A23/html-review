import {ensureBackup, openAnnotationData} from './backup-ui.mjs';
/* Verify the deployed subpath, actual downloads and trial persistence in a real browser. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {mkdir, readFile, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const site = path.join(root, '_site');
const output = path.join(root, 'test-results');
await mkdir(output, {recursive:true});
let modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
if (modulePath && (await stat(modulePath)).isDirectory()) modulePath = path.join(modulePath, 'index.mjs');
const {chromium} = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const errors = [], report = [];
const types = {'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.mp4':'video/mp4','.zip':'application/zip','.txt':'text/plain','.json':'application/json'};
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (!pathname.startsWith('/html-review/')) { response.writeHead(404).end(); return; }
    const relative = pathname.slice('/html-review/'.length) || 'index.html';
    const file = path.resolve(site, relative);
    if (!file.startsWith(site + path.sep)) { response.writeHead(403).end(); return; }
    const info = await stat(file);
    if (!info.isFile()) { response.writeHead(404).end(); return; }
    const headers = {'Content-Type':types[path.extname(file)] || 'application/octet-stream', 'Accept-Ranges':'bytes'};
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
    let start = 0, end = info.size-1;
    if (range) {
      start = Number(range[1]); end = range[2] ? Math.min(Number(range[2]), end) : end;
      if (start > end) {response.writeHead(416).end(); return;}
      headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
    }
    headers['Content-Length'] = end-start+1;
    response.writeHead(range ? 206 : 200, headers);
    createReadStream(file, {start, end}).pipe(response);
  } catch (_) { if (!response.headersSent) response.writeHead(404); response.end(); }
});
let browser;
async function snapshotData(page) {
  await openAnnotationData(page);
  const data = JSON.parse(await page.locator('#data-preview').textContent());
  await page.keyboard.press('Escape');
  await page.locator('#data-dialog').waitFor({state:'hidden'});
  return data;
}
async function download(page, locator, filename) {
  const pending = page.waitForEvent('download'); await locator.click();
  const result = await pending;
  assert.equal(result.suggestedFilename(), filename);
  const destination = path.join(output, `site-${filename}`); await result.saveAs(destination);
  assert.equal(await result.failure(), null); return destination;
}
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/html-review/`;
  browser = await chromium.launch({headless:true,...(process.env.BROWSER_PATH ? {executablePath:process.env.BROWSER_PATH} : {})});
  const context = await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  context.on('page', page => {page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog=>dialog.accept());});
  const page = await context.newPage();
  await page.goto(base);
  await page.locator('#quick-demo').evaluate(video => video.play());
  await page.waitForFunction(() => document.querySelector('#quick-demo').currentTime > .1);
  const media = await page.locator('#quick-demo').evaluate(v => ({width:v.videoWidth,height:v.videoHeight,duration:v.duration}));
  assert.equal(media.width,1920); assert.equal(media.height,1080); assert(Math.abs(media.duration-15) < .1);
  await page.waitForFunction(() => document.querySelector('#launch-film').readyState >= 1);
  await page.getByRole('button',{name:'暂停演示 Ⅱ'}).click();
  assert(await page.locator('#quick-demo').evaluate(v=>v.paused));
  await page.getByRole('button',{name:'播放演示 ▷'}).click();
  assert(!await page.locator('#quick-demo').evaluate(v=>v.paused));
  await page.locator('.demo-window').evaluate(e=>Promise.all(e.getAnimations().map(a=>a.finished)));
  await page.mouse.move(5,5);
  await page.screenshot({path:path.join(output,'site-desktop.png'),fullPage:true});
  for (const width of [320,390,768,1024,1440]) {
    await page.setViewportSize({width,height:1000});
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No horizontal overflow at ${width}px`);
    for (const link of await page.locator('.hero .button').all()) assert((await link.boundingBox()).height >= 44);
    if (width===390) await page.screenshot({path:path.join(output,'site-mobile.png'),fullPage:true});
  }
  report.push('Responsive landing page, readable navigation and playable 15-second media');
  await page.setViewportSize({width:1440,height:1000});
  const standalone = await download(page, page.locator('.hero [data-download]'), 'html-review.html');
  assert.deepEqual(await readFile(standalone), await readFile(path.join(root,'index.html')));
  assert(await page.locator('.download-status').isVisible());
  await page.locator('summary').click();
  const {version} = JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
  const zip = await download(page, page.getByRole('link',{name:'下载离线套件 ZIP ↓'}), `html-review-v${version}.zip`);
  assert.deepEqual(await readFile(zip),await readFile(path.join(root,`dist/html-review-v${version}.zip`)));
  report.push('One-click HTML and ZIP downloads match the exact release artifacts');
  const versionInfo = await (await page.request.get(base+'version.json')).json();
  assert.equal(versionInfo.version, version);
  assert.equal(versionInfo.standaloneSha256, createHash('sha256').update(await readFile(standalone)).digest('hex'));
  await page.waitForFunction(() => document.querySelector('#documents-demo').readyState >= 1);
  const documentsMedia = await page.locator('#documents-demo').evaluate(v => ({width:v.videoWidth,height:v.videoHeight,duration:v.duration}));
  assert.deepEqual(documentsMedia, {width:1600,height:1000,duration:20});
  for (const type of ['docx','pdf']) {
    for (const name of [`review.${type}`,`${type}.review.json`]) {
      const result = await page.request.get(base+'examples/documents/'+name);
      assert(result.ok()); assert.deepEqual(await result.body(),await readFile(path.join(root,'examples/documents',name)));
    }
  }
  report.push('New Word/PDF sample downloads and 20-second recording match the release; version endpoint exposes the standalone SHA-256');
  await page.locator('#launch-film').evaluate(v => v.load());
  await page.waitForFunction(() => document.querySelector('#launch-film').readyState >= 1);
  assert(Math.abs(await page.locator('#launch-film').evaluate(v=>v.duration)-62.833) < .2);
  report.push('Full film decodes at its original aspect ratio and duration');
  await page.locator('.hero .primary').click();
  await page.waitForFunction(() => document.querySelector('#source-name')?.textContent === 'demo.html' && !document.querySelector('#download-button').disabled);
  assert.equal(await page.locator('#annotation-count').textContent(),'3');
  assert(await page.locator('.online-bar').isVisible());
  for (const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:1000});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth), `Online workspace fits ${width}px`);
    if(width<=760){await page.locator('#mobile-dock').waitFor({state:'visible'});const preview=await page.locator('.preview-section').boundingBox(),dock=await page.locator('#mobile-dock').boundingBox();assert(preview.y+preview.height<=dock.y,'website navigation does not push reading behind the mobile dock');await page.locator('#mobile-write').click();assert(await page.locator('#comment-input').isVisible());await page.locator('#mobile-reading').click();await page.locator('#review-sidebar').waitFor({state:'hidden'});}
  }
  await page.screenshot({path:path.join(output,'site-online-workspace.png'),fullPage:true});
  await page.locator('[data-mode="browse"]').click();
  const comment = '在线体验新增意见：统一章节标题与图表单位。';
  await page.locator('#comment-input').fill(comment); await page.locator('#save-button').click();
  assert.equal(await page.locator('#annotation-count').textContent(),'4');
  const before = await snapshotData(page);
  const saved = before.annotations.find(a=>a.comment===comment);
  assert(saved, 'Real saved annotation retained');
  await page.waitForFunction(()=>document.querySelector('#autosave-state')?.textContent.includes('本机已保存'));
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#annotation-count')?.textContent === '4');
  assert.equal((await snapshotData(page)).annotations.find(a=>a.id===saved.id).comment, comment);
  report.push('Trial opens without a second click and refresh preserves user changes');
  const other = await context.newPage(); await other.goto(base+'app.html?demo=1');
  await other.waitForFunction(()=>!document.querySelector('#open-button').disabled);
  assert(await other.locator('#recovery-banner').isVisible());
  assert.equal(await other.locator('#source-name').textContent(),'尚未打开页面');
  await other.locator('#recover-session').click();
  await other.waitForFunction(()=>document.querySelector('#annotation-count').textContent==='4');
  assert.equal((await snapshotData(other)).annotations.find(a=>a.id===saved.id).comment,comment);
  await other.close();
  report.push('A newly opened trial preserves pending recovery instead of overwriting it');
  await ensureBackup(page); const review = await download(page,page.locator('#download-button'),'demo.review.html');
  const copy = await readFile(review,'utf8');
  assert(!/<(?:style|nav)[^>]*data-site-only/.test(copy)); assert(!copy.includes('class="online-bar"'));
  const offline = await context.newPage(); await offline.goto(pathToFileURL(review).href);
  await offline.waitForFunction(()=>document.querySelector('#annotation-count')?.textContent==='4');
  assert.equal((await snapshotData(offline)).annotations.find(a=>a.id===saved.id).comment,comment);
  assert.equal(await offline.locator('.online-bar').count(),0);
  assert.equal(await offline.locator('[data-site-only]').count(),0);
  await offline.screenshot({path:path.join(output,'site-offline-copy.png'),fullPage:true});
  report.push('Online review downloads reopen offline with annotations and without website navigation');
  for (const type of ['docx','pdf']) {
    const docs = await context.newPage(); await docs.goto(base+'app.html');
    await docs.waitForFunction(()=>!document.querySelector('#open-button').disabled);
    await docs.locator('#file-input').setInputFiles(path.join(root,'examples/documents',`${type}.review.json`));
    await docs.locator('#pair-source').waitFor({state:'visible'});
    await docs.locator('#file-input').setInputFiles(path.join(root,'examples/documents',`review.${type}`));
    await docs.waitForFunction(()=>!document.querySelector('#open-button').disabled && document.querySelector('#annotation-count').textContent==='2');
    await docs.locator(type==='pdf'?'.pdf-page[data-page-number="1"][data-rendered=true]':'#preview-frame[aria-busy=false]').waitFor();
    const sample = JSON.parse(await readFile(path.join(root,'examples/documents',`${type}.review.json`),'utf8'));
    assert.equal((await snapshotData(docs)).source.sha256,sample.source.sha256);
    assert.equal((await snapshotData(docs)).annotations.length,2); await docs.close();
  }
  report.push('Online app restores the actual DOCX/PDF sample JSON with its matching original');
  const reduced = await browser.newContext({reducedMotion:'reduce',viewport:{width:390,height:900}});
  const quiet = await reduced.newPage(); await quiet.goto(base);
  assert(await quiet.locator('#quick-demo').evaluate(v=>v.paused));
  assert.equal(await quiet.locator('.hero-copy').evaluate(e=>getComputedStyle(e).animationName),'none');
  report.push('Reduced-motion preference disables entry animation and video autoplay');
  assert.deepEqual(errors,[]);
  console.log(`${report.length} website acceptance groups passed.`);
} finally {
  if (browser) await browser.close();
  await new Promise(resolve=>server.close(resolve));
  await writeFile(path.join(output,'site-report.json'),JSON.stringify({passed:report,errors},null,2));
}
