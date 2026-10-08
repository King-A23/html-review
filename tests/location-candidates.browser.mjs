/* Read-only candidate discovery and explicit preview checks; no server required. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
let modulePath=process.env.PLAYWRIGHT_MODULE_PATH;
if(modulePath) {
 modulePath=modulePath.startsWith('file:')?fileURLToPath(modulePath):path.resolve(modulePath);
 if((await fs.stat(modulePath)).isDirectory()) modulePath=path.join(modulePath,'index.mjs');
}
const {chromium}=await import(modulePath?pathToFileURL(modulePath).href:'playwright');
const source=await fs.readFile(new URL('../src/bridge.js',import.meta.url),'utf8');
const mock={};new Function('window',source)(mock);
let browser;
try {
 browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
 const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 let frame,sequence=0;
 async function setup(body,meta=null) {
  await page.setContent('<iframe sandbox="allow-scripts" style="width:900px;height:400px"></iframe>');
  const invoke='('+mock.HRBridge.toString()+')('+JSON.stringify('candidates')+',undefined,'+JSON.stringify(meta)+')';
  await page.evaluate(html=>{window.messages=[];addEventListener('message',e=>{if(e.data?.hr)window.messages.push(e.data)});document.querySelector('iframe').srcdoc=html;}, '<!doctype html><html><body>'+body+'<script data-html-review-owned="bridge">'+invoke+'</script></body></html>');
  await page.waitForFunction(()=>window.messages.some(m=>m.event==='ready'));frame=page.frames().find(f=>f!==page.mainFrame());
 }
 async function command(payload) {await page.evaluate(payload=>document.querySelector('iframe').contentWindow.postMessage({hr:true,channel:'candidates',...payload},'*'),payload);}
 async function candidates(target) {
  const requestId='candidate-'+ ++sequence,locationToken='version-'+sequence;
  await command({command:'review-candidates',requestId,locationToken,target});
  await page.waitForFunction(id=>window.messages.some(m=>m.event==='review-candidates'&&m.requestId===id),requestId);
  const result=await page.evaluate(id=>window.messages.find(m=>m.event==='review-candidates'&&m.requestId===id),requestId);
  assert.equal(result.locationToken,locationToken);return result;
 }
 async function capture(id,kind) {
  await command({command:'set-mode',mode:kind});await candidates({kind:'unknown'});
  const before=await page.evaluate(()=>window.messages.length);
  await frame.locator('#'+id).evaluate((element,kind)=>{
   if(kind==='text') {const range=document.createRange();range.selectNodeContents(element);getSelection().removeAllRanges();getSelection().addRange(range);element.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));}
   else element.dispatchEvent(new MouseEvent('click',{bubbles:true}));
  },kind);
  await page.waitForFunction(before=>window.messages.slice(before).some(m=>m.event==='target'),before);
  return page.evaluate(before=>window.messages.slice(before).find(m=>m.event==='target').target,before);
 }
 async function snapshot() {return frame.evaluate(()=>({scroll:[scrollX,scrollY],selection:getSelection().toString(),anchorOffset:getSelection().anchorOffset,focusOffset:getSelection().focusOffset,active:document.activeElement.id,overlays:document.querySelectorAll('[data-html-review-owned="overlay"]').length}));}
 await setup('<input id="pending"><p id="chosen">Original selection</p><section class="slide" id="pageA"><h2>Page A</h2><button id="changed">Original button</button></section><section class="slide" id="pageB"><h2>Page B</h2></section>'+Array.from({length:8},(_,i)=>'<p>Context '+i+' repeated quote tail '+i+'</p>').join('')+'<div style="height:1500px"></div><p id="bottom">Bottom</p>');
 // A synthetic selection may precede delivery of the parent's mode message.
 await frame.locator('#chosen').evaluate(element=>{
  const range=document.createRange();range.selectNodeContents(element);getSelection().removeAllRanges();getSelection().addRange(range);
  element.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
  // A queued clear from the preceding save must not erase the new snapshot.
  getSelection().removeAllRanges();
  dispatchEvent(new MessageEvent('message',{source:parent,data:{hr:true,channel:'candidates',command:'set-mode',mode:'text'}}));
 });
 await page.waitForFunction(()=>window.messages.some(m=>m.event==='target'&&m.target.text==='Original selection'));
 const original=await capture('chosen','text');
 // Only a save bounded to the previous acknowledgement may preserve new input.
 const acknowledged=await page.evaluate(()=>window.messages.filter(m=>m.event==='target').at(-1).selectionSerial);
 assert(Number.isSafeInteger(acknowledged));
 async function queuedSelection(action) {
  const count=await page.evaluate(()=>window.messages.filter(m=>m.event==='target').length);
  await frame.locator('#chosen').evaluate((element,{action,acknowledged})=>{
   const range=document.createRange();range.selectNodeContents(element);getSelection().removeAllRanges();getSelection().addRange(range);
   element.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
   const deliver=data=>dispatchEvent(new MessageEvent('message',{source:parent,data:{hr:true,channel:'candidates',...data}}));
   if(action==='prior-save')deliver({command:'clear-selection',throughSelectionSerial:acknowledged});
   if(action==='cancel')deliver({command:'clear-selection'});
   if(action==='browse') {deliver({command:'set-mode',mode:'browse'});deliver({command:'set-mode',mode:'text'});}
  },{action,acknowledged});
  await frame.evaluate(()=>new Promise(resolve=>setTimeout(resolve,20)));
  return (await page.evaluate(()=>window.messages.filter(m=>m.event==='target').length))-count;
 }
 assert.equal(await queuedSelection('prior-save'),1,'A prior save must preserve a genuinely newer selection');
 assert.equal(await frame.evaluate(()=>getSelection().toString()),'Original selection');
 assert.equal(await queuedSelection('cancel'),0,'An intentional clear must invalidate the queued target');
 assert.equal(await frame.evaluate(()=>getSelection().rangeCount),0);
 assert.equal(await queuedSelection('browse'),0,'Switching to browse must invalidate snapshots even after returning to text');

 await frame.evaluate(()=>{document.querySelector('#pending').focus();scrollTo(0,50);});
 const before=await snapshot(),targetCount=await page.evaluate(()=>window.messages.filter(m=>m.event==='target').length);
 const ambiguous=await candidates({kind:'text',quote:{exact:'repeated quote'}});
 assert.equal(ambiguous.status,'ambiguous');assert.equal(ambiguous.candidates.length,6);
 assert.equal(new Set(ambiguous.candidates.map(c=>c.target.position.start)).size,6);
 assert(ambiguous.candidates.every(c=>c.text==='repeated quote'&&c.prefix&&c.suffix&&c.target.quote.exact==='repeated quote'));
 assert.deepEqual(await snapshot(),before);
 assert.equal(await page.evaluate(()=>window.messages.filter(m=>m.event==='target').length),targetCount);
 await frame.locator('#chosen').evaluate(e=>e.textContent='Changed selection');
 assert.equal((await candidates(original)).candidates.length,0);
 const element=await capture('changed','element');await frame.locator('#changed').evaluate(e=>e.textContent='Current button');
 const changed=await candidates(element);assert.equal(changed.status,'missing');assert.equal(changed.candidates.length,1);
 assert.equal(changed.candidates[0].label,'原路径对应位置，内容已变化，请核对');assert.equal(changed.candidates[0].target.text,'Current button');
 const oldPage=await capture('pageA','page');
 await frame.evaluate(()=>{document.querySelector('#pageA h2').textContent='New page title';document.querySelector('#pageB').before(document.querySelector('#pageA'));document.querySelector('#pageA').before(document.querySelector('#pageB'));});
 const revisedPage=await candidates(oldPage),pageCandidate=revisedPage.candidates.find(c=>c.target.id==='pageA');
 assert(pageCandidate);assert.equal(pageCandidate.target.scope,'page');assert.equal(pageCandidate.target.pageIndex,2);assert.equal(pageCandidate.target.pageTitle,'New page title');
 const previewsBefore=await page.evaluate(()=>window.messages.filter(m=>m.event==='target').length);
 const bottom=(await candidates({kind:'element',tag:'p',id:'bottom',selector:'#bottom',text:'Old bottom'})).candidates[0];
 await command({command:'preview-candidate',target:bottom.target});await candidates({kind:'unknown'});
 assert(await frame.evaluate(()=>scrollY>500));
 assert.equal(await page.evaluate(()=>window.messages.filter(m=>m.event==='target').length),previewsBefore);
 // A surviving DOCX duplicate is reviewable, but remains ambiguous until confirmation.
 const map={a:{id:'a',part:'word/document.xml',paragraph:1},b:{id:'b',part:'word/document.xml',paragraph:2}};
 await setup('<p><span data-docx-id="a">DOCX repeat</span></p><p><span data-docx-id="b">DOCX repeat</span></p><script data-docx-map type="application/json">'+JSON.stringify(map)+'</script>',{sourceSha256:'current-source'});
 const docx=await candidates({kind:'text',quote:{exact:'DOCX repeat'},docx:{sourceSha256:'old-source',occurrences:3}});
 assert.equal(docx.status,'ambiguous');assert.equal(docx.candidates.length,2);
 for(const c of docx.candidates) {assert.equal(c.target.docx.sourceSha256,'current-source');assert.equal(c.target.docx.occurrences,2);assert.equal(c.target.docx.blocks.length,1);assert.equal(c.target.docx.start.offset,0);assert.equal(c.target.docx.end.offset,11);assert.equal(c.target.docx.start.id,c.target.docx.end.id);}
 assert.deepEqual(errors,[]);
 console.log('PASS queued selection cancellation/save serials, candidate context, six-item bound, fresh locators, unchanged pending selection/focus/viewport, changed element/page, explicit preview and current DOCX mappings');
} finally {await browser?.close();console.log('PROCESS_CLEANUP_COMPLETE');}
