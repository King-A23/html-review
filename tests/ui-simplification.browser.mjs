/* User-facing workflow regression: welcome, recoverable pickers, handoff and DOCX reading. */
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdtemp, rm, stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createDocxFixture} from './docx-fixtures.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
let modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
if (modulePath && (await stat(modulePath)).isDirectory()) modulePath = path.join(modulePath, 'index.mjs');
const {chromium} = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const temp = await mkdtemp(path.join(os.tmpdir(), 'html-review-simplification-'));
const source = path.join(temp, 'reading.docx');
const htmlSource = path.join(temp, 'page.html');
const contexts = []; let browser; let lateServer;
const ready = page => page.waitForFunction(() => !document.getElementById('open-button').disabled);
const frame = page => page.frameLocator('#preview-frame');
async function newPage(url = pathToFileURL(path.join(root, 'index.html')).href, picker = false) {
  const context = await browser.newContext({viewport:{width:1440,height:1000}, acceptDownloads:true}); contexts.push(context);
  await context.addInitScript(({picker}) => {
    window.showDirectoryPicker = undefined;
    window.showOpenFilePicker = picker ? () => new Promise((resolve,reject) => {window.__resolvePicker=resolve;window.__rejectPicker=reject;}) : undefined;
    Object.defineProperty(navigator, 'clipboard', {configurable:true,value:{writeText:async text => {window.__copied=text; if(window.__clipboardFail) throw new Error('clipboard unavailable');}}});
  }, {picker});
  const page = await context.newPage(); page.on('dialog', dialog => dialog.accept());
  await page.goto(url); await ready(page); return page;
}
async function open(page, file) { await page.locator('#file-input').setInputFiles(file); await ready(page); }
async function download(page, button, filename) {
  const pending=page.waitForEvent('download'); await page.locator(button).click();
  const output=path.join(temp,filename); await (await pending).saveAs(output); return output;
}
async function exportJSON(page, filename) {
  await page.locator('#export-format').selectOption('annotations');
  const output=await download(page,'#download-button',filename); return JSON.parse(await readFile(output,'utf8'));
}
async function draftSnapshot(page) {
  return page.evaluate(() => ({comment:document.getElementById('comment-input').value,target:document.getElementById('target-text').textContent,selector:document.getElementById('target-selector').textContent,targetHidden:document.getElementById('target-preview').hidden,count:document.getElementById('annotation-count').textContent,saveDisabled:document.getElementById('save-button').disabled}));
}
async function saveWhole(page, text) { await page.locator('[data-mode=whole]').click(); await page.locator('#comment-input').fill(text); await page.locator('#save-button').click(); }
async function importFeedback(page, annotations, states, filename) {
  const results = {format:'html-review-results',schemaVersion:1,batchId:randomUUID(),results:states.map(([index,status]) => ({id:annotations[index].id,revision:annotations[index].revision,annotationUpdatedAt:annotations[index].updatedAt,status,summary:'已核对修改结果',by:'agent',at:new Date().toISOString()}))};
  const output=path.join(temp,filename); await writeFile(output,JSON.stringify(results));
  await page.locator('#results-input').setInputFiles(output); await ready(page);
}
try {
  await writeFile(source,await createDocxFixture());
  await writeFile(htmlSource,'<!doctype html><meta charset="utf-8"><h1>HTML page mode</h1><p>Compatible original</p>');
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
  const page=await newPage();
  assert(await page.locator('#welcome-open').isVisible());
  assert.match(await page.locator('#welcome-open').textContent(),/打开/);
  assert.match(await page.locator('#welcome-open').evaluate(n=>n.closest('section').textContent),/HTML.*Word/);
  assert(await page.locator('#example-button').isVisible());
  for(const id of ['#comment-input','#save-button','#import-results','#copy-agent-task','#undo-button','#annotation-filter']) assert.equal(await page.locator(id).isVisible(),false,`Empty workspace hides later-stage control ${id}`);
  assert.equal(await page.locator('.workspace').evaluate(n=>n.classList.contains('has-document')),false);
  const chooser=page.waitForEvent('filechooser'); await page.locator('#welcome-open').click(); await (await chooser).setFiles(source); await ready(page);
  await frame(page).locator('h1').filter({hasText:'正文与定位'}).waitFor();
  assert(await page.locator('#comment-input').isVisible()); assert(await page.locator('#import-results').isVisible());
  assert.equal(await page.locator('.workspace').evaluate(n=>n.classList.contains('has-document')),true);
  assert.equal(await page.locator('#handoff-button').isVisible(),false);
  console.log('PASS welcome reveals the real open action and hides unusable workflow controls');

  await page.locator('[data-mode=element]').click(); await frame(page).locator('p').filter({hasText:/^重复段落 Duplicate paragraph$/}).first().click();
  await page.locator('#target-text').filter({hasText:'重复段落 Duplicate paragraph'}).waitFor();
  await page.locator('#comment-input').fill('导航期间保留的草稿');
  const beforeNav=await draftSnapshot(page);
  await page.locator('#document-nav-button').click(); await page.locator('#document-nav-dialog').waitFor({state:'visible'});
  assert.match(await page.locator('#document-outline').textContent(),/正文与定位/);
  // Put the title below a long spacer to prove navigation really scrolls the document.
  await frame(page).locator('h1').filter({hasText:'正文与定位'}).evaluate(n=>{const spacer=document.createElement('div');spacer.dataset.htmlReviewOwned='true';spacer.style.height='1800px';n.before(spacer);window.scrollTo(0,0);});
  await page.locator('#document-outline button').filter({hasText:'正文与定位'}).click();
  await page.locator('#document-nav-dialog').waitFor({state:'hidden'});
  assert(await frame(page).locator('body').evaluate(()=>window.scrollY>0),'Outline jump scrolls inside the preview');
  assert.deepEqual(await draftSnapshot(page),beforeNav,'Outline navigation preserves draft and selected annotation target');
  await page.locator('#document-nav-button').click(); await page.locator('#document-search').fill('重复段落');
  await page.waitForFunction(()=>document.querySelectorAll('#document-search-results button').length>=2);
  assert.equal(await page.locator('#document-search-results button').count(),2,'Search preserves distinct matches for repeated paragraphs');
  await page.locator('#document-search-results button').last().click(); await page.locator('#document-nav-dialog').waitFor({state:'hidden'});
  assert.deepEqual(await draftSnapshot(page),beforeNav,'Search jumps do not create or replace annotation targets');
  const searchedPosition=await frame(page).locator('p').filter({hasText:/^重复段落 Duplicate paragraph$/}).nth(1).evaluate(n=>({top:n.getBoundingClientRect().top,bottom:n.getBoundingClientRect().bottom,height:innerHeight}));
  assert(searchedPosition.top>=0&&searchedPosition.bottom<=searchedPosition.height,'Search result brings the corresponding paragraph into view');
  await page.locator('#save-button').click();
  assert(await page.locator('#handoff-button').isVisible());
  await page.locator('#comment-input').fill('尚未保存的意见'); assert(await page.locator('#handoff-button').isDisabled());
  await page.locator('#cancel-edit').click();
  for (const text of ['第二条','第三条','第四条']) await saveWhole(page,text);
  let review=await exportJSON(page,'first.json'); assert.equal(review.annotations.length,4);
  await importFeedback(page,review.annotations,[[0,'resolved'],[1,'resolved'],[2,'open']],'feedback.json');
  assert(await page.locator('#status').getByRole('button',{name:'读取修改后的文档'}).isVisible());
  const id=review.annotations[1].id;
  await page.locator(`.annotation-card[data-annotation-id="${id}"] [data-action=edit]`).click();
  await page.locator('#comment-input').fill('修改已处理的意见'); await page.locator('#save-button').click();
  await page.locator('#handoff-button').click();
  assert.match(await page.locator('#handoff-source').textContent(),/reading\.docx/);
  assert.match(await page.locator('#agent-task-dialog').textContent(),/附上原文档/);
  const summary=await page.locator('#handoff-summary').textContent();
  for(const state of ['新增','更新','待处理','已完成']) assert.match(summary,new RegExp(`(?:${state}\\s*1|1\\s*(?:条)?\\s*${state})`),`Handoff summarizes ${state}: ${summary}`);
  assert.equal(await page.locator('#task-details').evaluate(n=>n.open),false);
  await page.locator('#export-format').selectOption('html');
  const jsonPath=await download(page,'#handoff-export-json','handoff.json');
  assert.equal(await page.locator('#export-format').inputValue(),'html','Handoff JSON does not mutate the main export choice');
  assert.equal(JSON.parse(await readFile(jsonPath,'utf8')).annotations.length,4);
  await page.evaluate(()=>window.__clipboardFail=true); await page.locator('#copy-agent-text').click();
  assert.equal(await page.locator('#task-details').evaluate(n=>n.open),true);
  assert(await page.locator('#agent-task-text').evaluate(n=>document.activeElement===n&&n.selectionStart===0&&n.selectionEnd===n.value.length),'Failed clipboard selects the full manual-copy task');
  await page.locator('[data-close="agent-task-dialog"]').click(); await page.locator('#copy-agent-task').click();
  await page.locator('#agent-task-dialog').waitFor({state:'visible'}); assert.equal(await page.locator('#task-details').evaluate(n=>n.open),true);
  await page.locator('[data-close="agent-task-dialog"]').click();
  console.log('PASS handoff preserves export preferences, summarizes all task states, and handles unavailable clipboard');

  // Re-import results with a fresh batch while drafting, then use the status action's actual chooser.
  review=await exportJSON(page,'next.json'); await page.locator('[data-mode=whole]').click(); await page.locator('#comment-input').fill('读取修改后仍保留的草稿');
  await importFeedback(page,review.annotations,[[3,'open']],'next-feedback.json');
  const beforeReload=await draftSnapshot(page); const reloadChooser=page.waitForEvent('filechooser');
  await page.locator('#status').getByRole('button',{name:'读取修改后的文档'}).click(); await (await reloadChooser).setFiles(source); await ready(page);
  assert.deepEqual(await draftSnapshot(page),beforeReload,'Result follow-up reload preserves draft and target');
  await page.locator('#cancel-edit').click();
  await page.locator('#document-nav-button').click(); await page.locator('#document-search').fill('Duplicate');
  await page.waitForFunction(()=>document.querySelectorAll('#document-search-results button').length>0); await page.locator('[data-close="document-nav-dialog"]').click();
  await page.locator('#handoff-button').click(); await page.locator('[data-close="agent-task-dialog"]').click();
  await page.locator('#export-format').selectOption('html'); const full=await download(page,'#download-button','offline.html');
  const fullText=await readFile(full,'utf8');
  const snapshot=(await readFile(source)).toString('base64');
  assert.equal(fullText.split(snapshot).length-1,1,'Full review carries exactly one original DOCX snapshot');
  const offline=await newPage(pathToFileURL(full).href); const external=[]; offline.on('request',req=>{if(/^https?:/.test(req.url()))external.push(req.url());});
  await frame(offline).locator('h1').filter({hasText:'正文与定位'}).waitFor();
  const exportedTransient=await offline.evaluate(text=>{const d=new DOMParser().parseFromString(text,'text/html');return {outline:d.getElementById('document-outline').textContent,search:d.getElementById('document-search-results').textContent,task:d.getElementById('agent-task-text').textContent};},fullText);
  assert.deepEqual(exportedTransient,{outline:'',search:'',task:''},'Export omits generated directory, search results and task text');
  await offline.locator('#document-nav-button').click(); assert.match(await offline.locator('#document-outline').textContent(),/正文与定位/);
  await offline.locator('#document-search').fill('Duplicate'); await offline.waitForFunction(()=>document.querySelectorAll('#document-search-results button').length>=2);
  assert.equal(external.length,0,'Reopened DOCX navigation works offline');
  console.log('PASS result follow-up retains drafts and exported copies rebuild reading controls offline');

  // An already-open empty tab must learn about a save that did not exist at startup.
  const app=await readFile(path.join(root,'index.html'));
  lateServer=createServer((_request,response)=>{response.setHeader('Content-Type','text/html;charset=utf-8');response.end(app);});
  await new Promise(resolve=>lateServer.listen(0,'127.0.0.1',resolve));
  const lateURL=`http://127.0.0.1:${lateServer.address().port}/`;
  const observer=await newPage(lateURL); const shared=observer.context();
  assert.equal(await observer.locator('#recovery-banner').isVisible(),false);
  assert.equal(await observer.evaluate(url=>HRSession.load('workspace:'+url),lateURL),null);
  const writer=await shared.newPage();writer.on('dialog',d=>d.accept());await writer.goto(lateURL);await ready(writer);
  await open(writer,source);await saveWhole(writer,'迟到保存中的批注');await writer.locator('#comment-input').fill('迟到保存中的草稿');
  await writer.waitForFunction(async url=>(await HRSession.load('workspace:'+url))?.draft?.comment==='迟到保存中的草稿',lateURL);
  await observer.locator('#recovery-banner').waitFor({state:'visible'});
  assert.equal(await observer.locator('#comment-input').isVisible(),false,'Saved signal prompts without activating a document');
  // A loaded, deliberately selected document must ignore another tab's later saves.
  const protectedPage=await shared.newPage();await protectedPage.addInitScript(()=>window.addEventListener('message',event=>{if(event.data?.hr && event.data.event==='ready')window.__bridgeReady=event.data;}));protectedPage.on('dialog',d=>d.accept());await protectedPage.goto(lateURL);await ready(protectedPage);await open(protectedPage,htmlSource);
  await protectedPage.waitForFunction(async url=>(await HRSession.load('workspace:'+url))?.data?.source?.name==='page.html',lateURL);
  await protectedPage.waitForFunction(()=>document.getElementById('autosave-state').textContent.includes('本机已保存'));
  const protectedBefore=await draftSnapshot(protectedPage);
  await writer.locator('#comment-input').fill('迟到保存更新后的草稿');
  await writer.waitForFunction(async url=>(await HRSession.load('workspace:'+url))?.draft?.comment==='迟到保存更新后的草稿',lateURL);
  await frame(protectedPage).locator('h1').filter({hasText:'HTML page mode'}).waitFor();
  const delayedReady=await protectedPage.evaluate(()=>window.__bridgeReady);assert(delayedReady,'Capture the genuine preview ready message');
  await frame(protectedPage).locator('body').evaluate((_body,message)=>parent.postMessage(message,'*'),delayedReady);
  await writer.waitForTimeout(400);
  const latest=await observer.evaluate(url=>HRSession.load('workspace:'+url),lateURL);
  assert.equal(latest.data.source.name,'reading.docx','A late preview-ready UI update must not overwrite another tab’s new save');
  assert.equal(latest.data.annotations.length,1);
  assert.deepEqual(await draftSnapshot(protectedPage),protectedBefore,'Saved signal cannot overwrite an already-loaded workspace');
  assert.equal(await protectedPage.locator('#source-name').textContent(),'page.html');
  await frame(protectedPage).locator('h1').filter({hasText:'HTML page mode'}).waitFor();
  assert.equal(await protectedPage.locator('#recovery-banner').isVisible(),false);
  await observer.locator('#recover-session').click();await ready(observer);
  assert.equal(await observer.locator('#annotation-count').textContent(),'1');
  assert.equal(await observer.locator('#comment-input').inputValue(),'迟到保存更新后的草稿');
  await frame(observer).locator('h1').filter({hasText:'正文与定位'}).waitFor();
  console.log('PASS a later save offers recovery to an empty tab and preserves an already-loaded workspace');

  for(const late of ['resolve','reject']) {
    const picked=await newPage(undefined,true); await open(picked,htmlSource); await saveWhole(picked,'已保存意见');
    await picked.locator('#comment-input').fill('选择窗口期间的草稿'); const before=await draftSnapshot(picked);
    await picked.locator('#open-button').click(); assert.match(await picked.locator('#status').textContent(),/系统窗口/);
    assert.equal((await picked.locator('#cancel-conversion').textContent()).trim(),'取消选择');
    if(late==='resolve') await picked.locator('#cancel-conversion').click();
    else { const fallbackChooser=picked.waitForEvent('filechooser'); await picked.locator('#status').getByRole('button',{name:'使用兼容选择'}).click(); await (await fallbackChooser).setFiles(htmlSource); }
    await ready(picked);
    const settledBefore=await draftSnapshot(picked);
    await picked.evaluate(late=>{if(late==='resolve')window.__resolvePicker([{getFile:async()=>new File(['<h1>LATE SOURCE MUST NOT LOAD</h1>'],'late.html',{type:'text/html'})}]);else window.__rejectPicker(new DOMException('late rejection','SecurityError'));},late);
    await picked.waitForTimeout(150); assert.deepEqual(await draftSnapshot(picked),settledBefore,'Late native picker cannot mutate workspace');
    assert.equal(await picked.locator('#source-name').textContent(),'page.html');
    if(late==='resolve')assert.deepEqual(await draftSnapshot(picked),before,'Cancel preserves original saved annotations and draft');
    assert.equal(await picked.locator('#document-nav-button').isVisible(),false);
    assert(await picked.locator('[data-mode=page]').isVisible());
  }
  console.log('PASS native chooser remains cancellable, compatible chooser is real, and late promises cannot replace the workspace');
} finally {
  await Promise.allSettled(contexts.map(context=>context.close())); await browser?.close(); if(lateServer)await new Promise(resolve=>lateServer.close(resolve)); await rm(temp,{recursive:true,force:true}); console.log('PROCESS_CLEANUP_COMPLETE');
}
