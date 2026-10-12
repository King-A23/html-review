/* Capture real UI saves and export public example annotations. */
import {chromium} from 'playwright';
import path from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {ensureBackup} from '../tests/backup-ui.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const out=path.join(root,'output/playwright/release-demo');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const report={errors:[],networkRequests:[],examples:[]};
try {
for(const type of ['docx','pdf']) {
 const context=await browser.newContext({viewport:{width:1600,height:1000},recordVideo:{dir:out,size:{width:1600,height:1000}},acceptDownloads:true});
 await context.addInitScript(()=>{window.showOpenFilePicker=undefined;window.showDirectoryPicker=undefined;});
 const page=await context.newPage();page.on('dialog',d=>d.accept());page.on('pageerror',e=>report.errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))report.networkRequests.push(r.url());});
 await page.goto(pathToFileURL(path.join(root,'index.html')).href);
 await page.locator('#file-input').setInputFiles(path.join(root,'examples/documents',`review.${type}`));
 await page.waitForFunction(()=>!document.querySelector('#open-button').disabled);
 if(type==='docx') await page.frameLocator('#preview-frame').locator('h1').first().waitFor();
 else {await page.locator('.pdf-page[data-page-number="1"][data-rendered="true"]').waitFor();await page.locator('#pdf-zoom').selectOption('0.75');}
 const start=Date.now();await page.waitForTimeout(1000);
 await page.locator('[data-mode=element]').click();
 if(type==='docx') await page.frameLocator('#preview-frame').locator('p').filter({hasText:'The pilot included 40'}).click();
 else {const box=await page.locator('.pdf-page[data-page-number="1"]').boundingBox();await page.mouse.move(box.x+45,box.y+190);await page.mouse.down();await page.mouse.move(box.x+box.width-45,box.y+310,{steps:15});await page.mouse.up();}
 await page.locator('#comment-input').pressSequentially(type==='docx'?'请补充完成率的定义、样本数与统计口径。':'请给表格补充样本量与完成率的统计口径。',{delay:55});
 await page.locator('#save-button').click();await page.waitForTimeout(700);
 if(type==='docx') await page.frameLocator('#preview-frame').locator('p').filter({hasText:'Assign an owner for the next pilot'}).click();
 else {await page.locator('[data-mode=page]').click();await page.locator('#page-select').selectOption('2');}
 await page.locator('#comment-input').pressSequentially(type==='docx'?'请明确下一轮试点的负责人和开始日期。':'请明确试点负责人和开始日期后再确认计划。',{delay:55});
 await page.locator('#save-button').click();await page.waitForTimeout(600);
 assert.equal(await page.locator('#annotation-count').textContent(),'2');
 await ensureBackup(page);await page.locator('#export-format').selectOption('annotations');const pending=page.waitForEvent('download');await page.locator('#download-button').click();
 const destination=path.join(root,'examples/documents',`${type}.review.json`);await(await pending).saveAs(destination);
 const data=JSON.parse(await readFile(destination,'utf8'));assert.equal(data.annotations.length,2);assert.equal(data.source.type,type);
 // Return to the first comment and show the saved locations in the public still.
 await page.locator('#backup-menu summary').click();await page.locator('.annotation-card').first().locator('[data-action=locate]').click();await page.waitForTimeout(900);
 await page.screenshot({path:path.join(root,'docs',`${type}-preview.png`)});
 await page.locator('#handoff-button').click();await page.waitForTimeout(1100);
 const end=Date.now();const video=page.video();await context.close();await video.saveAs(path.join(out,`${type}-capture.webm`));
 report.examples.push({type,annotations:2,recordedActionSeconds:(end-start)/1000,sourceSha256:data.source.sha256,video:`${type}-capture.webm`});
}
assert.deepEqual(report.errors,[]);assert.deepEqual(report.networkRequests,[]);
await writeFile(path.join(out,'capture-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} finally {await browser.close();}
