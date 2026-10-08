/* Offline occurrence navigation, reading anchors and bounded thumbnails. */
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {writePdfFixture} from './pdf-fixtures.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),temp=await mkdtemp(path.join(os.tmpdir(),'html-review-reading-'));
let browser;const errors=[],requests=[];
try {
  const source=await writePdfFixture(path.join(temp,'reading.pdf'));
  browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||undefined,headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.waitForFunction(()=>!document.getElementById('open-button').disabled);
  await page.locator('#file-input').setInputFiles(source);await page.locator('.pdf-page[data-page-number="1"][data-rendered="true"]').waitFor();
  await page.evaluate(()=>window.HRPdf.command('search-document',{query:'line'}));
  await page.evaluate(()=>window.HRPdf.command('search-step',{direction:1}));
  await page.locator('.pdf-search-highlight.active').first().waitFor();
  const first=await page.locator('.pdf-search-highlight.active').first().getAttribute('data-search-id');
  await page.evaluate(()=>window.HRPdf.command('search-step',{direction:1}));
  const second=await page.locator('.pdf-search-highlight.active').first().getAttribute('data-search-id');assert.notEqual(first,second,'occurrences on the same physical page must be individually navigable');
  await page.evaluate(()=>window.HRPdf.command('search-step',{direction:-1}));assert.equal(await page.locator('.pdf-search-highlight.active').first().getAttribute('data-search-id'),first);
  await page.evaluate(()=>window.HRPdf.command('cancel-search'));assert.equal(await page.locator('.pdf-search-highlight').count(),0);
  await page.evaluate(()=>{window.HRPdf.goToPage(3);const c=document.getElementById('pdf-preview');c.scrollTop+=250;});await page.waitForTimeout(160);
  const anchor=()=>page.evaluate(()=>{const c=document.getElementById('pdf-preview'),f=c.getBoundingClientRect(),n=[...c.querySelectorAll('.pdf-page')].find(n=>n.getBoundingClientRect().bottom>f.top+c.clientTop),r=n.getBoundingClientRect();return {number:n.dataset.pageNumber,fraction:(f.top+c.clientTop-r.top)/r.height};});
  const before=await anchor();await page.evaluate(()=>window.HRPdf.setZoom(1.5));await page.locator('.pdf-page[data-page-number="3"][data-rendered="true"]').waitFor();const after=await anchor();assert.equal(after.number,before.number);assert(Math.abs(before.fraction-after.fraction)<.015,'zoom must preserve page-local reading position');
  await page.evaluate(()=>{const c=document.getElementById('pdf-preview');c.style.width='600px';window.HRPdf.setZoom('fit');});await page.waitForTimeout(180);const fit=await anchor();await page.evaluate(()=>document.getElementById('pdf-preview').style.width='500px');await page.waitForTimeout(180);const resized=await anchor();assert.equal(resized.number,fit.number);assert(Math.abs(resized.fraction-fit.fraction)<.015,'fit resize must preserve reading position');
  if(await page.locator('#pdf-thumbnails').count()) {
    await page.evaluate(()=>window.HRPdf.command('set-thumbnails',{visible:true}));await page.waitForTimeout(250);assert(await page.locator('#pdf-thumbnails canvas').count()<=12);
    await page.evaluate(()=>window.HRPdf.command('set-thumbnails',{visible:false}));await page.waitForTimeout(100);assert.equal(await page.locator('#pdf-thumbnails canvas').count(),0);
  }
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);console.log('PASS PDF occurrence highlights/navigation, zoom/fit reading anchors, bounded thumbnail cleanup, offline privacy');
} finally {await browser?.close();await rm(temp,{recursive:true,force:true});}
