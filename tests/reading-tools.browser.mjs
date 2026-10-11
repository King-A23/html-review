/* Real-browser reading/search regression, including delayed/cancelled responses. */
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {createDocxFixture} from './docx-fixtures.mjs';
import {writePdfFixture} from './pdf-fixtures.mjs';
import {ensureBackup,openAnnotationData} from './backup-ui.mjs';
import {waitPreviewLayout} from './preview-layout.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const channel=process.env.BROWSER_CHANNEL || 'chrome';
const output=path.join(root,'output/playwright/refinement',channel);await mkdir(output,{recursive:true});
const temp=await mkdtemp(path.join(os.tmpdir(),'review-reading-tools-'));
let browser,page;const errors=[],requests=[],checks=[];
async function ready(type){await page.waitForFunction(()=>!document.querySelector('#open-button').disabled);await page.locator(type==='pdf'?'.pdf-page[data-page-number="1"][data-rendered="true"]':'#preview-frame[aria-busy="false"]').waitFor();await waitPreviewLayout(page);}
async function settle(){await page.waitForFunction(()=>document.getAnimations().every(a=>a.effect?.getTiming().iterations===Infinity||['idle','finished'].includes(a.playState)),null,{timeout:5000});}
async function shot(name){await settle();await page.screenshot({path:path.join(output,name+'.png')});}
async function openSearch(){await page.locator('#document-nav-button').click();await page.locator('#document-nav-dialog').waitFor();}
async function search(query){await page.locator('#document-search').fill(query);await page.waitForFunction(()=>document.querySelector('#document-search-results').getAttribute('aria-busy')==='false');}
async function closeSearch(){await page.keyboard.press('Escape');await page.locator('#document-nav-dialog').waitFor({state:'hidden'});}
async function readData(){await openAnnotationData(page);const d=JSON.parse(await page.locator('#data-preview').textContent());await page.locator('#data-dialog [data-close]').click();await page.locator('#data-dialog').waitFor({state:'hidden'});return d;}
try{
 browser=await chromium.launch({channel,headless:true});
 for(const type of ['docx','pdf']){
  const context=await browser.newContext({viewport:{width:1440,height:960},acceptDownloads:true,offline:true});
  page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});page.on('dialog',d=>d.accept());
  const source=path.join(temp,'阅读示例.'+type);if(type==='docx')await writeFile(source,await createDocxFixture());else await writePdfFixture(source);
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.locator('#file-input').setInputFiles(source);await ready(type);
  const query=type==='docx'?'重复':'Repeated';
  await openSearch();await search(query);const count=await page.locator('#document-search-results button').count();assert.equal(count,2);assert(await page.locator('#document-search-results mark').count()>=count);
  await shot(type+'-search-desktop');await closeSearch();await openSearch();assert.equal(await page.locator('#document-search').inputValue(),query);assert.equal(await page.locator('#document-search-results button').count(),count);assert.match(await page.locator('#document-search-status').textContent(),/找到 2 处/);
  // IME Enter must finish composition, not navigate away from the input.
  await page.locator('#document-search').dispatchEvent('keydown',{key:'Enter',isComposing:true});assert(await page.locator('#document-nav-dialog').isVisible());
  await page.keyboard.press('ArrowDown');assert(await page.locator('#document-search-results button').first().evaluate(n=>n===document.activeElement));await page.keyboard.press('ArrowDown');assert(await page.locator('#document-search-results button').last().evaluate(n=>n===document.activeElement));await page.keyboard.press('Enter');await page.locator('#document-nav-dialog').waitFor({state:'hidden'});
  await page.waitForFunction(selector=>document.querySelector(selector)===document.activeElement,type==='pdf'?'#pdf-preview':'#preview-frame',{timeout:5000});
  if(type==='pdf'){await page.locator('.pdf-search-highlight.active').first().waitFor();await page.locator('#pdf-search-edit').click();assert.equal(await page.locator('#document-search-results button').count(),2);}else await openSearch();
  await page.locator('#document-search-clear').click();assert.equal(await page.locator('#document-search').inputValue(),'');assert(await page.locator('#document-outline').isVisible());
  await search('[.*<script>');assert.equal(await page.locator('#document-search-results button').count(),0);assert.match(await page.locator('.navigation-empty').textContent(),/更短的关键词/);await closeSearch();await openSearch();assert.match(await page.locator('#document-search-status').textContent(),/找到 0 处/);
  await search(query);await page.locator('#document-search').press('Enter');await page.locator('#document-nav-dialog').waitFor({state:'hidden'});
  checks.push(type+': offline search, literal input, visible keyword matches, reopen cached positive/empty results, IME, arrows, Enter and document focus');
  for(const [width,height] of [[320,740],[390,844],[760,844],[600,400]]){
   await page.setViewportSize({width,height});await waitPreviewLayout(page);await page.locator('#mobile-annotations').click();await settle();if(height<500){await page.locator('#mobile-reading').click();await page.locator('#review-sidebar').waitFor({state:'hidden'});}await openSearch();await search(query);
   const box=await page.locator('#document-nav-dialog').boundingBox(),close=await page.locator('#document-nav-dialog [data-close]').boundingBox();assert(box.x>=0&&box.x+box.width<=width+1&&box.y>=0&&box.y+box.height<=height+1);assert(close.y>=0&&close.y+close.height<=height);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await shot(type+'-search-'+width+'x'+height);
   await page.locator('#document-search-results button').last().click();await page.locator('#document-nav-dialog').waitFor({state:'hidden'});await page.locator('#review-sidebar').waitFor({state:'hidden'});
   assert.equal(await page.locator('.workspace').getAttribute('data-mobile-panel'),'closed');
   if(type==='pdf'){
    const controls=await page.locator('#pdf-controls').boundingBox();assert(controls.height<=58,'PDF controls fit one row at '+width);
    for(const id of ['pdf-thumbnail-toggle','pdf-prev-page','pdf-next-page','pdf-zoom-trigger']){const r=await page.locator('#'+id).boundingBox();assert(r.x>=0&&r.x+r.width<=width);}
    if(width===320){
     const active=await page.locator('.pdf-search-highlight.active').first().getAttribute('data-search-id');
     await page.locator('#pdf-search-next').click();await page.waitForFunction(id=>document.querySelector('.pdf-search-highlight.active')?.dataset.searchId!==id,active);
     await page.locator('#pdf-search-prev').click();await page.waitForFunction(id=>document.querySelector('.pdf-search-highlight.active')?.dataset.searchId===id,active);
     await page.locator('#pdf-search-close').click();assert(await page.locator('#pdf-search-bar').isHidden());
     const atPage=async number=>{await page.waitForFunction(n=>{const p=document.querySelector('.pdf-page[data-page-number="'+n+'"]'),v=document.querySelector('#pdf-preview');return document.querySelector('#pdf-page-number').value===String(n)&&p.dataset.rendered==='true'&&Math.abs(p.getBoundingClientRect().top-v.getBoundingClientRect().top)<30;},number);};
     await page.locator('#pdf-next-page').click();await atPage(2);
     await page.locator('#pdf-prev-page').click();await atPage(1);
     await page.locator('#pdf-page-number').fill('3');await page.locator('#pdf-page-number').press('Enter');await atPage(3);
     await page.locator('#pdf-thumbnail-toggle').click();await page.getByRole('button',{name:'跳转到第 2 页',exact:true}).click();await atPage(2);await page.locator('#pdf-thumbnail-toggle').click();assert(await page.locator('#pdf-thumbnails').isHidden());
     await page.locator('#pdf-zoom-trigger').click();await page.getByRole('option',{name:'75%',exact:true}).click();assert.equal(await page.locator('#pdf-zoom').inputValue(),'0.75');
     await page.locator('#pdf-zoom-trigger').click();await page.getByRole('option',{name:'适合宽度',exact:true}).click();assert.equal(await page.locator('#pdf-zoom').inputValue(),'fit');
     await shot('pdf-compact-controls');
     checks.push('PDF at 320px: visible search stepping/close, next/previous page, Enter page jump, thumbnails and zoom');
    }
   }
  }
  checks.push(type+': 320/390/760px and 600×400px search, visible close, no overflow and unobstructed reading after selection');
  await page.setViewportSize({width:390,height:844});await waitPreviewLayout(page);await page.locator('#mobile-annotations').click();await page.locator('.empty-list button').click();assert.equal(await page.locator('.workspace').getAttribute('data-mobile-panel'),'editor');assert(await page.locator('#comment-input').evaluate(n=>n===document.activeElement));await page.locator('#comment-input').fill('阅读工具改进不应影响原始文件和批注协议。');await page.locator('#save-button').click();
  await page.locator('#mobile-annotations').click();await page.locator('#annotation-search').fill('没有这条批注');await page.locator('.empty-list button').click();assert.equal(await page.locator('.annotation-card').count(),1);assert.equal(await page.locator('#annotation-search').inputValue(),'');assert.equal(await page.locator('#annotation-filter').inputValue(),'all');
  assert(await page.locator('#data-button').isHidden(),'technical data stays off the reading surface');await shot(type+'-mobile-list');
  const before=await readData();await page.locator('#mobile-reading').click();await openSearch();await search(query);await closeSearch();
  await ensureBackup(page);await page.locator('#export-format').selectOption('html');const pending=page.waitForEvent('download');await page.locator('#download-button').click();const copy=path.join(temp,type+'.review.html');await(await pending).saveAs(copy);
  const clean=await page.evaluate(html=>{const d=new DOMParser().parseFromString(html,'text/html');return {query:d.querySelector('#document-search').value,results:d.querySelector('#document-search-results').textContent,busy:d.querySelector('#document-search-results').getAttribute('aria-busy'),clear:d.querySelector('#document-search-clear').hidden,retry:d.querySelector('#document-search-retry').hidden,hint:d.querySelector('#document-search-hint').hidden};},await readFile(copy,'utf8'));
  assert.deepEqual(clean,{query:'',results:'',busy:null,clear:true,retry:true,hint:true});await page.goto(pathToFileURL(copy).href);await ready(type);const after=await readData();assert.deepEqual(after.annotations,before.annotations);assert.equal(after.source.sha256,before.source.sha256);await openSearch();assert.equal(await page.locator('#document-search').inputValue(),'');await search(query);assert.equal(await page.locator('#document-search-results button').count(),2);await closeSearch();
  checks.push(type+': empty-state actions, secondary data access, actual complete download, clean search state and unchanged annotations/source hash offline');
  await context.close();
 }
 // Hold search delivery to exercise cancellation/retry without timing races.
 const context=await browser.newContext({viewport:{width:1280,height:800},offline:true});page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.waitForFunction(()=>window.HRAdapters);
 await page.evaluate(()=>{const mount=HRAdapters.mount;HRAdapters.mount=(prepared,container,emit)=>{window.__readingEmit=emit;return mount(prepared,container,emit);};const command=HRAdapters.command;window.__readingCommand=command;window.__holdSearch=true;HRAdapters.command=(name,...args)=>{if(name==='search-document'&&window.__holdSearch)return;return command(name,...args);};});
 await page.locator('#file-input').setInputFiles(path.join(temp,'阅读示例.pdf'));await ready('pdf');await openSearch();await page.locator('#document-search').fill('Repeated');await page.locator('#pdf-cancel-search').click();assert.match(await page.locator('#document-search-status').textContent(),/已取消/);
 await page.evaluate(()=>window.__readingEmit({event:'document-search',query:'Repeated',total:1,items:[{index:0,text:'stale result'}]}));assert.equal(await page.locator('#document-search-results button').count(),0);await closeSearch();await openSearch();assert.match(await page.locator('#document-search-status').textContent(),/已取消/);
 await page.locator('#document-search-retry').click();await page.evaluate(()=>window.__readingEmit({event:'document-search-error',query:'Repeated'}));assert.match(await page.locator('#document-search-status').textContent(),/查找未完成/);await page.evaluate(()=>window.__holdSearch=false);await page.locator('#document-search-retry').click();await page.waitForFunction(()=>document.querySelectorAll('#document-search-results button').length===2);await closeSearch();
 await page.setViewportSize({width:390,height:844});await waitPreviewLayout(page);await page.locator('#mobile-annotations').click();await page.locator('#file-input').setInputFiles(path.join(root,'examples/pages.html'));await ready('html');assert.equal(await page.locator('.workspace').getAttribute('data-mobile-panel'),'closed');await page.locator('#mobile-annotations').click();await shot('empty-state-mobile');
 await context.close();checks.push('delayed response cancellation, stale-result rejection, preserved cancelled state, retry after failure and new document returns to reading');
 assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
 await writeFile(path.join(output,'reading-tools.json'),JSON.stringify({status:'PASS',browser:await browser.version(),checks,errors,requests},null,2));console.log('PASS '+checks.join('\nPASS '));
}catch(error){await writeFile(path.join(output,'reading-tools.json'),JSON.stringify({status:'FAIL',error:error.stack,checks,errors},null,2));if(page&&!page.isClosed())await page.screenshot({path:path.join(output,'reading-tools-failure.png')}).catch(()=>{});throw error;}
finally{await browser?.close();await rm(temp,{recursive:true,force:true});console.log('PROCESS_CLEANUP_COMPLETE');}
