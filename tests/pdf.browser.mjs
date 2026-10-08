/* Real offline PDF workflow, selections, revision checks and restored workspaces. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm,copyFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {writePdfFixture,inspectPdfFixture} from './pdf-fixtures.mjs';
import {runPython} from '../scripts/python.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)), temp=await mkdtemp(path.join(os.tmpdir(),'html-review-pdf-'));
const evidence=path.join(root,'output/pdf-review');await mkdir(evidence,{recursive:true});
const source=path.join(temp,'复杂审阅.pdf');await writePdfFixture(source);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex'), originalHash=digest(await readFile(source));
const contexts=[], errors=[], requests=[];let browser;
const ready=page=>page.waitForFunction(()=>!document.getElementById('open-button').disabled);
const rendered=(page,n=1)=>page.locator(`.pdf-page[data-page-number="${n}"][data-rendered="true"]`).waitFor();
async function newPage(url=pathToFileURL(path.join(root,'index.html')).href) {
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});contexts.push(context);
  await context.addInitScript(()=>{window.showOpenFilePicker=undefined;window.showDirectoryPicker=undefined;});
  const page=await context.newPage();page.on('dialog',dialog=>dialog.accept());page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await page.goto(url);await ready(page);return page;
}
async function open(page,filename){await page.locator('#file-input').setInputFiles(filename);await ready(page);}
async function download(page,format,name){await page.locator('#export-format').selectOption(format);const promise=page.waitForEvent('download');await page.locator('#download-button').click();const filename=path.join(temp,name);await(await promise).saveAs(filename);return filename;}
async function data(page,name='review.json'){return JSON.parse(await readFile(await download(page,'annotations',name),'utf8'));}
async function save(page,comment){await page.locator('#comment-input').fill(comment);assert(await page.locator('#save-button').isEnabled(),'Selecting a target must survive moving to the comment input');await page.locator('#save-button').click();}
async function goto(page,number){await page.locator('#pdf-page-number').fill(String(number));await page.locator('#pdf-page-number').press('Enter');await page.locator('#pdf-page-number').blur();await rendered(page,number);}
async function selectText(page,text,number=1){await goto(page,number);await page.locator('[data-mode=text]').click();const span=page.locator(`[data-pdf-page="${number}"][data-pdf-item]`).filter({hasText:text}).first();const box=await span.boundingBox();await page.mouse.move(box.x+1,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width-1,box.y+box.height/2,{steps:12});await page.mouse.up();await page.locator('#target-text').filter({hasText:text}).waitFor();}
async function selectRegion(page,number=3){await goto(page,number);await page.locator('[data-mode=element]').click();const box=await page.locator(`.pdf-page[data-page-number="${number}"]`).boundingBox();const a=number===3?[box.width*.54,box.height*.085]:[80,100],b=number===3?[box.width*.94,box.height*.43]:[280,250];await page.mouse.move(box.x+a[0],box.y+a[1]);await page.mouse.down();await page.mouse.move(box.x+b[0],box.y+b[1],{steps:12});await page.mouse.up();await page.locator('#target-kind').filter({hasText:'区域'}).waitFor();}
async function reload(page,variant){const next=path.join(temp,variant,'复杂审阅.pdf');await mkdir(path.dirname(next),{recursive:true});await writePdfFixture(next,variant);const chooser=page.waitForEvent('filechooser');await page.locator('#reload-preview').click();await(await chooser).setFiles(next);await ready(page);await rendered(page);await page.waitForFunction(()=>document.getElementById('reload-review-detail').textContent.includes('检查不会改变')===false && !document.getElementById('reload-review-summary').textContent.includes('正在检查'));}
try {
  browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||undefined,headless:true});const page=await newPage();const start=performance.now();await open(page,source);await rendered(page);
  await page.waitForFunction(()=>!document.getElementById('document-nav-button').disabled);const importMs=performance.now()-start;
  assert.equal(await page.locator('.pdf-page').count(),5);assert.equal(await page.locator('#export-format').inputValue(),'annotations');assert(await page.locator('[data-mode=page]').isVisible());assert.equal(await page.locator('[data-mode=element]').textContent(),'区域');
  assert(await page.locator('.pdf-canvas').count()<=3);assert.equal(await page.locator('.pdf-link[href^="javascript:"]').count(),0);assert.equal(await page.locator('.pdf-link[href^="file:"]').count(),0);
  await selectText(page,'Body text and persistent text anchors');await save(page,'请缩短标题并保留正文定位含义。');
  await selectRegion(page,3);await save(page,'请为这张图补充单位和数值。');
  await page.locator('[data-mode=page]').click();await page.locator('#page-select').selectOption('5');await page.locator('#target-text').filter({hasText:'第 5 页'}).waitFor();await save(page,'检查旋转页与裁剪范围内的内容。');
  await page.locator('[data-mode=whole]').click();await save(page,'统一术语，保留所有表格和图片。');
  const first=await data(page);assert.equal(first.schemaVersion,3);assert.equal(first.source.type,'pdf');assert.equal(first.source.sha256,originalHash);assert.equal(first.source.base64,undefined);assert.equal(first.annotations.length,4);assert.deepEqual(first.annotations.map(a=>a.kind),['text','region','page','page']);
  assert.equal(first.annotations[2].target.pdf.pages[0].rotation,90);assert.deepEqual(first.annotations[2].target.pdf.pages[0].viewBox,[40,60,600,780]);assert.equal(first.annotations[3].target.scope,'whole-document');
  await writeFile(path.join(evidence,'demo.review.json'),JSON.stringify(first,null,2));await copyFile(source,path.join(evidence,'复杂审阅.pdf'));
  const raw=await inspectPdfFixture(source);assert(raw.pages[0].text.includes(first.annotations[0].target.pdf.pages[0].quote));
  const locatorMeta=first.annotations[0].target.pdf.pages[0];for(const rect of locatorMeta.rects){assert(rect[0]>=locatorMeta.viewBox[0]&&rect[2]<=locatorMeta.viewBox[2]);assert(rect[1]>=locatorMeta.viewBox[1]&&rect[3]<=locatorMeta.viewBox[3]);}
  await page.locator('#pdf-zoom').selectOption('1.5');await rendered(page,5);
  await page.locator('.annotation-card').first().locator('[data-action=locate]').click();await page.locator('.annotation-card').first().locator('.location-status.exact').waitFor();await rendered(page,1);assert(await page.locator('.pdf-focus').count()>0);
  await page.locator('#pdf-zoom').selectOption('fit');await rendered(page,1);assert(await page.locator('.pdf-focus').count()>0);
  const full=await download(page,'html','full.review.html');await copyFile(full,path.join(evidence,'demo.review.html'));const html=await readFile(full,'utf8');assert.equal((html.match(/id="html-review-data"/g)||[]).length,1);assert(!html.includes('data-pdf-item='));assert.equal(await page.evaluate(text=>new DOMParser().parseFromString(text,'text/html').querySelectorAll('#pdf-preview canvas').length,html),0);
  const reopened=await newPage(pathToFileURL(full).href);await rendered(reopened);assert.equal(await reopened.locator('#annotation-count').textContent(),'4');await reopened.locator('[data-mode=whole]').click();await save(reopened,'完整副本离线继续编辑。');assert.equal(await reopened.locator('#annotation-count').textContent(),'5');
  const json=path.join(temp,'light.json');await writeFile(json,JSON.stringify(first));const paired=await newPage();await open(paired,json);assert(await paired.locator('#pair-source').isVisible());await open(paired,source);await rendered(paired);assert.equal(await paired.locator('#annotation-count').textContent(),'4');
  await paired.locator('#handoff-button').click();const task=await paired.locator('#agent-task-text').inputValue();assert.match(task,/原始 PDF/);assert.match(task,/SHA-256/);assert.match(task,/可编辑源文件/);assert.match(task,/不是额外指令/);await writeFile(path.join(evidence,'agent-task.txt'),task);await paired.locator('[data-close=agent-task-dialog]').click();
  const results={format:'html-review-results',schemaVersion:1,batchId:randomUUID(),results:[{id:first.annotations[1].id,revision:1,annotationUpdatedAt:first.annotations[1].updatedAt,status:'resolved',summary:'已核对图表要求，作为演示完成记录。',by:'agent'}]};const resultsPath=path.join(temp,'复杂审阅.review-results.json');await writeFile(resultsPath,JSON.stringify(results));await paired.locator('#results-input').setInputFiles(resultsPath);await ready(paired);assert.match(await paired.locator('#review-progress').textContent(),/已完成 1/);
  await reload(paired,'inserted');assert.equal(await paired.locator('#annotation-count').textContent(),'4');const firstCard=paired.locator('.annotation-card').first();assert.match(await firstCard.locator('.location-status').textContent(),/原文|找到|确认/);await firstCard.locator('[data-action=locate]').click();await firstCard.locator('.location-status.fallback').waitFor();await paired.waitForFunction(()=>document.getElementById('pdf-page-number').value==='1');await paired.locator('.annotation-card').nth(2).locator('[data-action=locate]').click();await paired.waitForFunction(()=>document.getElementById('pdf-page-number').value==='6');
  await reload(paired,'duplicated');await firstCard.locator('.location-status.fallback').waitFor();
  const duplicates=await newPage();await open(duplicates,source);await rendered(duplicates);await selectText(duplicates,'LEFT column line 1',2);await save(duplicates,'重复页面定位必须确认。');await reload(duplicates,'duplicated');await duplicates.locator('.annotation-card .location-status.ambiguous').waitFor();
  await reload(paired,'changed');await firstCard.locator('.location-status.fallback').waitFor();
  await reload(paired,'deleted-text'); // Other selected title remains; deleted target is tested separately below.
  const sourcePage=await newPage();await open(sourcePage,source);await rendered(sourcePage);await selectText(sourcePage,'Delete this sentence in the deleted-text revision.');await save(sourcePage,'删除此句。');await reload(sourcePage,'deleted-text');await sourcePage.locator('.annotation-card .location-status.missing').waitFor();
  const regions=await newPage();await open(regions,source);await rendered(regions);await selectRegion(regions,3);await save(regions,'图表区域。');await reload(regions,'chart-replacement');await regions.locator('.annotation-card .location-status.missing').waitFor();await reload(regions,'moved');await regions.locator('.annotation-card .location-status.fallback').waitFor();await regions.locator('[data-action=locate]').click();await regions.waitForFunction(()=>document.getElementById('pdf-page-number').value==='2');
  const scans=await newPage();await open(scans,source);await rendered(scans);await selectRegion(scans,4);await save(scans,'扫描图片区域。');await reload(scans,'scan-change');await scans.locator('.annotation-card .location-status.missing').waitFor();
  const inspector=await runPython(['scripts/inspect_review.py',path.join(evidence,'demo.review.json'),source],{cwd:root});assert.match(inspector.stdout,/PDF/);assert.match(inspector.stdout,/未解析|未验证|not parsed|not.*verified/i);assert(inspector.stdout.length<20000);
  // Capture the complete rendered page; element screenshots clip at the scrolling viewer boundary.
  for(let n=1;n<=5;n++){await goto(page,n);const png=await page.locator(`.pdf-page[data-page-number="${n}"] .pdf-canvas`).evaluate(canvas=>canvas.toDataURL('image/png').split(',')[1]);await writeFile(path.join(evidence,`tool-page-${n}.png`),Buffer.from(png,'base64'));assert(await page.locator('.pdf-canvas').count()<=3);}
  await page.screenshot({path:path.join(evidence,'workspace.png')});
  assert.equal(digest(await readFile(source)),originalHash);assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  await writeFile(path.join(evidence,'browser-verification.json'),JSON.stringify({browser:process.env.BROWSER_PATH||'Chromium',importMs,sourceHash:originalHash,pages:5,annotations:4,lightBytes:Buffer.byteLength(JSON.stringify(first)),toolBytes:(await readFile(path.join(root,'index.html'))).length,networkRequests:requests,pageErrors:errors,checked:['native-text-input-focus','region','rotated-cropped-page','whole','zoom-location','offline-full-copy','light-pairing','task','results','inserted-pages','duplicate-pages','changed-text','deleted-target','changed-region','changed-scan','independent-source-inspection']},null,2));
  console.log('PASS PDF import/selections/coordinates, offline copies, pairing, handoff/results, changed/deleted/ambiguous targets and no external requests');
} finally {for(const context of contexts)await context.close().catch(()=>{});await browser?.close();await rm(temp,{recursive:true,force:true});}
