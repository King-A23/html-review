/* Invalid PDF, cancellation, password privacy and text range boundaries. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {writePdfFixture,PDF_PASSWORD} from './pdf-fixtures.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),temp=await mkdtemp(path.join(tmpdir(),'html-review-pdf-errors-'));
let browser;const contexts=[],errors=[];
const ready=page=>page.waitForFunction(()=>!document.getElementById('open-button').disabled,null,{timeout:40000});
const rendered=(page,n=1)=>page.locator(`.pdf-page[data-page-number="${n}"][data-rendered="true"]`).waitFor();
async function newPage(init){const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});contexts.push(context);if(init)await context.addInitScript(init);const page=await context.newPage();page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(e.message));await page.goto(pathToFileURL(path.join(root,'index.html')).href);await ready(page);return page;}
async function open(page,file){await page.locator('#file-input').setInputFiles(file);}
async function exportData(page,format='annotations'){await page.locator('#export-format').selectOption(format);const pending=page.waitForEvent('download');await page.locator('#download-button').click();const file=path.join(temp,format+'-'+Date.now()+'.'+(format==='html'?'html':'json'));await(await pending).saveAs(file);return await readFile(file,'utf8');}
async function save(page,comment){await page.locator('#comment-input').fill(comment);await page.locator('#save-button').click();}
try {
  browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||undefined,headless:true});
  const files={};for(const name of ['base','encrypted','corrupt','page-limit']){files[name]=path.join(temp,name+'.pdf');await writePdfFixture(files[name],name);}
  const page=await newPage();await open(page,files.base);await ready(page);await rendered(page);await save(page,'保留现有整体意见。');const original=JSON.parse(await exportData(page));
  await page.locator('#comment-input').fill('保留未保存草稿');
  for(const [name,pattern] of [['corrupt',/损坏|不受支持/],['page-limit',/1000 页/]]){await open(page,files[name]);await ready(page);assert.match(await page.locator('#status').textContent(),pattern);assert.equal(await page.locator('#source-name').textContent(),'base.pdf');assert.equal(await page.locator('#annotation-count').textContent(),'1');assert.equal(await page.locator('#comment-input').inputValue(),'保留未保存草稿');}
  const fake=path.join(temp,'fake.pdf');await writeFile(fake,'not a PDF');await open(page,fake);await ready(page);assert.match(await page.locator('#status').textContent(),/PDF/);
  const big=path.join(temp,'big.pdf');await writeFile(big,Buffer.alloc(20*1024*1024+1));await open(page,big);await ready(page);assert.match(await page.locator('#status').textContent(),/20 MiB/);
  await open(page,files.encrypted);await page.locator('#pdf-password-dialog').waitFor({state:'visible'});await page.locator('#pdf-password-input').fill('wrong-password');await page.locator('#pdf-password-submit').click();await page.locator('#pdf-password-error').filter({hasText:'不正确'}).waitFor();await page.locator('#pdf-password-cancel').click();await ready(page);assert.equal(await page.locator('#source-name').textContent(),'base.pdf');assert.equal(await page.locator('#annotation-count').textContent(),'1');assert.equal(await page.locator('#comment-input').inputValue(),'保留未保存草稿');assert.equal(await page.locator('#pdf-password-input').inputValue(),'');
  for(const dismissal of ['escape','backdrop']) {
    await open(page,files.encrypted);await page.locator('#pdf-password-dialog').waitFor({state:'visible'});await page.locator('#pdf-password-input').fill('must-not-persist');
    if(dismissal==='escape')await page.keyboard.press('Escape');else await page.mouse.click(5,5);
    await page.locator('#pdf-password-dialog').waitFor({state:'hidden'});await ready(page);
    assert.equal(await page.locator('#source-name').textContent(),'base.pdf');assert.equal(await page.locator('#annotation-count').textContent(),'1');assert.equal(await page.locator('#comment-input').inputValue(),'保留未保存草稿');assert.equal(await page.locator('#pdf-password-input').inputValue(),'');
  }
  await open(page,files.encrypted);await page.locator('#pdf-password-dialog').waitFor({state:'visible'});await page.locator('#pdf-password-input').fill(PDF_PASSWORD);await page.locator('#pdf-password-submit').click();await page.locator('#pdf-password-dialog').waitFor({state:'hidden'});await ready(page);await rendered(page);assert.equal(await page.locator('#pdf-password-input').inputValue(),'');await save(page,'加密文档整体意见。');
  const light=await exportData(page),full=await exportData(page,'html');assert(!light.includes(PDF_PASSWORD));assert(!full.includes(PDF_PASSWORD));assert(!full.includes('wrong-password'));const fullPath=path.join(temp,'encrypted.review.html');await writeFile(fullPath,full);
  const reopened=await newPage();await reopened.goto(pathToFileURL(fullPath).href);await reopened.locator('#pdf-password-dialog').waitFor({state:'visible'});await reopened.locator('#pdf-password-input').fill(PDF_PASSWORD);await reopened.locator('#pdf-password-submit').click();await reopened.locator('#pdf-password-dialog').waitFor({state:'hidden'});await ready(reopened);await rendered(reopened);assert.equal(await reopened.locator('#annotation-count').textContent(),'1');
  // Real DOM ranges isolate boundary cases while selection capture remains the real product handler.
  const ranges=await newPage();await open(ranges,files.base);await ready(ranges);await rendered(ranges,2);await ranges.locator('[data-mode=text]').click();
  await ranges.evaluate(()=>{const spans=[...document.querySelectorAll('[data-pdf-page="1"][data-pdf-item]')],a=spans.find(n=>n.textContent==='Bold'),b=spans.find(n=>n.textContent==='Purple');const r=document.createRange();r.setStart(a.firstChild,0);r.setEnd(b.firstChild,b.textContent.length);document.getElementById('pdf-preview').focus();const s=getSelection();s.removeAllRanges();s.addRange(r);b.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0}));});
  await ranges.locator('#target-text').filter({hasText:'Bold'}).waitFor();await save(ranges,'跨样式文字。');const styled=JSON.parse(await exportData(ranges));assert(styled.annotations[0].target.pdf.pages[0].segments.length>=3);assert(styled.annotations[0].target.quote.exact.includes('Italic'));
  await ranges.evaluate(()=>{const all=[...document.querySelectorAll('[data-pdf-page="1"][data-pdf-item]')].filter(n=>n.textContent),a=all.at(-1),b=[...document.querySelectorAll('[data-pdf-page="2"][data-pdf-item]')].find(n=>n.textContent);const r=document.createRange();r.setStart(a.firstChild,0);r.setEnd(b.firstChild,b.textContent.length);document.getElementById('pdf-preview').focus();const s=getSelection();s.removeAllRanges();s.addRange(r);b.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0}));});
  await ranges.locator('#target-text').filter({hasText:'Two-column'}).waitFor();await save(ranges,'跨相邻页面。');const cross=JSON.parse(await exportData(ranges));assert.deepEqual(cross.annotations[1].target.pdf.pages.map(p=>p.pageNumber),[1,2]);
  await ranges.locator('[data-mode=text]').click();await ranges.locator('.pdf-page[data-page-number="1"]').click({position:{x:12,y:12}});await ranges.locator('#comment-input').fill('选区已取消');assert.equal(await ranges.locator('#save-button').isEnabled(),false);await ranges.locator('#cancel-edit').click();
  const pair=path.join(temp,'pair.json');await writeFile(pair,JSON.stringify(original));await open(ranges,pair);await ready(ranges);await open(ranges,files.encrypted);await ready(ranges);assert.match(await ranges.locator('#status').textContent(),/版本不一致/);assert(await ranges.locator('#pair-source').isVisible());assert.equal(await ranges.locator('#annotation-count').textContent(),'2');await ranges.locator('#cancel-pair').click();
  // A deliberately unresponsive Worker verifies both cancellation and the actual 30s timeout.
  const stalled=await newPage(()=>{const Native=Worker;window.__stall=false;window.__terminated=0;window.Worker=class {constructor(...args){if(!window.__stall)return new Native(...args);}postMessage(){}addEventListener(){}removeEventListener(){}terminate(){window.__terminated++;}};});
  await open(stalled,files.base);await ready(stalled);await rendered(stalled);await save(stalled,'超时前原工作区。');await stalled.evaluate(()=>window.__stall=true);await open(stalled,files.base);await stalled.locator('#cancel-conversion').waitFor({state:'visible'});await stalled.locator('#cancel-conversion').click();await ready(stalled);assert.equal(await stalled.locator('#annotation-count').textContent(),'1');await stalled.waitForFunction(()=>window.__terminated>0);
  await open(stalled,files.base);await ready(stalled);assert.match(await stalled.locator('#status').textContent(),/30 秒/);assert.equal(await stalled.locator('#annotation-count').textContent(),'1');
  assert.deepEqual(errors,[]);console.log('PASS PDF invalid/oversized/1001pages/password privacy/cancel/30s timeout; cross-style/cross-page exact range and pairing rejection');
} finally {for(const c of contexts)await c.close().catch(()=>{});await browser?.close();await rm(temp,{recursive:true,force:true});}
