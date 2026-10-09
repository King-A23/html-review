import {waitPreviewLayout} from './preview-layout.mjs';
/* Engineering regression: layout must not change review data or lose keyboard access. */
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {ensureBackup} from './backup-ui.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output=path.join(root,'output/playwright/reading');await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
const errors=[],results=[];
async function fresh(options={}) {
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,...options});
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.waitForFunction(()=>!document.querySelector('#open-button').disabled);
 await page.locator('#file-input').setInputFiles(path.join(root,'examples/pages.html'));await page.locator('#preview-frame[aria-busy=false]').waitFor({state:'visible'});
 return {context,page};
}
async function save(page,text){await page.locator('#comment-input').fill(text);await page.locator('#save-button').click();}
async function data(page){await page.locator('#data-button').click();const value=JSON.parse(await page.locator('#data-preview').textContent());await page.keyboard.press('Escape');await page.locator('#data-dialog').waitFor({state:'hidden'});return value;}
async function width(page){return Number(await page.locator('#sidebar-resizer').getAttribute('aria-valuenow'));}
async function drag(page,delta,cancel=false) {
 const box=await page.locator('#sidebar-resizer').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+delta,box.y+box.height/2,{steps:8});
 if(cancel)await page.keyboard.press('Escape');await page.mouse.up();
}
try {
 {
 const {context,page}=await fresh();try{
  // Use a real element selection and unsaved draft, then drag across the iframe.
  await page.locator('[data-mode=element]').click();await waitPreviewLayout(page);await page.frameLocator('#preview-frame').locator('#page-read h2').click();await page.locator('#comment-scope').filter({hasText:'所选元素'}).waitFor();
  await page.locator('#comment-input').fill('布局调整不应清除我的草稿');const originalTarget=await page.locator('#target-text').textContent();
  await drag(page,128);assert.equal(await width(page),480);assert.equal(await page.locator('#comment-input').inputValue(),'布局调整不应清除我的草稿');assert.equal(await page.locator('#target-text').textContent(),originalTarget);
  await drag(page,-100,true);assert.equal(await width(page),480);assert.equal(await page.locator('#target-text').textContent(),originalTarget,'Esc cancels resize without cancelling selected content');
  assert(!await page.locator('.workspace').evaluate(node=>node.classList.contains('is-resizing')));
  const cancelBox=await page.locator('#sidebar-resizer').boundingBox();await page.mouse.move(cancelBox.x+4,cancelBox.y+150);await page.mouse.down();await page.mouse.move(cancelBox.x+60,cancelBox.y+150);await page.locator('#sidebar-resizer').dispatchEvent('pointercancel');await page.mouse.up();assert.equal(await width(page),480);
  await page.locator('#sidebar-resizer').press('ArrowRight');assert.equal(await width(page),496);await page.locator('#sidebar-resizer').press('Home');assert.equal(await width(page),300);await page.locator('#sidebar-resizer').dblclick();assert.equal(await width(page),352);
  await page.locator('#settings-button').click();await page.locator('[data-sidebar-choice=right]').click();await page.keyboard.press('Escape');await page.locator('#settings-dialog').waitFor({state:'hidden'});
  await drag(page,-88);assert.equal(await width(page),440);await page.locator('#sidebar-resizer').press('ArrowLeft');assert.equal(await width(page),456);
  await page.setViewportSize({width:800,height:1000});await page.waitForFunction(()=>Number(document.querySelector('#sidebar-resizer').getAttribute('aria-valuenow'))<=400);assert((await width(page))<=400);await page.setViewportSize({width:1440,height:1000});await page.waitForFunction(()=>document.querySelector('#sidebar-resizer').getAttribute('aria-valuenow')==='456');
  const previewWidth=await page.locator('.preview-section').evaluate(node=>node.clientWidth);await page.locator('#sidebar-toggle').click();assert(await page.locator('#review-sidebar').isHidden());assert(await page.locator('#review-sidebar').evaluate(node=>node.inert));assert(await page.locator('.preview-section').evaluate(node=>node.clientWidth)>previewWidth+350);
  await page.locator('#sidebar-rail-toggle').click();assert(await page.locator('#review-sidebar').isVisible());assert.equal(await page.locator('#comment-input').inputValue(),'布局调整不应清除我的草稿');assert.equal(await width(page),456);
  await page.locator('#autosave-state').filter({hasText:'本机已保存'}).waitFor();
  await page.evaluate(async()=>{const key='workspace:'+location.href.split('#')[0],record=await HRSession.load(key);record.preferences.sidebarWidth=300;record.preferences.sidebarCollapsed=true;await HRSession.save(key,record);});
  await page.reload();await page.locator('#preview-frame[aria-busy=false]').waitFor({state:'visible'});assert.equal(await width(page),456);assert.equal(await page.locator('#comment-input').inputValue(),'布局调整不应清除我的草稿');
  await page.locator('#sidebar-toggle').click();await page.keyboard.press('e');assert(await page.locator('#review-sidebar').isVisible());assert.equal(await page.locator('#comment-input').inputValue(),'布局调整不应清除我的草稿');
  await page.locator('#save-button').click();const stored=await data(page);assert.equal(stored.annotations.length,1);assert.equal(stored.annotations[0].comment,'布局调整不应清除我的草稿');
  await page.screenshot({animations:'disabled',path:path.join(output,'adjusted-right.png')});results.push('drag both sides, iframe crossing, cancel, keyboard, bounds, collapse, autosave, retained selection/draft');
 }finally{await context.close();}}
 {
 const {context,page}=await fresh();try{
  const long='请把这段说明精简为两句话，同时保留数字、结论与必要的限制条件。'.repeat(9);
  await save(page,long);await save(page,'全篇统一单位。');
  await page.locator('[data-mode=element]').click();await waitPreviewLayout(page);await page.frameLocator('#preview-frame').locator('#page-feedback h2').click();await page.locator('#target-text').filter({hasText:'每条意见'}).waitFor();await save(page,'这个标题补充具体动作。');
  const first=page.locator('.annotation-card').first();assert.equal(await first.getAttribute('data-expanded'),'false');const compactHeight=await first.locator('.annotation-comment').evaluate(node=>node.clientHeight);
  await first.locator('[data-action=details]').click();assert.equal(await first.getAttribute('data-expanded'),'true');assert(await first.locator('.annotation-comment').evaluate(node=>node.clientHeight)>compactHeight*2);
  await first.locator('[data-action=details]').click();await page.locator('#annotation-next').click();assert.equal(await page.locator('#annotation-position').textContent(),'1 / 3');await page.locator('#annotation-next').click();assert.equal(await page.locator('#annotation-position').textContent(),'2 / 3');
  await page.locator('#annotation-next').click();await page.locator('.annotation-card').last().locator('.location-status.exact').waitFor();assert.equal(await page.locator('.annotation-card.is-current').count(),1);assert.equal(await page.locator('#annotation-position').textContent(),'3 / 3');assert(await page.locator('#annotation-next').isDisabled());
  await page.locator('#annotation-previous').click();assert.equal(await page.locator('#annotation-position').textContent(),'2 / 3');
  await first.locator('[data-action=details]').click();await first.locator('[data-action=status]').click();assert.equal(await first.getAttribute('data-expanded'),'true');assert(await first.locator('[data-action=status]').evaluate(node=>node===document.activeElement),'rerender preserves keyboard focus');
  await first.locator('[data-action=select]').click();await page.locator('#location-dialog').waitFor({state:'visible'});assert.equal(await page.locator('#location-dialog-title').textContent(),'复核处理结果');assert(await page.locator('#confirm-location').isHidden());await page.keyboard.press('Escape');await page.locator('#location-dialog').waitFor({state:'hidden'});
  await page.locator('#annotation-filter-trigger').click();await page.getByRole('option',{name:'待处理',exact:true}).click();assert.equal(await page.locator('#annotation-position').textContent(),'— / 2');await page.locator('#annotation-next').click();assert.equal(await page.locator('#annotation-position').textContent(),'1 / 2');
  await page.screenshot({animations:'disabled',path:path.join(output,'compact-cards.png')});
  for(const w of [900,760,390,320]){await page.setViewportSize({width:w,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no overflow '+w);await page.locator('#sidebar-toggle').click();assert(await page.locator('#review-sidebar').isHidden());await page.locator('#sidebar-toggle').click();assert(await page.locator('#review-sidebar').isVisible());if(w===320)await page.screenshot({animations:'disabled',path:path.join(output,'narrow.png'),fullPage:true});}
  results.push('compact/full cards, preview selection, previous/next, filtering, completion review, focus, narrow view');
 }finally{await context.close();}}
 {
 const {context,page}=await fresh({reducedMotion:'reduce'});try{
  await save(page,'离线副本应保留布局并可继续编辑。');await page.locator('#sidebar-resizer').press('End');await page.locator('#sidebar-toggle').click();
  await ensureBackup(page);await page.locator('#export-format-trigger').click();await page.getByRole('option',{name:/完整工作区/}).click();const pending=page.waitForEvent('download');await ensureBackup(page);await page.locator('#download-button').click();const file=await pending;const destination=path.join(output,'layout.review.html');await file.saveAs(destination);
  const exported=await readFile(destination,'utf8');assert(!exported.includes('class="workspace has-document is-resizing"'));
  await context.addInitScript(()=>{Storage.prototype.getItem=function(){throw new DOMException('Blocked','SecurityError');};Storage.prototype.setItem=function(){throw new DOMException('Blocked','SecurityError');};});
  await page.goto(pathToFileURL(destination).href);await page.waitForFunction(()=>!document.querySelector('#open-button').disabled);assert(await page.locator('#review-sidebar').isHidden());await page.locator('#sidebar-rail-toggle').click();assert.equal(await width(page),560);assert.equal(await page.locator('.annotation-card').count(),1);await page.locator('.annotation-card [data-action=details]').click();assert.equal(await page.locator('.annotation-card').evaluate(node=>node.getAnimations().length),0);await save(page,'没有本机偏好存储也可以批注。');assert.equal(await page.locator('.annotation-card').count(),2);
  results.push('offline full copy layout fallback without storage, reduced motion, continued editing');
 }finally{await context.close();}}
 assert.deepEqual(errors,[]);console.log('PASS '+results.join('\nPASS '));await writeFile(path.join(output,'report.json'),JSON.stringify({browser:await browser.version(),results,errors},null,2));
}finally{await browser.close();}
