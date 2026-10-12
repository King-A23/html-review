import {ensureBackup, openAnnotationData} from './backup-ui.mjs';
/* Real file-input reloads; genuine bridge messages, OOXML variants, exports and reopen. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import JSZip from 'jszip';
import {createDocxFixture} from './docx-fixtures.mjs';
import {readFile,writeFile,mkdtemp,mkdir,rm,copyFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {runPython} from '../scripts/python.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const temp=await mkdtemp(path.join(os.tmpdir(),'reload-review-'));
const server=createServer(async (_req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(await readFile(path.join(root,'index.html')));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/`;
let browser;
const ready=page=>page.waitForFunction(()=>!document.getElementById('open-button').disabled);
const frame=page=>page.frameLocator('#preview-frame');
const card=(page,id)=>page.locator(`.annotation-card[data-annotation-id="${id}"]`);
async function data(page){await openAnnotationData(page);const value=JSON.parse(await page.locator('#data-preview').textContent());await page.locator('#data-dialog [data-close]').click();await page.locator('#data-dialog').waitFor({state:'hidden'});return value;}
async function download(page,format,name){await ensureBackup(page); await page.locator('#export-format').selectOption(format);const event=page.waitForEvent('download');await ensureBackup(page); await page.locator('#download-button').click();const file=path.join(temp,name);await(await event).saveAs(file);return file;}
async function selectText(page,text,index=0){await page.locator('[data-mode=text]').click();await frame(page).locator('p').filter({hasText:text}).nth(index).evaluate(p=>{const range=document.createRange();range.selectNodeContents(p);getSelection().removeAllRanges();getSelection().addRange(range);p.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});await page.locator('#target-text').filter({hasText:text}).waitFor();}
async function save(page,comment){await page.locator('#comment-input').fill(comment);await page.locator('#save-button').click();}
async function reload(page,file){const chooser=page.waitForEvent('filechooser');await page.locator('#reload-preview').click();await(await chooser).setFiles(file);await ready(page);}
const unique='唯一移动段落 Unique relocation';
const deleted='需要删除的段落 Delete this paragraph';
const duplicate='重复段落 Duplicate paragraph';
const replacement='新定位目标 Replacement target';
const filler=Array.from({length:45},(_,i)=>`滚动填充段落 ${i}`);
async function fixture(type,changed=false){
 if(type==='html'){
  const blocks=[...filler.slice(0,20),...(changed?[]:[deleted]),duplicate,duplicate,...(changed?[]:[duplicate]),...(changed?[]:[unique]),replacement,...filler.slice(20),...(changed?[unique]:[])];
  return Buffer.from(`<!doctype html><meta charset="utf-8"><style>p{margin:40px 0}</style><body>${blocks.map((text,i)=>`<p id="p${i}">${text}</p>`).join('')}</body>`);
 }
 const zip=await JSZip.loadAsync(await createDocxFixture());
 let xml=await zip.file('word/document.xml').async('string');
 const p=text=>`<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
 xml=xml.replace('<w:body>','<w:body>'+filler.slice(0,20).map(p).join('')+p(unique)+p(replacement));
 xml=xml.replace('<w:sectPr>',filler.slice(20).map(p).join('')+(changed?p(unique):'')+'<w:sectPr>');
 if(changed){xml=xml.replace(p(unique),'').replace(p(deleted),'');const first=xml.indexOf(p(duplicate)),second=xml.indexOf(p(duplicate),first+p(duplicate).length);assert(second>first);xml=xml.slice(0,second)+xml.slice(second+p(duplicate).length);}
 zip.file('word/document.xml',xml);return zip.generateAsync({type:'nodebuffer'});
}
try{
 browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
 for(const type of ['docx','html']){
  const context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1000}});
  await context.addInitScript(()=>{
   window.showOpenFilePicker=undefined;window.showDirectoryPicker=undefined;
   window.__checks=[];
   // Installed before the bridge. Snapshots prove each verification batch is read-only.
   window.addEventListener('message',event=>{
    if(event.data?.command==='locate'){window.__locateCommands ||= [];window.__locateCommands.push(event.data);}
    if(event.data?.event==='located'){window.__locatedPackets ||= [];window.__locatedPackets.push(event.data);if(window.__dropLocated){event.stopImmediatePropagation();return;}}
    if(event.data?.event==='targets-checked'){window.__checkedPackets ||= [];window.__checkedPackets.push(event.data);if(window.__dropChecks){event.stopImmediatePropagation();return;}}
    if(event.data?.command!=='check-targets')return;
    if(!window.__checks.length){window.scrollTo(0,220);const p=document.querySelector('p');if(p){const r=document.createRange();r.selectNodeContents(p);getSelection().removeAllRanges();getSelection().addRange(r);}}
    const before={scroll:scrollY,selection:getSelection().toString()};
    const check={items:event.data.items.map(item=>({id:item.id,revision:item.revision})),before};window.__checks.push(check);
    queueMicrotask(()=>{check.after={scroll:scrollY,selection:getSelection().toString()};});
   });
  });
  const page=await context.newPage();page.on('dialog',d=>d.accept());
  await page.goto(url);await ready(page);
  const source=path.join(temp,`source.${type}`);await writeFile(source,await fixture(type));
  await page.locator('#file-input').setInputFiles(source);await ready(page);await frame(page).locator('p').filter({hasText:unique}).waitFor();
  await selectText(page,deleted);await save(page,'删除原文意见');
  await selectText(page,duplicate,1);await save(page,'第二处重复意见');
  await selectText(page,unique);await save(page,'移动原文意见');
  await page.locator('[data-mode=browse]').click();await save(page,'整体反馈');
  for(let i=0;i<10;i++){await page.locator('[data-mode=browse]').click();await save(page,`额外整体反馈 ${i}`);}
  const original=await data(page);assert.equal(original.annotations.length,14);
  const complete=original.annotations[13];await card(page,complete.id).locator('[data-action=status]').click();
  const before=await data(page);
  await selectText(page,replacement);await page.locator('#comment-input').fill('保留未保存草稿');
  const oldDraftTarget=await page.locator('#target-text').textContent();
  await writeFile(source,await fixture(type,true));await reload(page,source);
  await page.waitForFunction(()=>!document.getElementById('reload-review-summary').textContent.includes('正在检查'));
  assert(await page.locator('#reload-review').isVisible());
  assert.match(await page.locator('#reload-review-summary').textContent(),/已完成 1 · 待处理 13/);
  const checks=await frame(page).locator('body').evaluate(()=>window.__checks);
  assert.deepEqual(checks.map(c=>c.items.length),[10,3]);
  assert.equal(checks.flatMap(c=>c.items).some(item=>item.id===complete.id),false);
  for(const check of checks){assert.deepEqual(check.after,check.before);assert(check.before.scroll>0);assert(check.before.selection.length>0);}
  assert.equal(await page.locator('#comment-input').inputValue(),'保留未保存草稿');
  assert.equal(await page.locator('#target-text').textContent(),oldDraftTarget);
  for(const [index,status] of [[0,'missing'],[1,'ambiguous'],[2,'fallback'],[3,'exact']])await card(page,original.annotations[index].id).locator(`.location-status.${status}`).waitFor();
  assert.equal(await card(page,complete.id).locator('.location-status').count(),0);
  // Clicking a compact uncertain opinion opens comparison without guessing or losing a draft.
  const uncertain=card(page,original.annotations[1].id);
  await uncertain.locator('[data-action=select]').click();await page.locator('#location-dialog').waitFor({state:'visible'});
  assert.equal(await page.locator('#location-dialog-title').textContent(),'确认批注位置');
  await page.waitForFunction(()=>!document.getElementById('location-review-status').textContent.includes('正在读取'));
  if(await page.locator('.location-candidate').count()>1)assert(await page.locator('#confirm-location').isDisabled(), 'multiple candidates require explicit selection');
  await page.keyboard.press('Escape');await page.locator('#location-dialog').waitFor({state:'hidden'});
  assert.equal(await page.locator('#comment-input').inputValue(),'保留未保存草稿');assert.equal(await page.locator('#target-text').textContent(),oldDraftTarget);
  assert.deepEqual((await data(page)).annotations,before.annotations);
  await mkdir(path.join(root,'output/playwright'),{recursive:true});await card(page,original.annotations[0].id).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(root,`output/playwright/reload-review-${type}-before.png`),fullPage:true});
  const refreshed=await data(page);assert.notEqual(refreshed.source.sha256,before.source.sha256);assert.deepEqual(refreshed.annotations,before.annotations);
  await page.locator('#review-attention').click();assert.equal(await page.locator('#annotation-filter').inputValue(),'attention');assert.equal(await page.locator('.annotation-card').count(),3);
  const old=original.annotations[0];
  await card(page,old.id).locator('[data-action=reselect]').click();
  assert.equal(await page.locator('#comment-input').inputValue(),old.comment);assert(await page.locator('#target-preview').isHidden());assert(await page.locator('#save-button').isDisabled());
  await page.locator('#cancel-edit').click();assert.deepEqual((await data(page)).annotations,before.annotations);
  await page.evaluate(()=>{window.__dropLocated=true;});
  await card(page,old.id).locator('[data-action=locate]').click();
  await page.waitForFunction(()=>window.__locatedPackets?.some(packet=>packet.requestId===document.querySelector('.annotation-card').dataset.annotationId));
  const delayedLocate=await page.evaluate(id=>window.__locatedPackets.find(packet=>packet.requestId===id),old.id);
  assert.equal(delayedLocate.status,'missing');assert.equal(typeof delayedLocate.locationToken,'string');assert(delayedLocate.locationToken.length>10);
  const originalRequest=await frame(page).locator('body').evaluate((_,id)=>window.__locateCommands.find(packet=>packet.requestId===id),old.id);assert.equal(originalRequest.locationToken,delayedLocate.locationToken);
  await card(page,old.id).locator('[data-action=reselect]').click();
  if(type==='docx'){
   const valid=await readFile(source);await writeFile(source,Buffer.from('broken docx'));await reload(page,source);
   assert.match(await page.locator('#status').textContent(),/失败|无效|损坏|ZIP|DOCX/);
   assert.equal(await page.locator('#comment-input').inputValue(),old.comment);assert(await page.locator('#target-preview').isHidden());assert.deepEqual((await data(page)).annotations,before.annotations);assert.equal((await data(page)).source.sha256,refreshed.source.sha256);
   await frame(page).locator('p').filter({hasText:replacement}).waitFor();await writeFile(source,valid);
  }
  await selectText(page,replacement);await page.locator('#save-button').click();
  let updated=await data(page);const now=updated.annotations[0];assert.equal(now.id,old.id);assert.equal(now.revision,2);assert.equal(now.comment,old.comment);
  assert.equal(now.target.quote.exact,replacement);assert.equal(now.targetHistory.length,1);assert.deepEqual(now.targetHistory[0].target,old.target);assert.deepEqual(now.targetHistory[0].view,old.view);assert.equal(now.targetHistory[0].revision,1);assert(Number.isFinite(Date.parse(now.targetHistory[0].at)));
  if(type==='docx'){assert.equal(now.target.docx.sourceSha256,updated.source.sha256);assert.equal(now.targetHistory[0].target.docx.sourceSha256,before.source.sha256);}
  await page.locator('#annotation-filter').selectOption('all');
  await page.waitForFunction(()=>!document.getElementById('reload-review-summary').textContent.includes('正在检查'));
  await card(page,old.id).locator('.location-status.exact').waitFor();
  const freshStatus=await card(page,old.id).locator('.location-status').textContent();
  await page.evaluate(()=>{window.__dropLocated=false;});
  await frame(page).locator('body').evaluate((_,packet)=>parent.postMessage(packet,'*'),delayedLocate);
  await page.waitForTimeout(100);assert.equal(await card(page,old.id).locator('.location-status').textContent(),freshStatus);
  assert.deepEqual((await data(page)).annotations,updated.annotations);
  const received=await page.evaluate(()=>window.__locatedPackets.length);
  await card(page,old.id).locator('[data-action=locate]').click();
  await page.waitForFunction(count=>window.__locatedPackets.length>count,received);
  const freshLocate=await page.evaluate(()=>window.__locatedPackets.at(-1));
  assert.equal(freshLocate.requestId,old.id);assert.equal(freshLocate.status,'exact');assert.notEqual(freshLocate.locationToken,delayedLocate.locationToken);
  await card(page,old.id).locator('.location-status.exact').waitFor();assert.match(await page.locator('#status').textContent(),/位置与原文已匹配/);
  await page.locator('#undo-button').click();assert.deepEqual((await data(page)).annotations,before.annotations);
  await page.locator('#redo-button').click();assert.deepEqual((await data(page)).annotations,updated.annotations);
  const staleFile=path.join(temp,`${type}.results.json`);await writeFile(staleFile,JSON.stringify({format:'html-review-results',schemaVersion:1,batchId:`old-${type}`,results:[{id:old.id,revision:1,annotationUpdatedAt:old.updatedAt,status:'resolved',summary:'旧定位完成',by:'agent'}]}));
  await page.locator('#results-input').setInputFiles(staleFile);await ready(page);assert.match(await page.locator('#status').textContent(),/过期/);assert.deepEqual((await data(page)).annotations,updated.annotations);
  await page.locator('#annotation-filter').selectOption('all');
  // A lost reply must become retryable; a late old-channel reply cannot overwrite fresh results.
  const late=await page.evaluate(()=>window.__checkedPackets[0]);
  await page.evaluate(()=>{window.__dropChecks=true;});await reload(page,source);
  await page.waitForFunction(()=>!document.getElementById('reload-review-summary').textContent.includes('正在检查'));
  assert.match(await page.locator('#reload-review-detail').textContent(),/13 条尚未检查/);assert(await page.locator('#review-retry').isVisible());
  assert.equal(await page.locator('.location-status').count(),0);
  await page.evaluate(()=>{window.__dropChecks=false;});await page.locator('#review-retry').click();
  await page.waitForFunction(()=>!document.getElementById('reload-review-summary').textContent.includes('正在检查'));
  assert.equal(await page.locator('.location-status').count(),13);assert(await page.locator('#review-retry').isHidden());
  const statusBefore=await page.locator('.location-status').allTextContents();
  await frame(page).locator('body').evaluate((_,packet)=>parent.postMessage(packet,'*'),late);
  await page.waitForTimeout(100);assert.deepEqual(await page.locator('.location-status').allTextContents(),statusBefore);assert.deepEqual((await data(page)).annotations,updated.annotations);
  const light=await download(page,'annotations',`${type}.review.json`);const exported=JSON.parse(await readFile(light,'utf8'));assert.deepEqual(exported.annotations[0].targetHistory,now.targetHistory);assert.equal(exported.source.sha256,updated.source.sha256);
  const inspected=await runPython([path.join(root,'scripts/inspect_review.py'),light,source]);assert.match(inspected.stdout,/targetHistorySummary/);
  const full=await download(page,'html',`${type}.review.html`);const reopened=await context.newPage();reopened.on('dialog',d=>d.accept());await reopened.goto(pathToFileURL(full).href);await ready(reopened);
  assert.deepEqual((await data(reopened)).annotations,updated.annotations);await card(reopened,old.id).locator('[data-action=edit]').click();await reopened.locator('#comment-input').fill('重开后继续编辑');await reopened.locator('#save-button').click();const continued=(await data(reopened)).annotations[0];assert.equal(continued.revision,3);assert.deepEqual(continued.targetHistory,now.targetHistory);
  await card(page,old.id).locator('.target-history').evaluateAll(items=>items.forEach(item=>item.open=true));
  await page.locator('.annotations-section').evaluate(section=>section.scrollIntoView({block:'start'}));await frame(page).locator('p').filter({hasText:replacement}).scrollIntoViewIfNeeded();
  const evidence=path.join(root,'output/docx-user-test/reload-review');await mkdir(evidence,{recursive:true});await copyFile(source,path.join(evidence,`source.${type}`));await copyFile(full,path.join(evidence,`${type}.review.html`));await copyFile(light,path.join(evidence,`${type}.review.json`));
  await mkdir(path.join(root,'output/playwright'),{recursive:true});await page.screenshot({path:path.join(root,`output/playwright/reload-review-${type}-${process.env.BROWSER_PATH?.includes('Edge')?'edge':'chrome'}.png`),fullPage:true});
  await page.screenshot({path:path.join(root,`output/playwright/reload-review-${type}.png`),fullPage:true});
  console.log(`PASS ${type}: 13 pending / 2 batches, exact/fallback/missing/ambiguous, completed skip, unchanged scroll/selection/draft, cancel, history, undo/redo, stale manual-locate token, stale results, exports, Python and reopen`);
  await context.close();
 }
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(temp,{recursive:true,force:true});console.log('PROCESS_CLEANUP_COMPLETE');}
