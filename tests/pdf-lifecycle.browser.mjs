/* Chrome lifecycle coverage. Native OPFS handles are real; picker UI alone is stubbed.
 * Runs on the host OS. It does not claim Windows filesystem or browser coverage. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:http';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {writePdfFixture,fixturePython} from './pdf-fixtures.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const temp=await mkdtemp(path.join(os.tmpdir(),'html-review-pdf-lifecycle-'));
const output=path.join(root,'output/pdf-review/lifecycle-verification.json');
await mkdir(path.dirname(output),{recursive:true});
const executablePath=process.env.BROWSER_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const contexts=[],errors=[],network=[],checks=[];let browser,server,cleaningUp=false;
const evidence={nativeProfileMode:'temporary persistent regular Chrome profile (not incognito)',browserEvents:[],hostOS:os.platform(),browserExecutable:executablePath,nativeHandleMethod:'Chrome native OPFS handles; picker UI stubbed. This is not a Windows filesystem test.',checks,errors,network};
const ready=page=>page.waitForFunction(()=>!document.getElementById('open-button').disabled);
async function rendered(page,n=1){
  const step=page.__lifecycleStep||'PDF page '+n+' render'; const start=performance.now();
  try{await page.locator(`.pdf-page[data-page-number="${n}"][data-rendered="true"]`).waitFor();if(page.__lifecycleStep){evidence.nativeSteps||=[];evidence.nativeSteps.push({step,status:'passed',elapsedMs:performance.now()-start});console.log('STEP '+step);}}
  catch(error){const state=await page.evaluate(async()=>{const $=id=>document.getElementById(id);let record;try{record=await window.HRSession.load('workspace:'+location.href.split('#')[0]);}catch(e){record={error:e.message};}return {url:location.href,sourceName:$('source-name').textContent,status:$('status').textContent,statusError:$('status').classList.contains('error'),openDisabled:$('open-button').disabled,navDisabled:$('document-nav-button').disabled,pdfHidden:$('pdf-preview').hidden,pageNumber:$('pdf-page-number').value,pageCount:$('pdf-page-count').textContent,slots:Array.from(document.querySelectorAll('.pdf-page')).slice(0,8).map(node=>({page:node.dataset.pageNumber,rendered:node.dataset.rendered})),draft:$('comment-input').value,recoveryVisible:!$('recovery-banner').hidden,resumeMarker:sessionStorage.getItem('html-review.resume:workspace:'+location.href.split('#')[0]),autosaveStatus:$('autosave-state').textContent,record:record&&{source:record.data?.source&&{name:record.data.source.name,sha256:record.data.source.sha256,type:record.data.source.type},draftComment:record.draft?.comment,localAccess:{file:record.localAccess?.fileHandle?.name,directory:record.localAccess?.directoryHandle?.name,entry:record.localAccess?.entryPath},savedAt:record.savedAt,error:record.error}};}).catch(e=>({inspectionError:e.message}));
    evidence.renderFailures||=[];const screenshot='lifecycle-failure-'+evidence.renderFailures.length+'.png';await page.screenshot({path:path.join(path.dirname(output),screenshot)}).catch(()=>{});evidence.renderFailures.push({step,requestedPage:n,state,screenshot});error.message=step+': '+error.message;throw error;
  }
}
async function phase(name,action){const start=performance.now();try{const detail=await action();checks.push({name,status:'passed',elapsedMs:performance.now()-start,...detail});console.log('PASS '+name);}catch(error){checks.push({name,status:'failed',elapsedMs:performance.now()-start,error:error.stack});console.error('FAIL '+name+': '+error.message);}}
function observe(page){page.on('crash',()=>evidence.browserEvents.push({event:'page-crash',step:page.__lifecycleStep||null,url:page.url(),duringCleanup:cleaningUp}));page.on('close',()=>{if(!cleaningUp)evidence.browserEvents.push({event:'unexpected-page-close',step:page.__lifecycleStep||null,url:page.url()});});page.setDefaultTimeout(20000);page.on('dialog',dialog=>dialog.accept());page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/^https?:/.test(request.url())&&!request.url().startsWith('http://127.0.0.1:'))network.push(request.url());});}
async function freshPage(){const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});contexts.push(context);await context.addInitScript(()=>{window.showOpenFilePicker=undefined;window.showDirectoryPicker=undefined;});const page=await context.newPage();observe(page);await page.goto(pathToFileURL(path.join(root,'index.html')).href);await ready(page);return page;}
async function open(page,filename){await page.locator('#file-input').setInputFiles(filename);await ready(page);await rendered(page);await page.waitForFunction(()=>!document.getElementById('document-nav-button').disabled);}
async function goto(page,n){await page.evaluate(n=>window.HRPdf.goToPage(n),n);await rendered(page,n);}
async function save(page,text){await page.locator('#comment-input').fill(text);await page.locator('#save-button').click();}
async function report(page){await page.locator('#data-button').click();const data=JSON.parse(await page.locator('#data-preview').textContent());await page.locator('#data-dialog [data-close]').click();await page.locator('#data-dialog').waitFor({state:'hidden'});return data;}
async function nativeWrite(page,name,bytes){await page.evaluate(async({name,base64})=>{const directory=await navigator.storage.getDirectory();const handle=await directory.getFileHandle(name,{create:true});const writer=await handle.createWritable();await writer.write(Uint8Array.from(atob(base64),c=>c.charCodeAt(0)));await writer.close();},{name,base64:Buffer.from(bytes).toString('base64')});}
async function stableSave(page,url,comment,handleKind='file'){
  // The IndexedDB transaction can become readable before the app resumes its
  // save continuation and publishes the refresh marker. Wait for the user's
  // complete-save signal, as well as the actual persisted data and handle.
  await page.evaluate(async({key,comment,handleKind})=>{
    const deadline=performance.now()+8000;
    while(performance.now()<deadline) {
      const record=await window.HRSession.load(key);
      if(record?.draft?.comment===comment && record?.data?.source?.type==='pdf'
        && record.localAccess?.[handleKind==='directory'?'directoryHandle':'fileHandle']?.kind===handleKind
        && sessionStorage.getItem('html-review.resume:'+key)===record.data.source.sha256
        && document.getElementById('autosave-state').textContent.startsWith('本机已保存'))return;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw new Error('PDF source, draft, handle and refresh marker were not saved together');
  },{key:'workspace:'+url,comment,handleKind});
}
try{
  const source=path.join(temp,'review.pdf'),large=path.join(temp,'1000-pages.pdf');await writePdfFixture(source);
  const python=await fixturePython();assert(python,'PDF fixture Python must be available');
  await promisify(execFile)(python,['-c',`from pypdf import PdfReader,PdfWriter
import sys
w=PdfWriter();w.clone_document_from_reader(PdfReader(sys.argv[1]));w.add_outline_item('审阅首页',0);w.add_outline_item('审阅图表',2)
with open(sys.argv[1],'wb') as f:w.write(f)
w=PdfWriter()
for n in range(1000):w.add_blank_page(612,792)
with open(sys.argv[2],'wb') as f:w.write(f)
`,source,large]);
  browser=await chromium.launch({headless:true,executablePath});evidence.browserVersion=browser.version();browser.on('disconnected',()=>{if(!cleaningUp)evidence.browserEvents.push({event:'browser-disconnected'});});
  await phase('PDF search, parsed outline and internal link navigation',async()=>{
    const page=await freshPage();await open(page,source);await page.locator('#document-nav-button').click();await page.locator('#document-outline button').filter({hasText:'审阅图表'}).click();await rendered(page,3);assert.equal(await page.locator('#pdf-page-number').inputValue(),'3');
    await page.locator('#document-nav-button').click();await page.locator('#document-search').fill('LEFT column line 12');await page.locator('#document-search-status').filter({hasText:'找到 1 处'}).waitFor();await page.locator('#document-search-results button').click();await rendered(page,2);assert.equal(await page.locator('#pdf-page-number').inputValue(),'2');
    await goto(page,1);await page.locator('[data-mode=browse]').click();await page.locator('.pdf-page[data-page-number="1"] .pdf-link[href="#"]').click();await rendered(page,3);await page.waitForFunction(()=>document.getElementById('pdf-page-number').value==='3');
    return {searchQuery:'LEFT column line 12',outlineDestination:3,searchDestination:2,internalLinkDestination:3};
  });
  await phase('Tiny PDF region gesture clears selection and keeps draft',async()=>{
    const page=await freshPage();await open(page,source);await goto(page,3);await page.locator('[data-mode=element]').click();const box=await page.locator('.pdf-page[data-page-number="3"]').boundingBox();
    await page.mouse.move(box.x+100,box.y+100);await page.mouse.down();await page.mouse.move(box.x+280,box.y+250,{steps:10});await page.mouse.up();await page.locator('#target-kind').filter({hasText:'区域'}).waitFor();await page.locator('#comment-input').fill('微小点击后保留草稿');assert(await page.locator('#save-button').isEnabled());
    await page.mouse.click(box.x+180,box.y+150);await page.locator('#target-preview').waitFor({state:'hidden'});assert(await page.locator('#save-button').isDisabled());assert.equal(await page.locator('#comment-input').inputValue(),'微小点击后保留草稿');assert.equal(await page.locator('.pdf-focus').count(),0);
    return {selectedRegionCleared:true,draftRetained:true};
  });
  await phase('PDF autosave, refresh recovery, native file and folder reload with results',async()=>{
    const app=await readFile(path.join(root,'index.html'));server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(app);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}/`;
    const context=await chromium.launchPersistentContext(path.join(temp,'native-chrome-profile'),{headless:true,executablePath,viewport:{width:1440,height:1000},acceptDownloads:true});contexts.push(context);context.on('close',()=>{if(!cleaningUp)evidence.browserEvents.push({event:'native-persistent-context-closed'});});await context.addInitScript(()=>{window.__pickerCounts={file:0,directory:0};window.showOpenFilePicker=async()=>{window.__pickerCounts.file++;return[await(await navigator.storage.getDirectory()).getFileHandle('review.pdf')];};window.showDirectoryPicker=async()=>{window.__pickerCounts.directory++;return navigator.storage.getDirectory();};});
    const page=await context.newPage();observe(page);await page.goto(url);await ready(page);await nativeWrite(page,'review.pdf',await readFile(source));page.__lifecycleStep='Native initial file open';await page.locator('#open-button').click();await ready(page);await rendered(page);await page.locator('[data-mode=browse]').click();await save(page,'整份 PDF 的意见');const first=await report(page);
    await page.locator('#comment-input').fill('PDF 自动保存的未提交草稿');await stableSave(page,url,'PDF 自动保存的未提交草稿');page.__lifecycleStep='Refresh restoring file-handle PDF and draft';await page.reload();await ready(page);await rendered(page);assert.equal(await page.locator('#annotation-count').textContent(),'1');assert.equal(await page.locator('#comment-input').inputValue(),'PDF 自动保存的未提交草稿');
    // Picker counters reset on refresh. A real restored native file handle must avoid any picker.
    const changed=path.join(temp,'changed.pdf');await writePdfFixture(changed,'inserted');await nativeWrite(page,'review.pdf',await readFile(changed));page.__lifecycleStep='Native file handle reload after refresh';await page.locator('#reload-preview').click();await ready(page);await rendered(page);assert.equal(await page.locator('.pdf-page').count(),6);assert.equal(await page.locator('#comment-input').inputValue(),'PDF 自动保存的未提交草稿');assert.deepEqual(await page.evaluate(()=>window.__pickerCounts),{file:0,directory:0});
    page.__lifecycleStep='Associating native directory';await page.locator('#folder-button').click();await ready(page);assert.equal(await page.locator('#entry-select').inputValue(),'review.pdf');const results={format:'html-review-results',schemaVersion:1,batchId:randomUUID(),results:[{id:first.annotations[0].id,revision:first.annotations[0].revision,annotationUpdatedAt:first.annotations[0].updatedAt,status:'resolved',summary:'已完成 PDF 全文要求',by:'agent'}]};await nativeWrite(page,'review.review-results.json',Buffer.from(JSON.stringify(results)));
    page.__lifecycleStep='Linked directory reload merging agent results';await page.locator('#reload-preview').click();await ready(page);await rendered(page);await page.locator('.annotation-card[data-review-state="completed"]').waitFor();assert.equal(await page.locator('#comment-input').inputValue(),'PDF 自动保存的未提交草稿');assert.deepEqual(await page.evaluate(()=>window.__pickerCounts),{file:0,directory:1});
    await stableSave(page,url,'PDF 自动保存的未提交草稿','directory');page.__lifecycleStep='Refresh restoring directory PDF, draft and completed result';await page.reload();await ready(page);await rendered(page);await page.locator('.annotation-card[data-review-state="completed"]').waitFor();assert.equal(await page.locator('#comment-input').inputValue(),'PDF 自动保存的未提交草稿');page.__lifecycleStep='Restored directory handle reload without picker';await page.locator('#reload-preview').click();await ready(page);await rendered(page);assert.deepEqual(await page.evaluate(()=>window.__pickerCounts),{file:0,directory:0});
    return {savedAnnotations:1,draftRestored:true,sourceReloadPages:6,filePickerCallsAfterRefresh:0,directoryPickerCallsToAssociate:1,directoryReloadPickerCalls:0,agentResult:'resolved',filesystem:'native OPFS',origin:'temporary localhost test server for native-handle acceptance; not a CUA fallback'};
  });
  await phase('1000-page PDF import and bounded page canvas allocation',async()=>{
    const page=await freshPage();page.setDefaultTimeout(60000);const start=performance.now();await open(page,large);const importMs=performance.now()-start;assert.equal(await page.locator('.pdf-page').count(),1000);assert.equal(await page.locator('#pdf-page-count').textContent(),'/ 1000');
    const samples=[];for(const n of [1,500,1000]){if(n!==1)await goto(page,n);const sample=await page.locator('.pdf-canvas').evaluateAll(canvases=>({canvasCount:canvases.length,pixels:canvases.map(c=>c.width*c.height),totalPixels:canvases.reduce((sum,c)=>sum+c.width*c.height,0)}));assert(sample.canvasCount<=3);assert(sample.pixels.every(pixels=>pixels<=8_000_000));assert(sample.totalPixels<=8_000_000);samples.push({page:n,...sample});}
    return {pages:1000,fixture:'pypdf 1000 blank US Letter pages',sourceBytes:(await readFile(large)).length,importMs,canvasSamples:samples,canvasCountLimit:3,perCanvasPixelLimit:8_000_000,observedTotalPixelLimit:8_000_000};
  });
  assert.deepEqual(errors,[],'No runtime page errors');assert.deepEqual(network,[],'No external network requests');
}finally{
  cleaningUp=true;for(const context of contexts)await context.close().catch(()=>{});await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await rm(temp,{recursive:true,force:true});evidence.processCleanup='PROCESS_CLEANUP_COMPLETE';await writeFile(output,JSON.stringify(evidence,null,2));console.log('PROCESS_CLEANUP_COMPLETE');
}
assert(checks.every(check=>check.status==='passed'),'One or more PDF lifecycle checks failed; see lifecycle-verification.json');
