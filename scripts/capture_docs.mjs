import {runPython} from './python.mjs';
/* Capture real UI and a real agent-result round trip in an isolated browser. */
import assert from 'node:assert/strict';
import {readFile, mkdtemp, rm, mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const root = fileURLToPath(new URL('../', import.meta.url));
const app = await readFile(path.join(root, 'index.html'));
const server = createServer((_req, res) => {res.setHeader('Content-Type','text/html;charset=utf-8'); res.end(app);});
const temp = await mkdtemp(path.join(os.tmpdir(), 'html-review-docs-'));
let context;
async function nativeWrite(page, filename, text) {
  await page.evaluate(async ({filename,text}) => {
    const file = await (await navigator.storage.getDirectory()).getFileHandle(filename,{create:true});
    const writer = await file.createWritable(); await writer.write(text); await writer.close();
  }, {filename,text});
}
try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  context = await chromium.launchPersistentContext('', {headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{}),viewport:{width:1440,height:1100},deviceScaleFactor:1,acceptDownloads:true});
  await context.addInitScript(()=>{window.showDirectoryPicker=()=>navigator.storage.getDirectory();});
  const page = await context.newPage(); const errors=[];
  page.on('pageerror',e=>errors.push(e.message)); page.on('dialog',d=>d.accept());
  const ready=()=>page.waitForFunction(()=>!document.getElementById('open-button').disabled);
  await page.goto(`http://127.0.0.1:${server.address().port}/`); await ready();
  await page.locator('#example-button').click(); await ready();
  await page.locator('#preview-frame').contentFrame().locator('#hero-title').waitFor();
  if(await page.locator('#onboarding-dismiss').isVisible()) await page.locator('#onboarding-dismiss').click();
  await page.locator('#autosave-state').filter({hasText:'本机已保存'}).waitFor();
  await page.evaluate(()=>document.fonts.ready);
  await mkdir(path.join(root,'docs'),{recursive:true});
  await page.screenshot({path:path.join(root,'docs/preview.png')});
  const download=async(format,destination)=>{
    await page.locator('#export-format').selectOption(format);
    const pending=page.waitForEvent('download'); await page.locator('#download-button').click();
    await (await pending).saveAs(destination);
  };
  // Refresh the checked-in example using an actual full-copy download.
  await download('html',path.join(root,'examples/demo.review.html'));
  const review=path.join(temp,'demo.review.json'); await download('annotations',review);
  const data=JSON.parse(await readFile(review,'utf8'));
  assert.equal(data.annotations.length,3);
  const element=data.annotations.find(a=>a.kind==='element');
  const original=await readFile(path.join(root,'examples/demo.html'),'utf8');
  await nativeWrite(page,'demo.html',original);
  await page.locator('#folder-button').click(); await ready();
  assert.equal(await page.locator('#annotation-count').textContent(),'3');
  const result=path.join(temp,'demo.review-results.json');
  await runPython([path.join(root,'scripts/update_review.py'),review,'--id',element.id,'--summary','已补充“审阅 → 修改 → 核对”的协作流程示例。','--output',result]);
  await nativeWrite(page,'demo.review-results.json',await readFile(result,'utf8'));
  const updated=original.replace('把带批注的副本交给伙伴，让每一处修改都有明确的依据。','将批注交给伙伴，按照“审阅 → 修改 → 核对”完成一次协作。');
  assert.notEqual(updated,original); await nativeWrite(page,'demo.html',updated);
  await page.locator('#reload-preview').click(); await ready();
  await page.locator('#preview-frame').contentFrame().locator('#card-collaborate p').filter({hasText:'审阅 → 修改 → 核对'}).waitFor();
  assert.equal(await page.locator(`[data-annotation-id="${element.id}"]`).getAttribute('data-review-state'),'completed');
  // Show processing history alongside the genuinely updated source.
  await page.setViewportSize({width:1600,height:1500});
  await page.locator('.sidebar').evaluate(e=>{e.scrollTop=0;});
  await page.locator('#preview-frame').contentFrame().locator('body').evaluate(e=>e.ownerDocument.defaultView.scrollTo(0,0));
  await page.locator(`[data-annotation-id="${element.id}"] .annotation-history summary`).click();
  await page.locator('#autosave-state').filter({hasText:'本机已保存'}).waitFor();
  await page.screenshot({path:path.join(root,'docs/agent-feedback.png')});
  assert.deepEqual(errors,[]);
  console.log('Captured two real screenshots and refreshed the portable example; completion feedback verified.');
} finally {
  await context?.close();
  if(server.listening) await new Promise(resolve=>server.close(resolve));
  await rm(temp,{recursive:true,force:true});
  console.log('PROCESS_CLEANUP_COMPLETE');
}
