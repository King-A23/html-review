/* Full PDF raster export, independent PDF metadata/text checks, and complex-page canvas bounds.
 * Chrome on the actual host. No CUA restrictions are bypassed by this test. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {fixturePython,inspectPdfFixture} from './pdf-fixtures.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),out=path.join(root,'output/pdf-review');
const source=path.join(out,'复杂审阅.pdf'),temp=await mkdtemp(path.join(os.tmpdir(),'html-review-pdf-visual-'));
const executablePath=process.env.BROWSER_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const preserved={};for(const name of ['demo.review.json','agent-task.txt'])preserved[name]=digest(await readFile(path.join(out,name)));
const evidence={hostOS:os.platform(),browserExecutable:executablePath,sourceHash:digest(await readFile(source)),preservedArtifacts:preserved,checks:[],pageErrors:[],externalRequests:[]};
const contexts=[];let browser;
const normalize=text=>text.replace(/\s+/g,'');
const ready=page=>page.waitForFunction(()=>!document.getElementById('open-button').disabled);
const rendered=(page,n)=>page.locator(`.pdf-page[data-page-number="${n}"][data-rendered="true"]`).waitFor();
async function phase(name,action){try{evidence.checks.push({name,status:'passed',...await action()});console.log('PASS '+name);}catch(error){evidence.checks.push({name,status:'failed',error:error.stack});console.error('FAIL '+name+': '+error.message);}}
async function pageWithPDF(filename,deviceScaleFactor=1){const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor});contexts.push(context);await context.addInitScript(()=>{window.showOpenFilePicker=undefined;window.showDirectoryPicker=undefined;});const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',error=>evidence.pageErrors.push(error.message));page.on('dialog',dialog=>dialog.accept());page.on('request',request=>{if(/^https?:/.test(request.url()))evidence.externalRequests.push(request.url());});await page.goto(pathToFileURL(path.join(root,'index.html')).href);await ready(page);const start=performance.now();await page.locator('#file-input').setInputFiles(filename);await ready(page);await rendered(page,1);await page.waitForFunction(()=>!document.getElementById('document-nav-button').disabled);return {page,importMs:performance.now()-start};}
async function goto(page,n){await page.evaluate(n=>window.HRPdf.goToPage(n),n);await rendered(page,n);}
async function canvasMetrics(page){return page.locator('.pdf-canvas').evaluateAll(canvases=>({canvasCount:canvases.length,pixels:canvases.map(c=>c.width*c.height),maxPixels:Math.max(...canvases.map(c=>c.width*c.height)),totalPixels:canvases.reduce((sum,c)=>sum+c.width*c.height,0)}));}
try{
  await mkdir(out,{recursive:true});const python=await fixturePython();assert(python,'Fixture Python must be available');const execute=promisify(execFile);
  browser=await chromium.launch({headless:true,executablePath});evidence.browserVersion=browser.version();
  const raw=await inspectPdfFixture(source);assert.equal(raw.pageCount,5);
  await phase('Complete canvas PNGs and independent original-page text',async()=>{
    const {page,importMs}=await pageWithPDF(source),pages=[];
    for(let n=1;n<=5;n++){
      await goto(page,n);const canvas=page.locator(`.pdf-page[data-page-number="${n}"] .pdf-canvas`);const raster=await canvas.evaluate(node=>({width:node.width,height:node.height,dataUrl:node.toDataURL('image/png')}));
      assert(raster.width>0&&raster.height>0);const name=`tool-page-${n}.png`;await writeFile(path.join(out,name),Buffer.from(raster.dataUrl.split(',')[1],'base64'));
      const visibleText=await page.locator(`.pdf-page[data-page-number="${n}"] [data-pdf-item]`).allTextContents();const text=normalize(visibleText.join(''));const samples=raw.pages[n-1].text.split(/\r?\n/).filter(line=>line.trim()).slice(0,6);
      for(const sample of samples)assert(text.includes(normalize(sample)),`Original pypdf text is missing from page ${n}: ${sample}`);
      if(!samples.length)assert.equal(await page.locator(`.pdf-page[data-page-number="${n}"]`).getAttribute('data-no-text'),'true');
      pages.push({page:n,file:name,width:raster.width,height:raster.height,sourceRotation:raw.pages[n-1].rotation,sourceCropBox:raw.pages[n-1].cropBox,textSamples:samples,sourceImages:raw.pages[n-1].images,fullCanvasExport:true});
    }
    return {importMs,pages,exportMethod:'canvas.toDataURL(image/png), original full pixel dimensions; independent of visible container scroll clipping'};
  });
  await phase('Native form appearance and source Text annotation appearance',async()=>{
    const page=contexts[0].pages()[0];await goto(page,1);
    const script=`from pypdf import PdfReader
from PIL import Image
from pathlib import Path
import json,sys
r=PdfReader(sys.argv[1]);im=Image.open(sys.argv[2]).convert('RGB');box=r.pages[0].cropbox
scale=im.width/float(box.width)
results=[]
for ref in r.pages[0].get('/Annots',[]):
 a=ref.get_object();kind=str(a.get('/Subtype'))
 if kind not in ['/Widget','/Text']:continue
 rect=[float(v) for v in a['/Rect']];pad=3 if kind=='/Widget' else 0
 crop=(int((rect[0]+pad-float(box.left))*scale),int((float(box.top)-rect[3]+pad)*scale),int((rect[2]-pad-float(box.left))*scale),int((float(box.top)-rect[1]-pad)*scale))
 piece=im.crop(crop);dark=sum(1 for rgb in piece.getdata() if max(rgb)<120)
 filename='native-form-appearance.png' if kind=='/Widget' else 'native-text-note-appearance.png'
 piece.save(Path(sys.argv[3])/filename)
 results.append({'subtype':kind,'rect':rect,'hasAppearanceStream':'/AP' in a,'fieldName':str(a.get('/T','')),'value':str(a.get('/V','')),'contents':str(a.get('/Contents','')),'name':str(a.get('/Name','')),'darkPixels':dark,'crop':filename,'pixelBox':list(crop)})
print(json.dumps(results))
`;
    const {stdout}=await execute(python,['-c',script,source,path.join(out,'tool-page-1.png'),out]);const annotations=JSON.parse(stdout);const widget=annotations.find(a=>a.subtype==='/Widget'),note=annotations.find(a=>a.subtype==='/Text');assert(widget&&note);assert.equal(widget.fieldName,'reviewer');assert.equal(widget.value,'Fixture reviewer');assert(widget.hasAppearanceStream);assert(widget.darkPixels>30,'Native form value appearance should contain visible text ink');
    assert(note.darkPixels>30,'Native text note without an appearance stream must retain a visible viewer-generated marker');
    assert.match(await page.locator('.pdf-native-note').getAttribute('title'),/Native PDF note for annotation isolation/);
    const limitations=['Notes without an appearance stream use a read-only viewer-generated marker; the appearance of these markers may differ between PDF readers.'];
    return {annotations,limitations,nativeFormValueVisible:true,nativeTextNoteIconVisible:note.darkPixels>0,sourceInspection:'pypdf object metadata plus Pillow measurement of the complete exported raster, not engine annotation metadata'};
  });
  await phase('50 complex source pages import, bounded canvases and DPR 2 zoom 200%',async()=>{
    const large=path.join(temp,'50-complex-pages.pdf');await execute(python,['-c',`from pypdf import PdfReader,PdfWriter
import sys
r=PdfReader(sys.argv[1]);w=PdfWriter()
for repeat in range(10):w.append(r,import_outline=False)
with open(sys.argv[2],'wb') as f:w.write(f)
`,source,large]);
    const {page,importMs}=await pageWithPDF(large,2);assert.equal(await page.locator('.pdf-page').count(),50);const samples=[];
    for(const n of [1,25,50]){await goto(page,n);const sample=await canvasMetrics(page);assert(sample.canvasCount<=3);assert(sample.pixels.every(p=>p<=8_000_000));samples.push({page:n,devicePixelRatio:2,zoom:'fit',...sample});}
    await goto(page,25);await page.locator('#pdf-zoom').selectOption('2');await rendered(page,25);await page.waitForFunction(()=>Array.from(document.querySelectorAll('.pdf-canvas')).length<=3);const zoom=await canvasMetrics(page);assert(zoom.canvasCount<=3);assert(zoom.pixels.every(p=>p<=8_000_000));samples.push({page:25,devicePixelRatio:2,zoom:2,...zoom});
    return {pages:50,fixture:'10 repetitions of the original 5-page complex PDF, including Chinese, columns, chart, scan, forms, links and rotated/cropped page',sourceBytes:(await readFile(large)).length,importMs,samples,canvasCountLimit:3,perCanvasPixelLimit:8_000_000};
  });
  for(const [name,hash]of Object.entries(preserved))assert.equal(digest(await readFile(path.join(out,name))),hash,`${name} must not be regenerated`);
  assert.deepEqual(evidence.pageErrors,[]);assert.deepEqual(evidence.externalRequests,[]);
}finally{
  for(const context of contexts)await context.close().catch(()=>{});await browser?.close();await rm(temp,{recursive:true,force:true});evidence.processCleanup='PROCESS_CLEANUP_COMPLETE';await writeFile(path.join(out,'visual-verification.json'),JSON.stringify(evidence,null,2));console.log('PROCESS_CLEANUP_COMPLETE');
}
assert(evidence.checks.every(check=>check.status==='passed'),'One or more PDF visual checks failed; see visual-verification.json');
