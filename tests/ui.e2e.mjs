/* Real-browser acceptance for custom controls, settings and semantic page targets. */
import assert from 'node:assert/strict';
import {mkdir, readFile, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output = path.join(root, 'test-results'); await mkdir(output, {recursive:true});
let modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
if (modulePath && (await stat(modulePath)).isDirectory()) modulePath = path.join(modulePath,'index.mjs');
const {chromium} = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const errors = []; let browser;
const url = pathToFileURL(path.join(root,'index.html')).href;
async function fresh(options = {}) {
 const context = await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,...options});
 const page = await context.newPage(); page.on('pageerror',e=>errors.push(e.message)); page.on('dialog',d=>d.accept());
 await page.goto(url); await page.waitForFunction(()=>!document.querySelector('#open-button').disabled);
 return {context,page};
}
async function choose(page, id, label) {await page.locator('#'+id+'-trigger').click(); await page.getByRole('option', {name:label}).click();}
async function save(page, text) {await page.locator('#comment-input').fill(text); await page.locator('#save-button').click();}
async function data(page) {await page.locator('#data-button').click(); const value = JSON.parse(await page.locator('#data-preview').textContent()); await page.keyboard.press('Escape'); await page.locator('#data-dialog').waitFor({state:'hidden'}); return value;}
async function download(page, filename) {const pending=page.waitForEvent('download'); await page.locator('#download-button').click(); const item=await pending; const destination=path.join(output,filename); await item.saveAs(destination); assert.equal(await item.failure(),null); return destination;}
try {
 browser = await chromium.launch({headless:true,...(process.env.BROWSER_PATH ? {executablePath:process.env.BROWSER_PATH}: {})});
 {
 const {context,page}=await fresh();
 try {
  await page.locator('#export-format-trigger').focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('End'); await page.keyboard.press('Enter');
  assert.equal(await page.locator('#export-format').inputValue(),'annotations'); assert.equal(await page.locator('#export-format-trigger').getAttribute('aria-expanded'),'false'); assert.equal(await page.locator('#export-format-trigger').evaluate(e=>e===document.activeElement),true);
  await page.locator('#export-format-trigger').click(); await page.keyboard.press('Escape'); await page.locator('.select-popover').waitFor({state:'detached'}); assert.equal(await page.locator('.select-popover').count(),0);
  await page.locator('#export-format-trigger').click(); await page.locator('.brand').click(); await page.locator('.select-popover').waitFor({state:'detached'}); assert.equal(await page.locator('.select-popover').count(),0);
  await page.locator('#settings-button').click(); await page.locator('[data-sidebar-choice="right"]').click();
  assert.equal(await page.locator('.workspace').getAttribute('data-sidebar-position'),'right'); assert.equal(await page.locator('[data-sidebar-choice="right"]').getAttribute('aria-pressed'),'true');
  await page.locator('#help-button').click(); assert(await page.locator('#help-dialog').isVisible()); await page.locator('#workspace-settings').waitFor({state:'hidden'});
  await page.locator('#shortcuts-button').click(); assert(await page.locator('#shortcuts-dialog').isVisible());
  assert(await page.locator('#settings-dialog').evaluate(e=>e.getAnimations().length>0));
  await page.locator('[data-close="settings-dialog"]').click(); await page.locator('#settings-dialog').waitFor({state:'hidden'}); assert.equal(await page.locator('#settings-button').evaluate(e=>e===document.activeElement),true);
  await page.locator('#settings-button').click(); await page.mouse.click(15,15); await page.locator('#settings-dialog').waitFor({state:'hidden'});
  for (const width of [1440,1280,900,760,600,390,320]) {
   await page.setViewportSize({width,height:900}); assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal app overflow at '+width);
   await page.locator('#settings-button').click(); const rect=await page.locator('#settings-dialog').boundingBox(); assert(rect.x>=0 && rect.x+rect.width<=width+1); await page.keyboard.press('Escape'); await page.locator('#settings-dialog').waitFor({state:'hidden'});
  }
  console.log('PASS custom menus, keyboard, settings navigation, animated close, focus and seven responsive widths');
 } finally {await context.close();}
 }
 {
 const {context,page}=await fresh();
 try {
  await page.locator('#file-input').setInputFiles(path.join(root,'examples/pages.html'));
  const frame=await page.locator('#preview-frame').contentFrame(); await frame.locator('#page-feedback').waitFor();
  await page.locator('[data-mode="page"]').click(); await page.waitForFunction(()=>document.querySelector('#page-select').options.length===4);
  assert(await page.locator('#target-preview').isHidden());
  await choose(page,'page-select',/02 · 每条意见/); await page.locator('#target-text').filter({hasText:'第 2 页'}).waitFor();
  await page.locator('#comment-input').fill('第二页的未保存草稿');
  await page.locator('#autosave-state').filter({hasText:'本机已保存'}).waitFor();
  await page.reload(); await page.locator('#target-text').filter({hasText:'第 2 页'}).waitFor();
  assert.equal(await page.locator('[data-mode="page"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#comment-input').inputValue(),'第二页的未保存草稿');
  await save(page,'第二页的三个步骤，请增加对应的图示。');
  await frame.locator('#page-read h2').click(); await page.locator('#target-text').filter({hasText:'第 1 页'}).waitFor();
  await page.locator('#comment-input').fill('只针对第一页的建议'); await page.locator('#clear-target').click(); assert.equal(await page.locator('#comment-input').inputValue(),'只针对第一页的建议'); assert(await page.locator('#save-button').isDisabled());
  await page.locator('[data-mode="whole"]').click(); await save(page,'全篇统一标题与页码样式。');
  let stored=await data(page); assert.equal(stored.annotations.length,2);
  const target=stored.annotations[0].target; assert.equal(target.scope,'page'); assert.equal(target.pageIndex,2); assert.equal(target.pageCount,3); assert.equal(target.selector,'#page-feedback'); assert.equal(target.tag,'section'); assert(target.textFingerprint); assert(target.domPath); assert.equal(stored.annotations[1].target.scope,'whole-document');
  await choose(page,'export-format',/轻量批注/); const json=JSON.parse(await readFile(await download(page,'pages.review.json'),'utf8')); assert.deepEqual(json.annotations[0].target,target); assert.equal(json.source.base64,undefined);
  await choose(page,'export-format',/HTML 副本/); const copy=await download(page,'pages.review.html');
  await page.goto(pathToFileURL(copy).href); await page.locator('#preview-frame').waitFor({state:'visible'}); await page.waitForFunction(()=>!document.querySelector('#open-button').disabled);
  assert.equal(await page.locator('#export-format-trigger').count(),1); await choose(page,'export-format',/压缩副本/); assert.equal(await page.locator('#export-format').inputValue(),'gzip');
  await page.locator('.annotation-card').first().locator('[data-action="locate"]').click(); await page.locator('.location-status.exact').waitFor();
  await page.locator('.annotation-card').first().locator('[data-action="edit"]').click(); assert.equal(await page.locator('[data-mode="page"]').getAttribute('aria-pressed'),'true');
  await page.locator('#comment-input').fill('第二页的三个步骤，请改为纵向排列。'); await page.locator('#save-button').click(); stored=await data(page); assert.equal(stored.annotations[0].target.selector,'#page-feedback');
  // Changing only a deck's presentation-state class must not invalidate its content evidence.
  const reopenedFrame=await page.locator('#preview-frame').contentFrame(); await reopenedFrame.locator('#page-feedback').evaluate(e=>e.classList.add('past'));
  await page.locator('.annotation-card').first().locator('[data-action="locate"]').click(); await page.locator('.location-status.exact').waitFor();
  await page.screenshot({path:path.join(output,'ui-single-page.png')});
  console.log('PASS semantic page selection, cancellation, whole scope, JSON/full export, rehydrated controls and exact relocation');
 } finally {await context.close();}
 }
 {
 const {context,page}=await fresh({reducedMotion:'reduce'});
 try {
  await page.locator('#settings-button').click(); assert.equal(await page.locator('#settings-dialog').evaluate(e=>getComputedStyle(e).animationName),'none'); await page.keyboard.press('Escape'); await page.locator('#settings-dialog').waitFor({state:'hidden'});
  await page.locator('#file-input').setInputFiles(path.join(root,'examples/finance/index.html')); await page.locator('#preview-frame').waitFor({state:'visible'}); await page.locator('[data-mode="page"]').click();
  await page.locator('#page-description').filter({hasText:'未发现明确的分页区块'}).waitFor(); assert(await page.locator('#page-select-trigger').isDisabled()); assert(await page.locator('#target-preview').isHidden());
  // A deck containing nested chapter sections must inventory leaf slides, including hidden ones.
  const deck='<html><body><div class="slides"><section><section class="slide" id="slide-one"><h2>第一页</h2></section><section class="slide future" id="slide-two" hidden><h2>第二页</h2></section></section></div></body></html>';
  await page.locator('#file-input').setInputFiles({name:'deck.html',mimeType:'text/html',buffer:Buffer.from(deck)}); await page.waitForFunction(()=>document.querySelector('#page-select').options.length===3); await page.locator('[data-mode="page"]').click(); await choose(page,'page-select',/02 · 第二页/);
  await page.locator('#status').filter({hasText:'当前不可见'}).waitFor(); assert.match(await page.locator('#target-text').textContent(),/第 2 页/); await save(page,'只修改第二张幻灯片。');
  const stored=await data(page); assert.equal(stored.annotations[0].target.selector,'#slide-two'); assert.equal(stored.annotations[0].target.pageCount,2);
  console.log('PASS reduced motion, unpaginated content and nested hidden slides');
 } finally {await context.close();}
 }
 assert.deepEqual(errors,[],'no application errors');
 await writeFile(path.join(output,'ui-report.json'),JSON.stringify({status:'passed',errors,checks:3},null,2));
} finally {if(browser) await browser.close(); console.log('PROCESS_CLEANUP_COMPLETE');}
