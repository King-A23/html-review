/* Repeatable real Chrome file:// performance probe; no server or network. */
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {chromium} from 'playwright';import JSZip from 'jszip';
import {fixturePython} from './pdf-fixtures.mjs';import {createDocxFixture} from './docx-fixtures.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),output=path.join(root,'output/iteration-review');
const temp=await mkdtemp(path.join(os.tmpdir(),'html-review-performance-'));
const rounds=Number(process.env.PERF_ROUNDS||3),label=process.env.PERF_LABEL||'after',appPath=process.env.PERF_APP_PATH||path.join(root,'index.html');
const executablePath=process.env.BROWSER_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executable=promisify(execFile);let browser;
const now=()=>performance.now(),ready=page=>page.waitForFunction(()=>!document.getElementById('open-button').disabled);
const report={label,rounds,executablePath,measurements:[],limitations:['Chrome headless on macOS; wall-clock timings include Playwright dispatch.','Main renderer JS heap excludes PDF Worker and GPU memory.','Synthetic text PDFs: 30 lines/page; no scanned-image corpus.','Scroll probe includes 20 page-settled navigations and 90 animation-frame scroll increments; it does not simulate native trackpad input.','Fresh browser per sample, OS file and executable cache are not flushed.']};
async function resources(page){const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');const {metrics}=await cdp.send('Performance.getMetrics');await cdp.detach();return page.evaluate(metrics=>({domNodes:document.querySelectorAll('*').length,canvases:document.querySelectorAll('canvas').length,pageCanvases:document.querySelectorAll('.pdf-page canvas').length,canvasPixels:[...document.querySelectorAll('canvas')].reduce((n,c)=>n+c.width*c.height,0),jsHeapBytes:metrics.find(m=>m.name==='JSHeapUsedSize')?.value,frameNodes:document.querySelector('iframe')?.contentDocument?.querySelectorAll('*').length||0}),metrics);}
try{
 await mkdir(output,{recursive:true});const python=await fixturePython();assert(python,'PDF fixture runtime must be available');
 for(const pages of [100,300])await executable(python,['-c',`from reportlab.pdfgen import canvas\nimport sys\nc=canvas.Canvas(sys.argv[1],pagesize=(612,792),invariant=1)\nfor p in range(int(sys.argv[2])):\n c.setFont('Helvetica',11)\n for line in range(30): c.drawString(40,750-line*22,'Performance needle page %d line %d: deterministic text review.'%(p+1,line+1))\n c.showPage()\nc.save()`,path.join(temp,`${pages}.pdf`),String(pages)]);
 const html=path.join(temp,'large.html');await writeFile(html,'<!doctype html><html><body>'+Array.from({length:2000},(_,i)=>`<p>Paragraph ${i+1}: performance document text needle.</p>`).join('')+'</body></html>');
 const zip=await JSZip.loadAsync(await createDocxFixture());let xml=await zip.file('word/document.xml').async('string');xml=xml.replace('<w:sectPr>',Array.from({length:2000},(_,i)=>`<w:p><w:r><w:t>Large document paragraph ${i+1}: performance needle review text.</w:t></w:r></w:p>`).join('')+'<w:sectPr>');zip.file('word/document.xml',xml,{date:new Date('2026-01-01T00:00:00Z')});const docx=path.join(temp,'large.docx');await writeFile(docx,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
 report.appBytes=(await stat(appPath)).size;
 for(let round=0;round<rounds;round++)for(const type of ['html','docx','pdf100','pdf300']){
  let t=now();browser=await chromium.launch({executablePath,headless:true});const launchMs=now()-t;report.browserVersion=await browser.version();
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));const externalRequests=[];page.on('request',r=>{if(/^https?:/.test(r.url()))externalRequests.push(r.url());});
  t=now();await page.goto(pathToFileURL(appPath).href);await ready(page);const appReadyMs=now()-t;
  await page.evaluate(()=>{const old=window.HRPdf;window.__perf={textExtractions:0};window.HRPdf={...old,preview:async(...args)=>{const result=await old.preview(...args);window.__perf.session=result.session;for(const p of result.session.pageProxies){const get=p.getTextContent.bind(p);p.getTextContent=(...args)=>{window.__perf.textExtractions++;return get(...args);};}return result;}};});
  const source=type==='html'?html:type==='docx'?docx:path.join(temp,`${type.slice(3)}.pdf`);t=now();await page.locator('#file-input').setInputFiles(source);
  if(type.startsWith('pdf'))await page.locator('#pdf-preview[aria-busy="false"] .pdf-page[data-page-number="1"][data-rendered="true"]').waitFor();else {await page.locator('#preview-frame[aria-busy="false"]').waitFor();await page.frameLocator('#preview-frame').locator('body').filter({hasText:type==='html'?'Paragraph 2000:':'Large document paragraph 2000:'}).waitFor();}await ready(page);
  const importMs=now()-t;const frameNodes=type.startsWith('pdf')?0:await page.frameLocator('#preview-frame').locator('*').count();const row={round:round+1,type,sourceBytes:(await stat(source)).size,launchMs,appReadyMs,importMs,afterImport:{...await resources(page),frameNodes}};
  if(type.startsWith('pdf')){
   row.search=[];for(const query of ['needle','deterministic','needle']){t=now();const before=await page.evaluate(()=>window.__perf.textExtractions);await page.evaluate(query=>window.HRPdf.command('search-document',{query}),query);const result=await page.evaluate(()=>({textExtractions:window.__perf.textExtractions,matches:window.__perf.session.searchMatches.length,contents:window.__perf.session.contents.size,searchCharacters:window.__perf.session.searchCharacters,searchCachePages:window.__perf.session.searchStreams?.size}));assert.equal(result.matches,Number(type.slice(3))*30);if(label!=='baseline'){assert(result.searchCharacters<=4000000);assert(result.contents<=12);if(row.search.length)assert.equal(result.textExtractions-before,0,'repeat searches reuse exact extracted page strings');}row.search.push({query,ms:now()-t,textExtractions:result.textExtractions-before,matches:result.matches,fullContentCachePages:result.contents,searchCharacters:result.searchCharacters,searchCachePages:result.searchCachePages});}
   await page.evaluate(()=>window.HRPdf.command('cancel-search'));t=now();row.scrollPages=20;
   for(let n=1;n<=20;n++){await page.evaluate(n=>window.HRPdf.goToPage(n),n);await page.locator(`.pdf-page[data-page-number="${n}"][data-rendered="true"]`).waitFor();}
   row.scrollMs=now()-t;
   await page.evaluate(()=>window.HRPdf.goToPage(1));await page.locator('.pdf-page[data-page-number="1"][data-rendered="true"]').waitFor();
   row.continuousScroll=await page.evaluate(()=>new Promise(resolve=>{const c=document.getElementById('pdf-preview'),durations=[];let previous=performance.now(),first=previous,count=0;function frame(time){durations.push(time-previous);previous=time;c.scrollTop+=Math.max(40,c.clientHeight/12);if(++count<90)requestAnimationFrame(frame);else {const sorted=durations.slice(1).sort((a,b)=>a-b);resolve({frames:count,ms:time-first,p95FrameMs:sorted[Math.floor(sorted.length*.95)],maxFrameMs:Math.max(...sorted),framesAbove34ms:sorted.filter(t=>t>34).length});}}requestAnimationFrame(frame);}));
   await page.waitForTimeout(180);row.afterScroll=await resources(page);assert(row.afterScroll.pageCanvases<=3,'page canvases remain bounded');
   if(label!=='baseline') {
    await page.evaluate(async()=>{const s=window.__perf.session;s.searchStreams.clear();s.searchStreams.set(0,'x'.repeat(4000000));s.searchCharacters=4000000;await window.HRPdf.command('search-document',{query:'needle'});});
    const bounded=await page.evaluate(()=>{const s=window.__perf.session;return {fake:s.searchStreams.has(0),characters:s.searchCharacters,actual:[...s.searchStreams.values()].reduce((n,v)=>n+v.length,0),matches:s.searchMatches.length};});
    assert(!bounded.fake,'cache must evict old strings at its character budget');assert.equal(bounded.characters,bounded.actual);assert(bounded.actual<=4000000);assert.equal(bounded.matches,Number(type.slice(3))*30);
    await page.evaluate(()=>window.HRPdf.dispose());assert.deepEqual(await page.evaluate(()=>({size:window.__perf.session.searchStreams.size,characters:window.__perf.session.searchCharacters})),{size:0,characters:0});row.cacheBudgetAndDisposalVerified=true;
   }
  }
  assert.deepEqual(errors,[]);assert.deepEqual(externalRequests,[]);row.pageErrors=errors;report.measurements.push(row);console.log(`${label} ${round+1} ${type}: ready ${appReadyMs.toFixed(1)}ms import ${importMs.toFixed(1)}ms ${row.search?.map(s=>s.ms.toFixed(1)).join('/')||''}`);await browser.close();browser=null;
 }
 const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];report.medians={};for(const type of ['html','docx','pdf100','pdf300']){const rows=report.measurements.filter(r=>r.type===type);report.medians[type]={launchMs:median(rows.map(r=>r.launchMs)),appReadyMs:median(rows.map(r=>r.appReadyMs)),importMs:median(rows.map(r=>r.importMs)),...(type.startsWith('pdf')?{searchMs:[0,1,2].map(i=>median(rows.map(r=>r.search[i].ms))),scrollMs:median(rows.map(r=>r.scrollMs))}:{})};}
 report.processCleanup='PROCESS_CLEANUP_COMPLETE';await writeFile(path.join(output,`performance-${label}.json`),JSON.stringify(report,null,2));console.log(JSON.stringify(report.medians,null,2));
}finally{await browser?.close();await rm(temp,{recursive:true,force:true});}
