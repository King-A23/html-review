import {ensureBackup} from './backup-ui.mjs';
/* DOCX rejection and worker lifecycle tests with genuine ZIP files and native workers. */
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdtemp, rm, stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import JSZip from 'jszip';
import {createDocxFixture} from './docx-fixtures.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
let modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
if (modulePath && (await stat(modulePath)).isDirectory()) modulePath = path.join(modulePath, 'index.mjs');
const {chromium} = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const temp = await mkdtemp(path.join(os.tmpdir(), 'html-review-docx-errors-'));
let browser; const contexts=[];
const ready = page => page.waitForFunction(() => !document.getElementById('open-button').disabled);
const frame = page => page.frameLocator('#preview-frame');
async function fixture(name, bytes) { const file = path.join(temp,name); await writeFile(file,bytes); return file; }
async function open(page, file) { await page.locator('#file-input').setInputFiles(file); await ready(page); }
async function lightweight(page, name) {
  await ensureBackup(page); await page.locator('#export-format').selectOption('annotations'); const pending=page.waitForEvent('download');
  await ensureBackup(page); await page.locator('#download-button').click(); const file=path.join(temp,name); await (await pending).saveAs(file); return file;
}
async function fresh() {
  const context=await browser.newContext({acceptDownloads:true});contexts.push(context);
  await context.addInitScript(()=>{window.showOpenFilePicker=undefined;window.showDirectoryPicker=undefined;});
  const page=await context.newPage();page.on('dialog',d=>d.accept());
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);await ready(page);return page;
}
async function preserved(page, text) {
  assert.equal(await frame(page).locator('body').textContent(), text);
  assert.equal(await page.locator('#annotation-count').textContent(),'1');
  assert.equal(await page.locator('#comment-input').inputValue(),'保留未保存的草稿');
}
try {
  const base=await createDocxFixture(); const valid=await fixture('review.docx',base);
  const malformed=Buffer.from(base);malformed.writeUInt32LE(0xffffffff,malformed.length-6);
  const encrypted=Buffer.from(base);const central=encrypted.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));encrypted.writeUInt16LE(encrypted.readUInt16LE(central+8)|1,central+8);
  const oversized=Buffer.from(base);oversized.writeUInt32LE(100*1024*1024+1,central+24);
  const many=new JSZip();for(let i=0;i<3001;i++)many.file(`entry-${i}.xml`,'<empty/>',{date:new Date('2026-01-01T00:00:00Z')});
  const corrupt=await JSZip.loadAsync(base);corrupt.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p></w:body>');
  const dtd=await JSZip.loadAsync(base);dtd.file('word/document.xml','<!DOCTYPE document [<!ENTITY danger SYSTEM "https://docx-network.invalid/private">]><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>&danger;</w:t></w:r></w:p></w:body></w:document>');
  const bomb=new JSZip();bomb.file('oversized.bin',Buffer.alloc(101*1024*1024));
  const undeclared=await bomb.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
  // A forged central-directory size must not bypass the streaming output limit.
  undeclared.writeUInt32LE(1,undeclared.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]))+24);
  const cases=[
    ['not-a-zip.docx',Buffer.from('not a zip'),/格式|损坏|加密|压缩目录/],
    ['bad-directory.docx',malformed,/损坏|目录|超限/],
    ['encrypted.docx',encrypted,/加密/],
    ['declared-oversize.docx',oversized,/100 MiB/],
    ['undeclared-oversize.docx',undeclared,/100 MiB/],
    ['source-oversize.docx',Buffer.alloc(20*1024*1024+1),/20 MiB/],
    ['too-many-entries.docx',await many.generateAsync({type:'nodebuffer'}),/目录超限/],
    ['invalid-xml.docx',await corrupt.generateAsync({type:'nodebuffer'}),/XML 损坏/],
    ['external-entity.docx',await dtd.generateAsync({type:'nodebuffer'}),/DTD|外部实体/],
    ['unsupported.docm',base,/支持 HTML|支持.*DOCX/]
  ];
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
  const page=await fresh(); const requests=[];page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  await open(page,valid);await frame(page).locator('body').filter({hasText:'正文与定位'}).waitFor();
  await page.locator('[data-mode=whole]').click();await page.locator('#comment-input').fill('保留已保存的批注');await page.locator('#save-button').click();
  const exportPath=await lightweight(page,'review.json');
  await page.locator('#comment-input').fill('保留未保存的草稿');const original=await frame(page).locator('body').textContent();
  for(const [name,bytes,error] of cases) {
    await open(page,await fixture(name,bytes));try { await page.locator('#status').filter({hasText:error}).waitFor({timeout:5000}); } catch (failure) { console.error(name, await page.locator('#status').textContent()); throw failure; } await preserved(page,original);
    console.log(`PASS rejection: ${name}`);
  }
  await open(page,exportPath);await page.locator('#pair-source').waitFor({state:'visible'});
  await open(page,await fixture('changed.docx',await createDocxFixture('changed')));
  await page.locator('#status').filter({hasText:'版本不一致'}).waitFor();await preserved(page,original);
  assert.equal(await page.locator('#pair-source').isVisible(),true,'Wrong source hash must preserve pending JSON pairing');
  await page.locator('#cancel-pair').click();await preserved(page,original);
  // Wrap native Worker only to delay delivering conversion bytes. The real adapter's
  // cancellation/timeout branches run, and native worker termination is observed.
  await page.evaluate(()=>{
    const NativeWorker=window.Worker, nativeTimeout=window.setTimeout.bind(window), nativeClear=window.clearTimeout.bind(window);
    const revoke=URL.revokeObjectURL.bind(URL);window.__workerEvidence={created:[],terminated:[],revoked:[],timeoutDelays:[]};window.__fastTimeout=false;
    URL.revokeObjectURL=url=>{window.__workerEvidence.revoked.push(url);revoke(url);};
    window.Worker=class DelayedWorker extends NativeWorker {
      constructor(url,options){super(url,options);this.workerURL=url;window.__workerEvidence.created.push(url);}
      postMessage(...args){this.delivery=nativeTimeout(()=>super.postMessage(...args),60000);}
      terminate(){nativeClear(this.delivery);window.__workerEvidence.terminated.push(this.workerURL);return super.terminate();}
    };
    window.setTimeout=(handler,delay,...args)=>{
      if(delay===30000){window.__workerEvidence.timeoutDelays.push(delay);if(window.__fastTimeout)return nativeTimeout(handler,40,...args);}
      return nativeTimeout(handler,delay,...args);
    };
  });
  const delayed=await fixture('delayed.docx',await createDocxFixture('inserted'));
  await page.locator('#file-input').setInputFiles(delayed);await page.locator('#cancel-conversion').waitFor({state:'visible'});
  await page.waitForFunction(()=>window.__workerEvidence.created.length===1);
  await page.locator('#cancel-conversion').click();await ready(page);await page.locator('#status').filter({hasText:'已取消 DOCX 转换'}).waitFor();await preserved(page,original);
  await page.evaluate(()=>{window.__fastTimeout=true;});
  await open(page,delayed);await page.locator('#status').filter({hasText:'超过 30 秒'}).waitFor();await preserved(page,original);
  const evidence=await page.evaluate(()=>window.__workerEvidence);
  assert.equal(evidence.created.length,2);assert.deepEqual(evidence.terminated,evidence.created);assert.deepEqual(evidence.revoked,evidence.created);assert.deepEqual(evidence.timeoutDelays,[30000,30000]);
  assert.deepEqual(requests,[],'Rejected or malicious DOCX files must not fetch external entities/relationships');
  console.log('PASS pending JSON survives wrong hash; cancellation and actual adapter timeout terminate native workers and revoke their URLs without losing workspace/draft');
} finally {
  await Promise.allSettled(contexts.map(c=>c.close()));await browser?.close();await rm(temp,{recursive:true,force:true});console.log('PROCESS_CLEANUP_COMPLETE');
}
