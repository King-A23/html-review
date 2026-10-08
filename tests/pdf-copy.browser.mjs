/* Refresh the demo shell without changing saved opinions, then exercise actual HTML/gzip downloads. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,webcrypto} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import vm from 'node:vm';
import {chromium} from 'playwright';
const root=fileURLToPath(new URL('../',import.meta.url)),out=path.join(root,'output/pdf-review');
const temp=await mkdtemp(path.join(tmpdir(),'html-review-pdf-copy-'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const dataPattern=/(<script\b[^>]*\bid="html-review-data"[^>]*>)([\s\S]*?)(<\/script>)/i;
const extract=html=>JSON.parse(html.match(dataPattern)[2]);
const saved=extract(await readFile(path.join(out,'demo.review.html'),'utf8'));
const lightBefore=await readFile(path.join(out,'demo.review.json'));
const sourceBefore=await readFile(path.join(out,'复杂审阅.pdf'));
const coreContext={crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,URL,btoa,atob};
vm.runInNewContext(await readFile(path.join(root,'src/core.js'),'utf8'),coreContext);
await coreContext.HRCore.validateData(saved);
const shell=await readFile(path.join(root,'index.html'),'utf8');
await writeFile(path.join(temp,'current.review.html'),shell.replace(dataPattern,(_all,a,_b,c)=>a+JSON.stringify(saved).replace(/</g,'\\u003c')+c));
let browser;const errors=[],requests=[];
try {
  browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH||undefined});
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  await page.goto(pathToFileURL(path.join(temp,'current.review.html')).href);
  await page.locator('.pdf-page[data-page-number="1"][data-rendered="true"]').waitFor();
  assert.equal(await page.locator('#annotation-count').textContent(),'4');
  const downloaded={};
  for(const format of ['html','gzip']) {
    await page.locator('#export-format').selectOption(format);const waiting=page.waitForEvent('download');await page.locator('#download-button').click();
    const file=path.join(out,'demo.review.html'+(format==='gzip'?'.gz':''));await(await waiting).saveAs(file);
    const bytes=await readFile(file),html=(format==='gzip'?gunzipSync(bytes):bytes).toString('utf8');
    assert.deepEqual(extract(html),saved);assert.equal(Buffer.from(extract(html).source.base64,'base64').equals(sourceBefore),true);
    assert(!html.includes('data-pdf-item='));assert.equal(await page.evaluate(html=>new DOMParser().parseFromString(html,'text/html').querySelectorAll('#pdf-preview canvas').length,html),0);
    downloaded[format]={bytes:bytes.length,sha256:digest(bytes)};
    if(format==='gzip') {await writeFile(path.join(temp,'unzipped.review.html'),html);const reopened=await context.newPage();await reopened.goto(pathToFileURL(path.join(temp,'unzipped.review.html')).href);await reopened.locator('.pdf-page[data-page-number="1"][data-rendered="true"]').waitFor();assert.equal(await reopened.locator('#annotation-count').textContent(),'4');await reopened.locator('[data-mode=whole]').click();await reopened.locator('#comment-input').fill('解压后继续审阅');await reopened.locator('#save-button').click();assert.equal(await reopened.locator('#annotation-count').textContent(),'5');await reopened.close();}
  }
  assert.deepEqual(await readFile(path.join(out,'demo.review.json')),lightBefore);assert.deepEqual(await readFile(path.join(out,'复杂审阅.pdf')),sourceBefore);assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  await writeFile(path.join(out,'copy-verification.json'),JSON.stringify({browser:browser.version(),sourceHash:digest(sourceBefore),toolBytes:Buffer.byteLength(shell),savedAnnotations:4,downloaded,lightUnchanged:true,sourceUnchanged:true,derivedPreviewNotSerialized:true,gzipReopensOffline:true,externalRequests:requests,pageErrors:errors},null,2));
  console.log('PASS final PDF HTML/gzip downloads preserve source and opinions; offline gzip copy continues editing');
} finally {await browser?.close();await rm(temp,{recursive:true,force:true});console.log('PROCESS_CLEANUP_COMPLETE');}
