import {ensureBackup} from './backup-ui.mjs';
/* Inspect intermediate frames and interruption, not only final visibility. */
import assert from 'node:assert/strict';
import {mkdir, readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output=path.join(root,'output/playwright'); await mkdir(output,{recursive:true});
let modulePath=process.env.PLAYWRIGHT_MODULE_PATH;
if(modulePath && (await stat(modulePath)).isDirectory()) modulePath=path.join(modulePath,'index.mjs');
const {chromium}=await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
let browser; const errors=[];
try {
 browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH ? {executablePath:process.env.BROWSER_PATH}: {})});
 const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true}); page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.join(root,'index.html')).href); await page.waitForFunction(()=>!document.querySelector('#open-button').disabled);
 await page.locator('#file-input').setInputFiles(path.join(root,'examples/pages.html')); await page.waitForFunction(()=>!document.querySelector('#open-button').disabled); await page.locator('#preview-frame').waitFor({state:'visible'});
 await ensureBackup(page);
 const backupReverse=await page.evaluate(()=>{
  const panel=document.querySelector('.backup-panel');
  for(const animation of panel.getAnimations()){animation.pause();animation.currentTime=150;}
  const before=getComputedStyle(panel).transform;
  window.HRUI.closeBackup(); const closing=getComputedStyle(panel).transform;
  window.HRUI.toggleBackup(); const reopening=getComputedStyle(panel).transform;
  return {before,closing,reopening,open:document.querySelector('#backup-menu').open,inert:panel.inert};
 });
 assert.equal(backupReverse.before,backupReverse.closing); assert.equal(backupReverse.closing,backupReverse.reopening); assert(backupReverse.open); assert.equal(backupReverse.inert,false);
 await page.waitForFunction(()=>document.querySelector('.backup-panel').dataset.motion==='open');
 await page.locator('#export-format-trigger').focus(); await page.keyboard.press('Escape');
 await page.waitForFunction(()=>!document.querySelector('#backup-menu').open);
 assert(await page.locator('#backup-menu summary').evaluate(e=>e===document.activeElement),'closing a disclosure returns focus to its summary');
 console.log('PASS backup reversal, keyboard dismissal and focus restoration');
 await ensureBackup(page); await page.locator('#export-format-trigger').click();
 const frames=[];
 for(const time of [35,120,300]) {
  const sample=await page.locator('.select-popover').evaluate((popup,time)=>{for(const a of popup.getAnimations({subtree:true})){a.pause();a.currentTime=time;}const style=getComputedStyle(popup); return {opacity:Number(style.opacity),transform:style.transform,clip:style.clipPath,options:Array.from(popup.querySelectorAll('.select-option'),e=>Number(getComputedStyle(e).opacity))};},time); frames.push(sample);
  await page.screenshot({path:path.join(output,'motion-menu-'+time+'.png')});
 }
 assert(frames[0].opacity<frames[1].opacity && frames[1].opacity<frames[2].opacity); assert(frames[0].options[0]<frames[0].opacity); assert(frames[1].options[0]>frames[1].options[2]);
 const menuReverse=await page.evaluate(()=>{
  const popup=document.querySelector('.select-popover'); const trigger=document.querySelector('#export-format-trigger');
  for(const a of popup.getAnimations({subtree:true})){a.pause();a.currentTime=145;}
  const before=getComputedStyle(popup).transform; trigger.click(); const closing=getComputedStyle(popup).transform; trigger.click(); const opening=getComputedStyle(popup).transform;
  return {before,closing,opening,same:document.querySelector('.select-popover')===popup,count:document.querySelectorAll('.select-popover').length,expanded:trigger.getAttribute('aria-expanded')};
 }); assert.equal(menuReverse.before,menuReverse.closing); assert.equal(menuReverse.closing,menuReverse.opening); assert(menuReverse.same); assert.equal(menuReverse.count,1); assert.equal(menuReverse.expanded,'true');
 await page.waitForFunction(()=>document.querySelector('.select-popover')?.dataset.motion==='open');
 await page.keyboard.press('End'); await page.keyboard.press('Enter'); assert.equal(await page.locator('#export-format').inputValue(),'annotations');
 await ensureBackup(page); await page.evaluate(()=>document.querySelector('#export-format-trigger').click()); await page.waitForFunction(()=>document.querySelector('.select-popover')?.dataset.motion==='open'); assert.equal(await page.getByRole('option',{selected:true}).getAttribute('data-value'),'annotations');
 await page.keyboard.press('Tab'); assert.equal(await page.locator('#download-button').evaluate(e=>e===document.activeElement),true,'loaded document exposes the next download action in keyboard order'); await page.keyboard.press('Tab'); assert.equal(await page.locator('#settings-button').evaluate(e=>e===document.activeElement),true);
 await page.locator('.select-popover').waitFor({state:'detached'});
 console.log('PASS anchored unfolding, staggered options, reverse without a jump, selected state and Tab focus');
 await page.locator('#settings-button').click();
 for(const time of [55,160,380]) {
  await page.evaluate(time=>{for(const e of [document.querySelector('#settings-dialog'),document.querySelector('.modal-scrim')]) for(const a of e.getAnimations({subtree:true})){a.pause();a.currentTime=time;}},time);
  await page.screenshot({path:path.join(output,'motion-settings-'+time+'.png')});
 }
 const dialogReverse=await page.evaluate(()=>{
  const dialog=document.querySelector('#settings-dialog'); for(const a of dialog.getAnimations({subtree:true})){a.pause();a.currentTime=180;}
  const before=getComputedStyle(dialog).transform; window.HRUI.closeDialog(dialog); const closing=getComputedStyle(dialog).transform; window.HRUI.openSettings(); const opening=getComputedStyle(dialog).transform;
  return {before,closing,opening,open:dialog.open,scrims:document.querySelectorAll('.modal-scrim').length};
 }); assert.equal(dialogReverse.before,dialogReverse.closing); assert.equal(dialogReverse.closing,dialogReverse.opening); assert(dialogReverse.open); assert.equal(dialogReverse.scrims,1);
 for(const name of ['help','shortcuts','workspace','shortcuts','help']) {await page.evaluate(name=>window.HRUI.openSettings(name),name); await page.waitForTimeout(30);}
 await page.waitForTimeout(320); assert.deepEqual(await page.locator('[data-settings-panel]:not([hidden])').evaluateAll(p=>p.map(e=>e.dataset.settingsPanel)),['help']); assert.equal(await page.locator('#help-dialog').getAttribute('inert'),null); assert.equal(await page.locator('#help-dialog').getAttribute('aria-hidden'),null);
 const repeat=await page.evaluate(()=>{
  window.HRUI.openSettings('shortcuts');
  const panel=document.querySelector('#shortcuts-dialog'), animation=panel.getAnimations()[0];
  animation.pause(); animation.currentTime=85; const before=getComputedStyle(panel).opacity;
  window.HRUI.openSettings('shortcuts'); const after=getComputedStyle(panel).opacity;
  animation.play(); return {before,after};
 }); assert.equal(repeat.before,repeat.after);
 await page.screenshot({path:path.join(output,'motion-section-switch.png')});
 await page.waitForTimeout(320);
 for(let i=0;i<8;i++){await page.evaluate(()=>window.HRUI.closeDialog(document.querySelector('#settings-dialog'))); await page.waitForTimeout(25); await page.evaluate(()=>window.HRUI.openSettings('shortcuts')); await page.waitForTimeout(25);}
 await page.keyboard.press('Escape'); await page.locator('#settings-dialog').waitFor({state:'hidden'}); assert.equal(await page.locator('.modal-scrim').count(),0); assert.equal(await page.locator('#settings-button').evaluate(e=>e===document.activeElement),true);
 console.log('PASS dialog reversal, rapid section switching, repeated close/reopen and scrim cleanup');
 await page.locator('#file-input').setInputFiles(path.join(root,'examples/pages.html')); await page.waitForFunction(()=>!document.querySelector('#open-button').disabled); await page.locator('#comment-input').fill('动效测试的整体意见'); await page.locator('#save-button').click();
 await page.locator('.save-confirmation').waitFor({state:'attached'}); assert.equal(await page.locator('.annotation-card').count(),1);
 // Export while confirmation is still visible; temporary motion must never become part of a copy.
 await ensureBackup(page); await page.locator('#export-format').selectOption('annotations'); const pending=page.waitForEvent('download'); await page.locator('#download-button').click(); const item=await pending; const file=path.join(output,'motion-export.review.json'); await item.saveAs(file); const json=JSON.parse(await readFile(file,'utf8')); assert.equal(json.annotations.length,1);
 await ensureBackup(page); await page.locator('#export-format-trigger').click(); await page.getByRole('option',{name:/完整工作区/}).click();
 await page.locator('#comment-input').fill('第二条意见'); await page.locator('#save-button').click();
 const fullPending=page.waitForEvent('download'); await ensureBackup(page); await page.locator('#download-button').click(); const full=await fullPending; const fullPath=path.join(output,'motion-export.review.html'); await full.saveAs(fullPath);
 const source=await readFile(fullPath,'utf8'); assert(!/<[^>]+data-ui-transient=/.test(source)); assert(!/<[^>]+data-motion=/.test(source));
 await page.goto(pathToFileURL(fullPath).href); await page.waitForFunction(()=>!document.querySelector('#open-button').disabled); assert.equal(await page.locator('.annotation-card').count(),2); await page.locator('#settings-button').click(); await page.keyboard.press('Escape'); await page.locator('#settings-dialog').waitFor({state:'hidden'});
 await page.emulateMedia({reducedMotion:'reduce'}); await ensureBackup(page); assert.equal(await page.locator('.backup-panel').evaluate(e=>e.getAnimations().length),0); await page.locator('#export-format-trigger').click(); assert.equal(await page.locator('.select-popover').evaluate(e=>e.getAnimations({subtree:true}).length),0); await page.keyboard.press('Escape'); assert.equal(await page.locator('.select-popover').count(),0);
 await page.locator('#settings-button').click(); assert.equal(await page.locator('#settings-dialog').evaluate(e=>e.getAnimations({subtree:true}).length),0); await page.keyboard.press('Escape'); assert.equal(await page.locator('.modal-scrim').count(),0);
 assert.deepEqual(errors,[]); console.log('PASS save feedback, transient-free export/reopen and reduced motion');
} finally {if(browser)await browser.close();console.log('PROCESS_CLEANUP_COMPLETE');}
