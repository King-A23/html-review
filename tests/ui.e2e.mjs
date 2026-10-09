import {ensureBackup} from './backup-ui.mjs';
/* Real-browser acceptance for custom controls, settings and semantic page targets. */
import assert from 'node:assert/strict';
import {mkdir, readFile, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output = path.join(root, 'test-results'); await mkdir(output, {recursive:true});
const designOutput = path.join(root, 'output/playwright/design'); await mkdir(designOutput, {recursive:true});
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
async function choose(page, id, label) {if(id==='export-format') await ensureBackup(page); await page.locator('#'+id+'-trigger').click(); await page.getByRole('option', {name:label}).click();}
async function save(page, text) {await page.locator('#comment-input').fill(text); await page.locator('#save-button').click();}
async function data(page) {await page.locator('#data-button').click(); const value = JSON.parse(await page.locator('#data-preview').textContent()); await page.keyboard.press('Escape'); await page.locator('#data-dialog').waitFor({state:'hidden'}); return value;}
async function download(page, filename) {const pending=page.waitForEvent('download'); await ensureBackup(page); await page.locator('#download-button').click(); const item=await pending; const destination=path.join(output,filename); await item.saveAs(destination); assert.equal(await item.failure(),null); return destination;}
try {
 browser = await chromium.launch({headless:true,...(process.env.BROWSER_PATH ? {executablePath:process.env.BROWSER_PATH}: {})});
 {
 const {context,page}=await fresh();
 try {
  await page.locator('#welcome').evaluate(async node=>{await Promise.all(node.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{})));});
  // The opening action must stay discoverable, including a short laptop window.
  for (const [width,height] of [[1440,900],[1280,720],[900,900],[760,900],[600,900],[390,844],[320,740]]) {
   await page.setViewportSize({width,height});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'opening view has no horizontal overflow at '+width);
   const action=await page.locator('#welcome-open').boundingBox();
   assert(action && action.y>=0 && action.y+action.height<=height,'open action is in the first viewport at '+width);
   await page.waitForTimeout(150);
   await page.screenshot({animations:'disabled',path:path.join(designOutput,'welcome-'+width+'.png'),fullPage:true});
  }
  await page.setViewportSize({width:1440,height:1000});
  assert.equal(await page.locator('.save-key-hint').textContent(), process.platform === 'darwin' ? '⌘ ↵' : 'Ctrl ↵');
  assert.equal(await page.locator('.welcome-shortcut kbd').first().textContent(), process.platform === 'darwin' ? '⌘' : 'Ctrl');
  assert.equal(await page.locator('#export-format-trigger').isVisible(),false,'Export controls appear only after opening a document');
  await page.locator('#file-input').setInputFiles(path.join(root,'examples/pages.html')); await page.locator('#preview-frame').waitFor({state:'visible'}); await page.waitForFunction(()=>!document.querySelector('#open-button').disabled);
  await page.screenshot({path:path.join(designOutput,'workspace.png')});
  await ensureBackup(page); await page.locator('#export-format-trigger').focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('End'); await page.keyboard.press('Enter');
  assert.equal(await page.locator('#export-format').inputValue(),'annotations'); assert.equal(await page.locator('#export-format-trigger').getAttribute('aria-expanded'),'false'); assert.equal(await page.locator('#export-format-trigger').evaluate(e=>e===document.activeElement),true);
  await ensureBackup(page); await page.locator('#export-format-trigger').click(); await page.keyboard.press('Escape'); await page.locator('.select-popover').waitFor({state:'detached'}); assert.equal(await page.locator('.select-popover').count(),0);
  await ensureBackup(page); await page.locator('#export-format-trigger').click(); await page.locator('.brand').click(); await page.locator('.select-popover').waitFor({state:'detached'}); assert.equal(await page.locator('.select-popover').count(),0);
  await page.locator('#settings-button').click(); await page.locator('[data-sidebar-choice="right"]').click();
  assert.equal(await page.locator('.workspace').getAttribute('data-sidebar-position'),'right'); assert.equal(await page.locator('[data-sidebar-choice="right"]').getAttribute('aria-pressed'),'true');
  await page.waitForFunction(()=>document.querySelector('#settings-dialog').dataset.motion==='open');
  await page.screenshot({path:path.join(designOutput,'settings.png')});
  await page.locator('#help-button').click(); assert(await page.locator('#help-dialog').isVisible()); await page.locator('#workspace-settings').waitFor({state:'hidden'});
  await page.locator('#shortcuts-button').click(); assert(await page.locator('#shortcuts-dialog').isVisible());
  assert(await page.locator('#settings-dialog').evaluate(e=>e.getAnimations().length>0));
  await page.locator('[data-close="settings-dialog"]').click(); await page.locator('#settings-dialog').waitFor({state:'hidden'}); assert.equal(await page.locator('#settings-button').evaluate(e=>e===document.activeElement),true);
  await page.locator('#settings-button').click(); await page.mouse.click(15,15); await page.locator('#settings-dialog').waitFor({state:'hidden'});
  await save(page,'有批注时，所有主要操作在窄屏也应保持可用。');
  await page.locator('#handoff-button').waitFor({state:'visible'});
  for (const width of [1440,1280,900,760,600,390,320]) {
   await page.setViewportSize({width,height:900}); assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal app overflow at '+width);
   if(width<=390){await ensureBackup(page);const menuRect=await page.locator('.backup-panel').boundingBox();assert(menuRect.x>=0 && menuRect.x+menuRect.width<=width+1,'backup remains inside narrow screens');await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#backup-menu').open);await page.screenshot({path:path.join(designOutput,'review-'+width+'.png'),fullPage:true});}
   await page.locator('#settings-button').click(); const rect=await page.locator('#settings-dialog').boundingBox(); assert(rect.x>=0 && rect.x+rect.width<=width+1); await page.keyboard.press('Escape'); await page.locator('#settings-dialog').waitFor({state:'hidden'});
  }
  console.log('PASS custom menus, keyboard, settings navigation, animated close, focus and seven responsive widths');
 } catch(error) {await page.screenshot({path:path.join(designOutput,'failure.png'),fullPage:true}); console.log(await page.evaluate(()=>({mode:document.querySelector('[data-mode][aria-pressed=true]')?.dataset.mode,target:document.querySelector('#target-text').textContent,status:document.querySelector('#status').textContent}))); throw error;} finally {await context.close();}
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
  await page.locator('#preview-frame[aria-busy="false"]').waitFor({state:'visible'});
  assert.equal(await page.locator('[data-mode="page"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#comment-input').inputValue(),'第二页的未保存草稿');
  await save(page,'第二页的三个步骤，请增加对应的图示。');
  await frame.locator('#page-read h2').click(); await page.locator('#target-text').filter({hasText:'第 1 页'}).waitFor();
  await page.locator('#comment-input').fill('只针对第一页的建议'); await page.locator('#clear-target').click(); assert.equal(await page.locator('#comment-input').inputValue(),'只针对第一页的建议'); assert(await page.locator('#save-button').isDisabled());
  await page.locator('[data-mode="browse"]').click(); await save(page,'全篇统一标题与页码样式。');
  let stored=await data(page); assert.equal(stored.annotations.length,2);
  const target=stored.annotations[0].target; assert.equal(target.scope,'page'); assert.equal(target.pageIndex,2); assert.equal(target.pageCount,3); assert.equal(target.selector,'#page-feedback'); assert.equal(target.tag,'section'); assert(target.textFingerprint); assert(target.domPath); assert.equal(stored.annotations[1].target.scope,'whole-document');
  await choose(page,'export-format',/单独批注/); const json=JSON.parse(await readFile(await download(page,'pages.review.json'),'utf8')); assert.deepEqual(json.annotations[0].target,target); assert.equal(json.source.base64,undefined);
  await choose(page,'export-format',/完整工作区/); const copy=await download(page,'pages.review.html');
  await page.goto(pathToFileURL(copy).href); await page.locator('#preview-frame').waitFor({state:'visible'}); await page.waitForFunction(()=>!document.querySelector('#open-button').disabled);
  assert.equal(await page.locator('#export-format-trigger').count(),1); await choose(page,'export-format',/压缩工作区/); assert.equal(await page.locator('#export-format').inputValue(),'gzip');
  await page.locator('.annotation-card').first().locator('[data-action="locate"]').click(); await page.locator('.location-status.exact').waitFor();
  await page.locator('.annotation-card').first().locator('[data-action="edit"]').click(); assert.equal(await page.locator('[data-mode="page"]').getAttribute('aria-pressed'),'true');
  await page.locator('#comment-input').fill('第二页的三个步骤，请改为纵向排列。'); await page.locator('#save-button').click(); stored=await data(page); assert.equal(stored.annotations[0].target.selector,'#page-feedback');
  // Changing only a deck's presentation-state class must not invalidate its content evidence.
  const reopenedFrame=await page.locator('#preview-frame').contentFrame(); await reopenedFrame.locator('#page-feedback').evaluate(e=>e.classList.add('past'));
  await page.locator('.annotation-card').first().locator('[data-action="locate"]').click(); await page.locator('.location-status.exact').waitFor();
  await page.screenshot({path:path.join(output,'ui-single-page.png')});
  console.log('PASS semantic page selection, cancellation, whole scope, JSON/full export, rehydrated controls and exact relocation');
 } catch(error) {await page.screenshot({path:path.join(designOutput,'failure.png'),fullPage:true}); console.log(await page.evaluate(()=>({mode:document.querySelector('[data-mode][aria-pressed=true]')?.dataset.mode,target:document.querySelector('#target-text').textContent,status:document.querySelector('#status').textContent}))); throw error;} finally {await context.close();}
 }
 {
 const {context,page}=await fresh({reducedMotion:'reduce'});
 try {
  await page.locator('#settings-button').click(); assert.equal(await page.locator('#settings-dialog').evaluate(e=>getComputedStyle(e).animationName),'none'); await page.keyboard.press('Escape'); await page.locator('#settings-dialog').waitFor({state:'hidden'});
  await page.locator('#file-input').setInputFiles(path.join(root,'examples/finance/index.html')); await page.locator('#preview-frame').waitFor({state:'visible'}); await page.locator('[data-mode="page"]').click();
  await page.locator('#workflow-details-toggle').click(); assert.equal(await page.locator('#workflow-details').evaluate(node=>node.getAnimations().length),0);
  await page.locator('#page-description').filter({hasText:'未发现明确的分页区块'}).waitFor(); assert(await page.locator('#page-select-trigger').isDisabled()); assert(await page.locator('#target-preview').isHidden());
  // A deck containing nested chapter sections must inventory leaf slides, including hidden ones.
  const deck='<html><body><div class="slides"><section><section class="slide" id="slide-one"><h2>第一页</h2></section><section class="slide future" id="slide-two" hidden><h2>第二页</h2></section></section></div></body></html>';
  await page.locator('#file-input').setInputFiles({name:'deck.html',mimeType:'text/html',buffer:Buffer.from(deck)}); await page.waitForFunction(()=>document.querySelector('#page-select').options.length===3); await page.locator('[data-mode="page"]').click(); await choose(page,'page-select',/02 · 第二页/);
  await page.locator('#status').filter({hasText:'当前不可见'}).waitFor(); assert.match(await page.locator('#target-text').textContent(),/第 2 页/); await save(page,'只修改第二张幻灯片。');
  const stored=await data(page); assert.equal(stored.annotations[0].target.selector,'#slide-two'); assert.equal(stored.annotations[0].target.pageCount,2);
  console.log('PASS reduced motion, unpaginated content and nested hidden slides');
 } catch(error) {await page.screenshot({path:path.join(designOutput,'failure.png'),fullPage:true}); console.log(await page.evaluate(()=>({mode:document.querySelector('[data-mode][aria-pressed=true]')?.dataset.mode,target:document.querySelector('#target-text').textContent,status:document.querySelector('#status').textContent}))); throw error;} finally {await context.close();}
 }
 {
 const {context,page}=await fresh();
 try {
  await page.locator('#file-input').setInputFiles(path.join(root,'examples/pages.html'));
  await page.locator('#preview-frame[aria-busy="false"]').waitFor({state:'visible'});
  assert.deepEqual(await page.locator('.mode-tabs button:not([hidden])').evaluateAll(nodes=>nodes.map(node=>node.dataset.mode)),['browse','text','element','page']);
  assert.equal(await page.locator('[data-mode="whole"]').count(),0,'whole feedback shares browse instead of adding a duplicate mode');
  for(const legacyMode of ['whole','page']) {
   await page.locator('[data-mode="browse"]').click();
   const comment='旧版 '+legacyMode+' 整体意见草稿';
   await page.locator('#comment-input').fill(comment);
   await page.evaluate(async ({legacyMode,comment})=>{
    const key='workspace:'+location.href.split('#')[0];
    const deadline=Date.now()+5000;
    while(Date.now()<deadline){
     const record=await window.HRSession.load(key);
     if(record?.draft.comment===comment && record.draft.mode==='browse'){
      record.draft.mode=legacyMode;
      await window.HRSession.save(key,record);return;
     }
     await new Promise(resolve=>setTimeout(resolve,30));
    }
    throw new Error('merged-mode draft was not saved');
   },{legacyMode,comment});
   await page.reload();
   await page.locator('#preview-frame[aria-busy="false"]').waitFor({state:'visible'});
   assert.equal(await page.locator('[data-mode="browse"]').getAttribute('aria-pressed'),'true');
   assert.equal(await page.locator('#comment-input').inputValue(),comment);
   await page.locator('#save-button').click();
  }
  const stored=await data(page);
  assert.equal(stored.annotations.length,2);
  for(const annotation of stored.annotations){assert.equal(annotation.kind,'page');assert.equal(annotation.target.scope,'whole-document');}
  await page.locator('.annotation-card').first().locator('[data-action="edit"]').click();
  assert.equal(await page.locator('[data-mode="browse"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#draft-status').textContent(),'');
  console.log('PASS merged browse/whole mode, legacy whole/page drafts and existing whole opinion editing');
 } finally {await context.close();}
 }
 {
 const {context,page}=await fresh();
 try {
  await page.locator('#file-input').setInputFiles(path.join(root,'examples/pages.html'));
  const frame=page.locator('#preview-frame').contentFrame();
  await page.locator('#preview-frame[aria-busy="false"]').waitFor();
  await frame.locator('#page-feedback').waitFor();
  await frame.locator('body').evaluate(() => new Promise(resolve => {if(document.readyState==='complete')resolve();else window.addEventListener('load',resolve,{once:true});}));
  assert.equal(await page.locator('#comment-scope').textContent(),'整份文档');
  assert(await page.locator('#target-preview').isHidden(),'Whole scope uses the compact input badge rather than repeating the filename');
  await page.locator('#onboarding-card').waitFor({state:'visible'});
  const expandedHeight=(await page.locator('#result-review').boundingBox()).height;
  await page.locator('#workflow-details-toggle').click();
  await page.locator('#workflow-details').waitFor({state:'hidden'});
  assert.equal(await page.locator('#workflow-details-toggle').getAttribute('aria-expanded'),'false');
  assert.equal(await page.locator('#workflow-details').evaluate(node=>node.inert),true);
  const compactHeight=(await page.locator('#result-review').boundingBox()).height;
  assert(expandedHeight-compactHeight>=65,'Collapsing explanations returns meaningful room to the document');
  await page.reload(); await page.locator('#preview-frame[aria-busy="false"]').waitFor();
  await page.locator('#comment-scope').filter({hasText:'整份文档'}).waitFor();
  assert(await page.locator('#workflow-details').isHidden(),'The first deliberate collapse persists across reload');
  await page.locator('[data-mode=text]').click();
  assert.equal(await page.locator('#comment-scope').textContent(),'请先选择文字');
  assert(await page.locator('#mode-hint').isVisible());
  await frame.locator('#page-feedback').evaluate(node=>{const range=document.createRange();range.selectNodeContents(node);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);node.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
  await page.locator('#comment-scope').filter({hasText:'所选文字'}).waitFor();
  assert(await page.locator('#target-preview').isVisible()); assert(await page.locator('#mode-hint').isHidden());
  const originalSummary=await page.locator('#target-text').textContent();
  const closedHeight=(await page.locator('#target-preview').boundingBox()).height;
  await page.locator('#target-summary-toggle').click();
  await page.locator('#target-preview').evaluate(async node=>{await Promise.all(node.getAnimations().map(animation=>animation.finished.catch(()=>{})));});
  assert((await page.locator('#target-preview').boundingBox()).height>closedHeight,'Long target summaries can be opened');
  assert.equal(await page.locator('#target-text').textContent(),originalSummary);
  await page.locator('#target-summary-toggle').click();
  await page.locator('#comment-input').fill('精简这里的内容，保留三个步骤。');
  await page.locator('#clear-target').click();
  assert.equal(await page.locator('#comment-scope').textContent(),'请先选择文字');
  assert.equal(await page.locator('#comment-input').inputValue(),'精简这里的内容，保留三个步骤。');
  assert(await page.locator('#save-button').isDisabled());
  await page.locator('[data-mode=browse]').click();
  assert.equal(await page.locator('#comment-scope').textContent(),'整份文档');
  await save(page,'全篇统一术语。');
  await page.locator('[data-mode=element]').click(); await frame.locator('#page-read h2').click();
  await page.locator('#comment-scope').filter({hasText:'所选元素'}).waitFor();
  await save(page,'精简这个标题。');
  await page.locator('.annotation-card').nth(1).locator('[data-action=edit]').click();
  await page.locator('[data-mode=browse]').click();
  assert.equal(await page.locator('#comment-scope').textContent(),'所选元素','Browsing while editing keeps the existing local target');
  assert(await page.locator('#mode-hint').isVisible());
  await page.locator('#cancel-edit').click();
  assert.equal(await page.locator('#comment-scope').textContent(),'整份文档');
  // Pause at an intermediate frame and reverse twice. Geometry must remain continuous.
  await page.locator('#workflow-details-toggle').click();
  const reversal=await page.evaluate(()=>{
    const panel=document.querySelector('#workflow-details'),toggle=document.querySelector('#workflow-details-toggle');
    for(const animation of panel.getAnimations()){animation.pause();animation.currentTime=140;}
    const before=panel.getBoundingClientRect().height;toggle.click();const closing=panel.getBoundingClientRect().height;toggle.click();const opening=panel.getBoundingClientRect().height;
    return {before,closing,opening,inert:panel.inert,expanded:toggle.getAttribute('aria-expanded')};
  });
  assert(Math.abs(reversal.before-reversal.closing)<1 && Math.abs(reversal.closing-reversal.opening)<1,'Disclosure reverses from its current size');
  assert.equal(reversal.inert,false);assert.equal(reversal.expanded,'true');
  await page.locator('#workflow-details').evaluate(async node=>{await Promise.all(node.getAnimations().map(animation=>animation.finished.catch(()=>{})));});
  await page.locator('#workflow-details-toggle').click();await page.locator('#workflow-details').waitFor({state:'hidden'});
  await page.screenshot({path:path.join(designOutput,'workspace-compact.png')});
  for(const width of [1280,900,760,390,320]) {
    await page.setViewportSize({width,height:900});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Compact workflow fits '+width+'px');
    const badge=await page.locator('#comment-scope').boundingBox(),sidebar=await page.locator('.sidebar').boundingBox();
    assert(badge.x>=sidebar.x && badge.x+badge.width<=sidebar.x+sidebar.width,'Scope badge stays inside the editor');
  }
  console.log('PASS compact workflow, persistent preference, accessible reversal, scope changes, preserved drafts and local editing');
 } catch(error){await page.screenshot({path:path.join(designOutput,'polish-failure.png'),fullPage:true});throw error;} finally {await context.close();}
 }
 assert.deepEqual(errors,[],'no application errors');
 await writeFile(path.join(output,'ui-report.json'),JSON.stringify({status:'passed',errors,checks:5},null,2));
} finally {if(browser) await browser.close(); console.log('PROCESS_CLEANUP_COMPLETE');}
