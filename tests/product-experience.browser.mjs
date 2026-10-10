/* Product acceptance exercises visible controls and preserved document geometry. */
import assert from 'node:assert/strict';
import {mkdir,writeFile,mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {waitPreviewLayout} from './preview-layout.mjs';
import {createDocxFixture} from './docx-fixtures.mjs';
import {writePdfFixture} from './pdf-fixtures.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),output=path.join(root,'output/playwright/product');await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const checks=[],errors=[];
const temp=await mkdtemp(path.join(os.tmpdir(),'review-product-'));
async function fresh(options={}){const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,...options});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.waitForFunction(()=>!document.getElementById('open-button').disabled);return {context,page};}
async function open(page){await page.locator('#file-input').setInputFiles(path.join(root,'examples/pages.html'));await page.locator('#preview-frame[aria-busy=false]').waitFor();await waitPreviewLayout(page);}
async function settle(page){await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});}
async function shot(page,name){await settle(page);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.screenshot({animations:'disabled',path:path.join(output,name+'.png')});}
async function save(page,text){await page.locator('#comment-input').fill(text);await page.locator('#save-button').click();}
async function data(page){await page.locator('#data-button').click();const result=JSON.parse(await page.locator('#data-preview').textContent());await page.keyboard.press('Escape');await page.locator('#data-dialog').waitFor({state:'hidden'});return result;}
try{
 {
  const {context,page}=await fresh();try{
   await shot(page,'home');await open(page);assert(await page.locator('#workflow-details').isHidden());
   const original=await page.locator('#preview-frame').boundingBox(),section=await page.locator('.preview-section').boundingBox();assert(original.height>=section.height*.8,'at least 80% of workspace height belongs to the document');
   await page.locator('#workflow-details-toggle').click();await page.locator('#onboarding-card').waitFor({state:'visible'});await settle(page);
   const expanded=await page.locator('#preview-frame').boundingBox();assert.deepEqual(expanded,original,'flow details overlay never resize the document');await shot(page,'workflow');
   await page.locator('#workflow-details-toggle').click();await page.locator('#workflow-details').waitFor({state:'hidden'});
   await save(page,'统一全文标题的层级和留白。');assert.deepEqual(await page.locator('#preview-frame').boundingBox(),original,'saving does not move/resize the preview');
   await page.locator('#status').filter({hasText:'批注已添加'}).waitFor();await shot(page,'workspace');
   await page.locator('#status-dismiss').click();await page.locator('#status').waitFor({state:'hidden'});assert.deepEqual(await page.locator('#preview-frame').boundingBox(),original);
   await page.locator('[data-mode=element]').click();await waitPreviewLayout(page);await page.frameLocator('#preview-frame').locator('#page-feedback h2').click();await page.locator('#comment-scope').filter({hasText:'所选元素'}).waitFor();await save(page,'这个标题需要更具体。');
   await page.locator('.annotation-card').last().locator('[data-action=edit]').click();assert.equal(await page.locator('#editor-title').textContent(),'编辑批注 · 02');assert(await page.locator('.annotation-card.active .annotation-editing').isVisible());assert(await page.locator('#comment-input').evaluate(node=>node===document.activeElement));await shot(page,'editing');
   await page.locator('#cancel-edit').click();assert.equal(await page.locator('#editor-title').textContent(),'添加批注');
   const before=await data(page);await page.locator('.annotation-card').last().locator('[data-action=select]').click();await page.locator('.annotation-card').last().locator('.location-status.exact').waitFor();assert.deepEqual((await data(page)).annotations,before.annotations);
   for(const w of [1280,1050,900,800]){await page.setViewportSize({width:w,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'desktop no overflow '+w);await shot(page,'desktop-'+w);}
   checks.push('desktop reading area, overlay geometry, save/dismiss stability, explicit editing, selection and responsive workspace');
  }finally{await context.close();}
 }
 {
  const {context,page}=await fresh({viewport:{width:390,height:844},isMobile:true,hasTouch:true});try{
   await shot(page,'home-mobile');await open(page);assert(await page.locator('#mobile-dock').isVisible());assert(await page.locator('#review-sidebar').isHidden());assert(await page.locator('#review-sidebar').evaluate(n=>n.inert));
   const initial=await page.locator('#preview-frame').boundingBox();await page.locator('#mobile-write').tap();await page.locator('#comment-input').waitFor({state:'visible'});assert(await page.locator('.annotations-section').isHidden());assert.deepEqual(await page.locator('#preview-frame').boundingBox(),initial);
   await page.locator('#comment-input').fill('手机上也可以直接写整体意见。');await shot(page,'mobile-editor');await page.locator('#mobile-panel-close').tap();await page.locator('#review-sidebar').waitFor({state:'hidden'});await page.locator('#mobile-write').tap();assert.equal(await page.locator('#comment-input').inputValue(),'手机上也可以直接写整体意见。');await page.locator('#save-button').tap();
   const reverse=await page.evaluate(()=>{const panel=document.getElementById('review-sidebar');document.getElementById('mobile-reading').click();for(const a of panel.getAnimations()){a.pause();a.currentTime=60;}const before=getComputedStyle(panel).transform;document.getElementById('mobile-write').click();const opening=getComputedStyle(panel).transform;document.getElementById('mobile-reading').click();return {before,closing:getComputedStyle(panel).transform,opening,inert:panel.inert,y:new DOMMatrix(before).m42};});assert(reverse.y>0,'reversal sampled during the exit');assert.equal(reverse.before,reverse.closing);assert.equal(reverse.closing,reverse.opening);assert.equal(reverse.inert,true);await page.locator('#review-sidebar').waitFor({state:'hidden'});await page.locator('#mobile-write').tap();
   await page.locator('#mobile-annotations').tap();assert(await page.locator('.editor-section').isHidden());assert.equal(await page.locator('.annotation-card').count(),1);await shot(page,'mobile-list');await page.locator('.annotation-comment').tap();await page.locator('#review-sidebar').waitFor({state:'hidden'});assert.equal(await page.locator('#mobile-reading').getAttribute('aria-pressed'),'true');
   await page.locator('#mobile-write').tap();await page.locator('[data-mode=element]').tap();await page.locator('#review-sidebar').waitFor({state:'hidden'});await waitPreviewLayout(page);await page.frameLocator('#preview-frame').locator('#page-read h2').tap();await page.locator('#review-sidebar').waitFor({state:'visible'});assert.equal(await page.locator('.workspace').getAttribute('data-mobile-panel'),'editor');assert.match(await page.locator('#comment-scope').textContent(),/所选元素/);assert.equal(await page.locator('#comment-input').evaluate(n=>n===document.activeElement),false,'selection does not summon keyboard');
   await page.locator('#comment-input').fill('保留选区和草稿。');await page.keyboard.press('Escape');await page.locator('#review-sidebar').waitFor({state:'hidden'});await page.locator('#mobile-write').tap();assert.equal(await page.locator('#comment-input').inputValue(),'保留选区和草稿。');assert.match(await page.locator('#comment-scope').textContent(),/所选元素/);
   for(const w of [320,390,600,760]){await page.setViewportSize({width:w,height:844});await settle(page);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile no overflow '+w);const sheet=await page.locator('#review-sidebar').boundingBox();assert(sheet.x>=0&&sheet.x+sheet.width<=w);const save=await page.locator('#save-button').boundingBox();assert(save.width>=44&&save.height>=40);assert(save.y>=sheet.y&&save.y+save.height<=sheet.y+sheet.height,'save remains visible in the panel at '+w);await shot(page,'mobile-'+w);}
   await page.setViewportSize({width:390,height:844});assert(await page.locator('#sidebar-position-trigger').isHidden());assert.equal(await page.locator('#comment-input').evaluate(n=>getComputedStyle(n).fontSize),'16px');
   // Simulated visualViewport geometry, not a physical phone/keyboard claim.
   await page.locator('#comment-input').focus();await page.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,get:()=>400});visualViewport.dispatchEvent(new Event('resize'));});
   assert.equal(await page.locator('.workspace').getAttribute('data-keyboard'),'true');assert(await page.locator('#mobile-dock').isHidden());const keyboardSheet=await page.locator('#review-sidebar').boundingBox();assert(keyboardSheet.y>=0&&keyboardSheet.y+keyboardSheet.height<=401,'sheet stays above simulated keyboard');
   await page.locator('#save-button').scrollIntoViewIfNeeded();const action=await page.locator('#save-button').boundingBox();assert(action.y>=keyboardSheet.y&&action.y+action.height<=401,'save remains reachable by scrolling');
   await page.evaluate(()=>{delete visualViewport.height;visualViewport.dispatchEvent(new Event('resize'));});
   await page.setViewportSize({width:1440,height:1000});assert(await page.locator('#review-sidebar').isVisible());assert(await page.locator('#mobile-dock').isHidden());assert.equal(await page.locator('#comment-input').inputValue(),'保留选区和草稿。');
   checks.push('touch bottom panel, preserved preview geometry/draft/selection, list-to-reading, auto reveal without keyboard, 320–760px and desktop transition');
  }finally{await context.close();}
 }
 {
  const {context,page}=await fresh();try{
   await open(page);await page.clock.install();await page.locator('#file-input').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{bad JSON')});await page.locator('#status.error').waitFor();const box=await page.locator('#preview-frame').boundingBox();await page.clock.runFor(10000);assert(await page.locator('#status.error').isVisible(),'errors stay until acknowledged');await page.locator('#status-dismiss').click();await page.clock.runFor(250);await settle(page);assert(await page.locator('#status').isHidden());
   await save(page,'反馈不应打断阅读。');await page.locator('.notice-surface').hover();await page.clock.runFor(6000);assert(await page.locator('#status').isVisible(),'hover gives time to read');await page.mouse.move(5,5);await page.clock.runFor(5000);await settle(page);assert(await page.locator('#status').isHidden(),'ordinary save feedback expires');assert.deepEqual(await page.locator('#preview-frame').boundingBox(),box);
   checks.push('persistent real import error, dismiss, hover-paused success expiry and stable preview geometry');
  }finally{await context.close();}
 }
 for(const type of ['docx','pdf']){
  const source=path.join(temp,'移动审阅.'+type);if(type==='docx')await writeFile(source,await createDocxFixture());else await writePdfFixture(source);
  const {context,page}=await fresh({viewport:{width:390,height:844},isMobile:true,hasTouch:true});try{
   await page.locator('#file-input').setInputFiles(source);await page.waitForFunction(()=>!document.getElementById('open-button').disabled);if(type==='docx')await page.locator('#preview-frame[aria-busy=false]').waitFor();else await page.locator('.pdf-page[data-page-number="1"][data-rendered=true]').waitFor();
   await page.locator('#mobile-write').tap();assert.equal(await page.locator('[data-mode=page]').isVisible(),type==='pdf');await save(page,'整份文档保持单位一致。');await page.locator('[data-mode=element]').tap();await page.locator('#review-sidebar').waitFor({state:'hidden'});
   if(type==='docx'){await waitPreviewLayout(page);await page.frameLocator('#preview-frame').locator('h1').first().tap();}
   else{const box=await page.locator('.pdf-page').first().boundingBox();await page.mouse.move(box.x+20,box.y+80);await page.mouse.down();await page.mouse.move(box.x+150,box.y+180,{steps:8});await page.mouse.up();}
   await page.locator('#review-sidebar').waitFor({state:'visible'});assert.match(await page.locator('#comment-scope').textContent(),type==='docx'?/所选元素/:/所选区域/);assert.equal(await page.locator('#comment-input').evaluate(n=>n===document.activeElement),false);await save(page,'这部分请补充说明。');await page.locator('#mobile-annotations').tap();assert.equal(await page.locator('.annotation-card').count(),2);await shot(page,type+'-mobile-list');checks.push(type+': mobile import, whole/local opinion, auto return to document/auto reveal editor without keyboard');
  }finally{await context.close();}
 }
 {
  const folder=path.join(temp,'folder');await mkdir(folder);await writeFile(path.join(folder,'01-first.html'),'<h1>第一份文档</h1>');await writeFile(path.join(folder,'02-second.html'),'<h1>第二份文档</h1>');
  const {context,page}=await fresh({viewport:{width:390,height:844},isMobile:true,hasTouch:true});try{
   await page.locator('#folder-input').setInputFiles(folder);await page.locator('#preview-frame[aria-busy=false]').waitFor();await page.locator('#mobile-write').tap();await page.locator('#entry-select-trigger').tap();await page.getByRole('option',{name:'02-second.html',exact:true}).tap();await page.frameLocator('#preview-frame').locator('h1').filter({hasText:'第二份文档'}).waitFor();assert(await page.locator('#entry-label').isVisible());checks.push('mobile folder document selector stays accessible and opens the selected document');
  }finally{await context.close();}
 }
 {
  const {context,page}=await fresh({reducedMotion:'reduce'});try{await open(page);await page.locator('#workflow-details-toggle').click();assert.equal(await page.locator('#workflow-details').evaluate(n=>n.getAnimations().length),0);await page.locator('#workflow-details-toggle').click();await save(page,'验证可访问性。');await page.locator('#status-dismiss').click();assert(await page.locator('#status').isHidden());await page.setViewportSize({width:390,height:844});await page.locator('#mobile-write').click();assert.equal(await page.locator('#review-sidebar').evaluate(n=>n.getAnimations().length),0);await page.locator('#mobile-reading').click();assert(await page.locator('#review-sidebar').isHidden());checks.push('reduced motion for flow, feedback and mobile panel');}finally{await context.close();}
 }
 assert.deepEqual(errors,[]);console.log('PASS '+checks.join('\nPASS '));await writeFile(path.join(output,'verification.json'),JSON.stringify({status:'PASS',browser:await browser.version(),checks,errors},null,2));
}catch(e){await writeFile(path.join(output,'verification.json'),JSON.stringify({status:'FAIL',error:e.stack,checks,errors},null,2));throw e;}
finally{await browser.close();await rm(temp,{recursive:true,force:true});console.log('PROCESS_CLEANUP_COMPLETE');}
