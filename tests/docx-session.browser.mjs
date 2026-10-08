import {ensureBackup} from './backup-ui.mjs';
/* Native OPFS handles, persisted DOCX sessions, directory feedback, gzip and CLI pairing. */
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdtemp, rm, stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:http';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createDocxFixture} from './docx-fixtures.mjs';
import {prepareReview} from '../bin/html-review.mjs';
import {runPython} from '../scripts/python.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
let modulePath=process.env.PLAYWRIGHT_MODULE_PATH;
if(modulePath&&(await stat(modulePath)).isDirectory())modulePath=path.join(modulePath,'index.mjs');
const {chromium}=await import(modulePath?pathToFileURL(modulePath).href:'playwright');
const app=await readFile(path.join(root,'index.html'));
const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(app);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/`;
const temp=await mkdtemp(path.join(os.tmpdir(),'html-review-docx-session-'));
const contexts=[];let browser;
const ready=page=>page.waitForFunction(()=>!document.getElementById('open-button').disabled);
const frame=page=>page.frameLocator('#preview-frame');
async function nativeWrite(page,name,bytes) {
  await page.evaluate(async({name,base64})=>{
    const root=await navigator.storage.getDirectory();const handle=await root.getFileHandle(name,{create:true});
    const writer=await handle.createWritable();await writer.write(Uint8Array.from(atob(base64),c=>c.charCodeAt(0)));await writer.close();
  },{name,base64:Buffer.from(bytes).toString('base64')});
}
async function exported(page,format,name) {
  await ensureBackup(page); await page.locator('#export-format').selectOption(format);const pending=page.waitForEvent('download');await ensureBackup(page); await page.locator('#download-button').click();
  const output=path.join(temp,name);await(await pending).saveAs(output);return output;
}
async function stableSave(page,comment,sourceHash,completedId) {
  // Unchanged draft text and directory access also match the preceding source
  // snapshot. Wait for this reload and its feedback before opening a new tab.
  // waitForFunction treats this asynchronous IndexedDB predicate as a truthy
  // Promise. Explicitly await each read so the barrier observes persisted data.
  await page.evaluate(async({key,comment,sourceHash,completedId})=>{
    const deadline=performance.now()+8000;
    while(performance.now()<deadline) {
      const r=await window.HRSession.load(key);
      if(r?.draft?.comment===comment && r?.localAccess?.directoryHandle?.kind==='directory' &&
        r?.data?.source?.sha256===sourceHash &&
        r.data.annotations.some(annotation=>annotation.id===completedId && window.HRCore.annotationStatus(annotation)==='resolved')) return;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw new Error('Latest DOCX source, feedback and draft were not persisted before recovery');
  },{key:'workspace:'+url,comment,sourceHash,completedId});
}
try {
  const native=await chromium.launchPersistentContext('',{headless:true,acceptDownloads:true,viewport:{width:1440,height:1000},...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});contexts.push(native);
  await native.addInitScript(()=>{
    window.__pickerCounts={file:0,directory:0};
    window.__cancelPick=false;window.showOpenFilePicker=async()=>{++window.__pickerCounts.file;if(window.__cancelPick)throw new DOMException('cancelled','AbortError');return[await(await navigator.storage.getDirectory()).getFileHandle('review.docx')];};
    window.showDirectoryPicker=async()=>{++window.__pickerCounts.directory;return navigator.storage.getDirectory();};
  });
  let recoveryConfirms=0;
  const page=await native.newPage();page.setDefaultTimeout(8000);page.on('dialog',d=>{if(d.type()==='confirm')recoveryConfirms++;d.accept();});await page.goto(url);await ready(page);
  const base=await createDocxFixture();const inserted=await createDocxFixture('inserted');const changed=await createDocxFixture('changed');
  await nativeWrite(page,'review.docx',base);await nativeWrite(page,'companion.xhtml',Buffer.from('<!doctype html><title>Companion</title><p>兼容 XHTML 文件</p>'));
  await page.locator('#open-button').click();await ready(page);await frame(page).locator('body').filter({hasText:'正文与定位'}).waitFor();
  await page.locator('[data-mode=whole]').click();await page.locator('#comment-input').fill('完整文档的保存批注');await page.locator('#save-button').click();
  const first=await exported(page,'annotations','first.review.json');const firstData=JSON.parse(await readFile(first,'utf8'));
  await page.locator('#comment-input').fill('原生重载保留草稿');await nativeWrite(page,'review.docx',inserted);
  await page.locator('#reload-preview').click();await ready(page);await frame(page).locator('body').filter({hasText:'Inserted paragraph'}).waitFor();
  assert.equal(await page.locator('#annotation-count').textContent(),'1');assert.equal(await page.locator('#comment-input').inputValue(),'原生重载保留草稿');
  assert.deepEqual(await page.evaluate(()=>window.__pickerCounts),{file:1,directory:0});
  console.log('PASS native DOCX file: fresh handle reads changed bytes with no second picker, keeping annotations and draft');
  await page.locator('#folder-button').click();await ready(page);await page.locator('#entry-select').filter({has:page.locator('option[value="review.docx"]')}).waitFor({state:'attached'});
  assert.equal(await page.locator('#entry-select').inputValue(),'review.docx');assert.equal(await page.locator('#annotation-count').textContent(),'1');
  assert.deepEqual(await page.locator('#entry-select option').evaluateAll(options=>options.map(option=>option.value)),['companion.xhtml','review.docx'],'Directory entries retain DOCX and XHTML candidates');
  const resultFile=path.join(temp,'review.review-results.json');
  await runPython([path.join(root,'scripts/update_review.py'),first,'--id',firstData.annotations[0].id,'--status','resolved','--summary','已核对并完成整份文档','--output',resultFile]);
  await nativeWrite(page,'review.review-results.json',await readFile(resultFile));await nativeWrite(page,'review.docx',changed);
  await page.locator('#reload-preview').click();await ready(page);try {await frame(page).locator('body').filter({hasText:'Inserted paragraph'}).waitFor({timeout:5000});} catch(e){console.error('directory reload',await page.locator('#status').textContent(),await page.locator('#source-name').textContent());throw e;}
  await page.locator(`.annotation-card[data-annotation-id="${firstData.annotations[0].id}"][data-review-state=completed]`).waitFor();
  assert(!(await frame(page).locator('body').textContent()).includes('Delete this paragraph'));
  assert.equal(await page.locator('#comment-input').inputValue(),'原生重载保留草稿');
  assert.deepEqual(await page.evaluate(()=>window.__pickerCounts),{file:1,directory:1});
  await stableSave(page,'原生重载保留草稿',createHash('sha256').update(changed).digest('hex'),firstData.annotations[0].id);
  // A new tab is genuinely empty; changing sessionStorage before a reload can
  // race with a pending autosave and does not model this user action reliably.
  const recoveryPage=await native.newPage();recoveryConfirms=0;recoveryPage.setDefaultTimeout(8000);
  recoveryPage.on('dialog',d=>{if(d.type()==='confirm')recoveryConfirms++;d.accept();});
  await recoveryPage.goto(url);await ready(recoveryPage);await recoveryPage.locator('#recovery-banner').waitFor({state:'visible'});await recoveryPage.locator('#recover-session').click();await ready(recoveryPage);
  await frame(recoveryPage).locator('body').filter({hasText:'Inserted paragraph'}).waitFor();
  assert.equal(recoveryConfirms,0,'Recovering into an empty workspace must not ask to discard anything');
  assert.equal(await recoveryPage.locator('#annotation-count').textContent(),'1');assert.equal(await recoveryPage.locator('#comment-input').inputValue(),'原生重载保留草稿');
  assert.deepEqual(await recoveryPage.locator('#entry-select option').evaluateAll(options=>options.map(option=>option.value)),['companion.xhtml','review.docx'],'An empty tab recovers all supported directory entry extensions');
  // Keep the recovered handle-owning tab alive until context cleanup. Closing it
  // immediately before reload crashes macOS Chromium in native raw_ptr handling.
  await page.reload();await ready(page);await frame(page).locator('body').filter({hasText:'Inserted paragraph'}).waitFor();
  assert.equal(await page.locator('#entry-select').inputValue(),'review.docx');assert.equal(await page.locator('#annotation-count').textContent(),'1');assert.equal(await page.locator('#comment-input').inputValue(),'原生重载保留草稿');
  assert.deepEqual(await page.locator('#entry-select option').evaluateAll(options=>options.map(option=>option.value)),['companion.xhtml','review.docx'],'Same-tab restore keeps all supported directory entry extensions');
  await nativeWrite(page,'review.docx',base);await page.locator('#reload-preview').click();await ready(page);await frame(page).locator('body').filter({hasText:'Delete this paragraph'}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.__pickerCounts),{file:0,directory:0});
  assert.equal(await page.locator('#comment-input').inputValue(),'原生重载保留草稿');
  console.log('PASS native DOCX directory: feedback loads with new bytes; browser refresh restores annotations, draft and genuine directory handle');
  await page.evaluate(()=>{window.__cancelPick=true;});await page.locator('#open-button').click();await ready(page);
  await page.locator('#status').filter({hasText:'已取消选择'}).waitFor();assert.equal(await page.locator('#comment-input').inputValue(),'原生重载保留草稿');
  await page.evaluate(async()=>{window.__cancelPick=false;await(await navigator.storage.getDirectory()).removeEntry('review.docx');});
  await page.locator('#reload-preview').click();await ready(page);await page.locator('#status').filter({hasText:'找不到'}).waitFor();
  assert.equal(await page.locator('#annotation-count').textContent(),'1');assert.equal(await page.locator('#comment-input').inputValue(),'原生重载保留草稿');
  assert((await frame(page).locator('body').textContent()).includes('Delete this paragraph'));await nativeWrite(page,'review.docx',base);
  await page.locator('#cancel-edit').click();const beforePair=await exported(page,'annotations','before-pair.review.json');
  const pairData=JSON.parse(await readFile(beforePair,'utf8'));pairData.annotations[0].comment='轻量 JSON 配对恢复后的批注';
  const linkedJSON=path.join(temp,'linked-pair.json');await writeFile(linkedJSON,JSON.stringify(pairData));
  await page.locator('#file-input').setInputFiles(linkedJSON);await ready(page);await page.locator('#pair-source').waitFor({state:'visible'});
  await page.locator('#open-button').click();await ready(page);await page.locator('#pair-source').waitFor({state:'hidden'});
  assert.equal(await page.locator('.annotation-comment').textContent(),'轻量 JSON 配对恢复后的批注');
  console.log('PASS linked folder: canceled picker and missing source keep workspace; native same-folder DOCX honors pending JSON annotations');
  const light=await exported(page,'annotations','paired.review.json');
  const gzip=await exported(page,'gzip','review.review.html.gz');const offlineFile=path.join(temp,'review.offline.html');await writeFile(offlineFile,gunzipSync(await readFile(gzip)));
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
  const offlineContext=await browser.newContext();contexts.push(offlineContext);const offline=await offlineContext.newPage();const requests=[];offline.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  await offline.goto(pathToFileURL(offlineFile).href);await ready(offline);await frame(offline).locator('body').filter({hasText:'正文与定位'}).waitFor();
  assert.equal(await offline.locator('#annotation-count').textContent(),'1');assert.equal(await offline.locator(`.annotation-card[data-annotation-id="${firstData.annotations[0].id}"]`).getAttribute('data-review-state'),'completed');
  assert.deepEqual(requests,[]);
  const docxFile=path.join(temp,'review.docx');await writeFile(docxFile,base);const pairing=await prepareReview(light);
  const pairContext=await browser.newContext();contexts.push(pairContext);const pair=await pairContext.newPage();pair.on('dialog',d=>d.accept());
  await pair.goto(pathToFileURL(pairing).href);await ready(pair);await pair.locator('#pair-source').waitFor({state:'visible'});
  await pair.locator('#file-input').setInputFiles(docxFile);await ready(pair);await frame(pair).locator('body').filter({hasText:'正文与定位'}).waitFor();
  assert.equal(await pair.locator('#annotation-count').textContent(),'1');assert.equal(await pair.locator('#pair-source').isVisible(),false);
  const restored=JSON.parse(await readFile(await exported(pair,'annotations','cli-restored.review.json'),'utf8'));
  const originalLight=JSON.parse(await readFile(light,'utf8'));assert.deepEqual(restored.annotations,originalLight.annotations);assert.equal(restored.source.sha256,originalLight.source.sha256);
  console.log('PASS DOCX gzip: decompressed full copy restores offline; CLI-generated JSON pairing workspace restores against actual source bytes');
} finally {
  await Promise.allSettled(contexts.map(c=>c.close()));await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(temp,{recursive:true,force:true});console.log('PROCESS_CLEANUP_COMPLETE');
}
