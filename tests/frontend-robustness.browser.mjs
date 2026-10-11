import {openAnnotationData} from './backup-ui.mjs';
/* Regression checks for interrupted clicks, short dialogs and mobile review. */
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {waitPreviewLayout} from './preview-layout.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const output=path.join(root,'output/playwright/robustness');await mkdir(output,{recursive:true});
const temp=await mkdtemp(path.join(os.tmpdir(),'review-robustness-'));
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const checks=[],errors=[];
async function fresh(viewport){
 const context=await browser.newContext({viewport,acceptDownloads:true,...(viewport.width<=760?{isMobile:true,hasTouch:true}:{})});
 await context.addInitScript(()=>{window.showOpenFilePicker=undefined;});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(pathToFileURL(path.join(root,'index.html')).href);return {context,page};
}
async function settle(page){await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});}
async function open(page,file=path.join(root,'examples/pages.html')){await page.locator('#file-input').setInputFiles(file);await page.locator('#preview-frame[aria-busy=false]').waitFor();await waitPreviewLayout(page);}
async function viewport(page,values){await page.evaluate(values=>{for(const [name,value] of Object.entries(values)){if(value===null)delete visualViewport[name];else Object.defineProperty(visualViewport,name,{configurable:true,get:()=>value});}visualViewport.dispatchEvent(new Event('resize'));},values);}
async function json(page){await openAnnotationData(page);const result=JSON.parse(await page.locator('#data-preview').textContent());await page.locator('#data-dialog [data-close]').click();await page.locator('#data-dialog').waitFor({state:'hidden'});return result;}
try{
 {
  const {context,page}=await fresh({width:390,height:844});try{
   await open(page);await page.locator('#mobile-write').tap();await page.locator('#comment-input').fill('键盘打开时一次点击保存。');
   // Browser viewport simulation; this does not replace a hardware keyboard test.
   await viewport(page,{height:400});await page.locator('#save-button').scrollIntoViewIfNeeded();await settle(page);
   const before=await page.locator('#save-button').boundingBox();assert(before.y>=0&&before.y+before.height<=400);
   await page.locator('#save-button').tap();await page.waitForFunction(()=>document.querySelectorAll('.annotation-card').length===1);
   assert.equal(await page.locator('#comment-input').inputValue(),'');assert.equal(await page.locator('.workspace').getAttribute('data-keyboard'),'true','button focus cannot dismiss keyboard geometry early');
   const after=await page.locator('#save-button').boundingBox();assert(Math.abs(after.y-before.y)<1,'Save stays still between pointerdown and click');
   assert(await page.locator('#mobile-dock').isHidden());
   await viewport(page,{height:null});await page.locator('#mobile-dock').waitFor({state:'visible'});await page.locator('#mobile-reading').tap();await page.locator('#review-sidebar').waitFor({state:'hidden'});
   await viewport(page,{height:780,offsetTop:24});const dock=await page.locator('#mobile-dock').boundingBox();assert(dock.y>=24&&dock.y+dock.height<=804,'dock follows the visible viewport even though it is a workspace sibling');
   await viewport(page,{height:400,scale:2});assert.equal(await page.locator('.workspace').getAttribute('data-keyboard'),'false','pinch zoom is not a keyboard');
   await viewport(page,{height:null,scale:null,offsetTop:null});
   await page.locator('#mobile-write').tap();
   // A portable copy must not retain this device's viewport offsets.
   await page.locator('#backup-menu summary').tap();await page.locator('#export-format').selectOption('html');
   await viewport(page,{height:780,offsetTop:24});const download=page.waitForEvent('download');await page.locator('#download-button').tap();
   const copy=path.join(temp,'viewport.review.html');await(await download).saveAs(copy);
   const clean=await page.evaluate(html=>{const doc=new DOMParser().parseFromString(html,'text/html');return ['.workspace','#mobile-dock'].every(selector=>!doc.querySelector(selector).style.getPropertyValue('--viewport-bottom'));},await readFile(copy,'utf8'));assert(clean);
   checks.push('single-tap save with simulated keyboard, stable focus transition, viewport-aware dock, pinch zoom and clean portable copy');
  }finally{await context.close();}
 }
 {
  for(const size of [{width:1280,height:320},{width:800,height:400},{width:600,height:320},{width:390,height:400}]){
   const {context,page}=await fresh(size);try{
    await page.locator('#settings-button').click();await settle(page);
    const dialog=await page.locator('#settings-dialog').boundingBox();assert(dialog.y>=0&&dialog.y+dialog.height<=size.height,'settings fits '+JSON.stringify(size));
    for(const name of ['help','shortcuts','workspace']){
     await page.locator('.settings-nav [data-settings-page='+name+']').click();await settle(page);
     const panel=page.locator('[data-settings-panel='+name+']');const last=panel.locator(':scope > :last-child');await last.scrollIntoViewIfNeeded();
     const content=await panel.boundingBox(),child=await last.boundingBox();assert(content.height>50);assert(child.y<content.y+content.height&&child.y+child.height>content.y,'end of settings content remains scrollable');
    }
    const close=await page.locator('#settings-dialog [data-close]').boundingBox();assert(close.y>=0&&close.y+close.height<=size.height);await page.screenshot({path:path.join(output,'settings-'+size.width+'x'+size.height+'.png')});
    await page.locator('#settings-dialog [data-close]').click();await page.locator('#settings-dialog').waitFor({state:'hidden'});
   }finally{await context.close();}
  }
  checks.push('short desktop and landscape settings: reachable close button and scrollable help, shortcuts and workspace');
 }
 {
  for(const size of [{width:600,height:400},{width:760,height:480},{width:390,height:600}]){
   const {context,page}=await fresh(size);try{
    await open(page);const workspace=await page.locator('.workspace').boundingBox(),dock=await page.locator('#mobile-dock').boundingBox(),stage=await page.locator('#preview-stage').boundingBox(),preview=await page.locator('#preview-frame').boundingBox();
    assert(workspace.y+workspace.height<=dock.y,'short workspace stays above the dock');assert(preview.y+preview.height<=stage.y+stage.height,'iframe viewport fits its container instead of adding a second scroll surface');assert(preview.height>=60);
    // The document's final content remains reachable inside its own viewport.
    const last=page.frameLocator('#preview-frame').locator('#page-feedback h2');await last.scrollIntoViewIfNeeded();
    const box=await last.boundingBox();assert(box.y<preview.y+preview.height&&box.y+box.height>preview.y);await page.screenshot({path:path.join(output,'reading-'+size.width+'x'+size.height+'.png')});
   }finally{await context.close();}
  }
  checks.push('short mobile reading: dock does not cover the workspace, iframe fits and final document content is reachable');
 }
 {
  const source=path.join(temp,'位置复核.html');const html=text=>'<!doctype html><meta charset="utf-8"><h1>分析报告</h1><p id="target">'+text+'</p><p>其他正文不变。</p>';
  await writeFile(source,html('旧版摘要，营收持续增长。'));
  const {context,page}=await fresh({width:390,height:844});try{
   await open(page,source);await page.locator('#mobile-write').tap();await page.locator('[data-mode=element]').tap();await page.locator('#review-sidebar').waitFor({state:'hidden'});await waitPreviewLayout(page);
   await page.frameLocator('#preview-frame').locator('#target').tap();await page.locator('#comment-input').fill('精简摘要并保留营收。');await page.locator('#save-button').tap();
   await writeFile(source,html('新版摘要，营收与利润持续增长。'));
   const chooser=page.waitForEvent('filechooser');await page.locator('#reload-preview').tap();await(await chooser).setFiles(source);
   await page.waitForFunction(()=>!document.getElementById('open-button').disabled);await page.locator('#mobile-annotations').tap();await page.locator('[data-action=review-location]').tap();await page.locator('.location-candidate').waitFor();
   await page.locator('.location-candidate button').first().tap();await page.locator('#location-dialog').waitFor({state:'hidden'});await page.locator('#review-sidebar').waitFor({state:'hidden'});
   assert(await page.locator('#location-preview-bar').isVisible());assert(await page.locator('#preview-frame').isVisible());
   // Real taps prove the comparison controls are not covered by the mobile sheet.
   await page.locator('#return-location-comparison').tap();await page.locator('.location-candidate button').first().tap();await page.locator('#location-dialog').waitFor({state:'hidden'});await page.locator('#confirm-preview-location').tap();
   await page.locator('#mobile-annotations').tap();const updated=await json(page);assert.equal(updated.annotations[0].revision,2);assert.equal(updated.annotations[0].targetHistory.length,1);assert.equal(updated.annotations[0].comment,'精简摘要并保留营收。');
   await page.locator('[data-action=status]').tap();await page.locator('[data-action=review-result]').tap();await page.locator('#review-current-document').tap();await page.locator('#location-dialog').waitFor({state:'hidden'});await page.locator('#review-sidebar').waitFor({state:'hidden'});
   await page.locator('#return-location-comparison').tap();await page.locator('#location-dialog').waitFor({state:'visible'});assert.equal((await page.locator('#location-dialog-title').textContent()),'复核处理结果');
   await page.keyboard.press('Escape');await page.locator('#location-dialog').waitFor({state:'hidden'});await page.locator('#mobile-annotations').tap();const completed=await json(page);assert.equal(completed.annotations[0].status,'resolved');assert.equal(completed.annotations[0].revision,2);
   checks.push('mobile changed-source candidate preview, return/confirm, preserved history and completed-result review without sheet obstruction');
  }finally{await context.close();}
 }
 assert.deepEqual(errors,[]);console.log('PASS '+checks.join('\nPASS '));
 await writeFile(path.join(output,'verification-'+(process.env.BROWSER_PATH?.includes('Edge')?'edge':'chrome')+'.json'),JSON.stringify({status:'PASS',browser:await browser.version(),checks,errors},null,2));
}finally{await browser.close();await rm(temp,{recursive:true,force:true});console.log('PROCESS_CLEANUP_COMPLETE');}
