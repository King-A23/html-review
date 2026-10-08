import {ensureBackup} from './backup-ui.mjs';
/* Independent OOXML edge cases for mapped boundaries, notes, tables and source changes. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import JSZip from 'jszip';
import {createDocxFixture} from './docx-fixtures.mjs';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {runPython} from '../scripts/python.mjs';
const temp=await mkdtemp(path.join(os.tmpdir(),'docx-locations-'));let browser;
try {
 const zip=await JSZip.loadAsync(await createDocxFixture());
 let xml=await zip.file('word/document.xml').async('string');
 xml=xml.replace('<w:document ', '<w:document xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ')
  .replace('<w:p><w:r><w:drawing>', '<w:p w14:paraId="A00B0001"><w:r><w:drawing>')
  .replace('脚注与尾注 Notes</w:t>', '脚注与尾注 Notes</w:t>')
  .replace('<w:footnoteReference w:id="1"/></w:r>', '<w:footnoteReference w:id="1"/></w:r><w:r><w:t>引用后的文字</w:t></w:r>')
  .replace('<w:body>','<w:body><w:p><w:r><w:t>换行测试 A</w:t><w:cr/><w:t>B</w:t><w:noBreakHyphen/><w:softHyphen/><w:t>C</w:t></w:r></w:p>');
 zip.file('word/document.xml',xml);
 zip.file('word/_rels/document.xml.rels',(await zip.file('word/_rels/document.xml.rels').async('string')).replace('Target="media/image1.png"','Target="/word/media/image1.png"'));
 const bytes=await zip.generateAsync({type:'nodebuffer'});const source=path.join(temp,'review.docx');await writeFile(source,bytes);
 browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
 const context=await browser.newContext({acceptDownloads:true});await context.addInitScript(()=>{window.showOpenFilePicker=undefined;window.showDirectoryPicker=undefined;});
 const page=await context.newPage();page.on('dialog',d=>d.accept());await page.goto(pathToFileURL(path.resolve('index.html')).href);
 await page.waitForFunction(()=>!document.getElementById('open-button').disabled);await page.locator('#file-input').setInputFiles(source);
 const frame=page.frameLocator('#preview-frame');await frame.locator('p').filter({hasText:'换行测试'}).waitFor();
 const save=async(comment)=>{await page.locator('#comment-input').fill(comment);await page.locator('#save-button').click();};
 await page.locator('[data-mode=text]').click();
 await frame.locator('p').filter({hasText:'引用后的文字'}).evaluate(p=>{const walker=document.createTreeWalker(p,NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode())if(n.data==='引用后的文字'){const r=document.createRange();r.selectNodeContents(n);getSelection().removeAllRanges();getSelection().addRange(r);p.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));break;}});
 await page.locator('#target-text').filter({hasText:'引用后的文字'}).waitFor();await save('脚注引用后的正文');
 await page.locator('[data-mode=element]').click();await frame.locator('img[data-docx-id]').first().click();await save('原始绝对路径图片');
 await frame.locator('table').first().click({position:{x:5,y:5}});await save('外层表格');
 await page.locator('[data-mode=text]').click();await frame.locator('p').filter({hasText:/^重复段落/}).nth(1).evaluate(p=>{const r=document.createRange();r.selectNodeContents(p);getSelection().removeAllRanges();getSelection().addRange(r);p.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});await page.locator('#target-text').filter({hasText:'重复段落'}).waitFor();await save('第二处重复原文');
 await frame.locator('body').evaluate(body=> {
   const cells=Array.from(body.querySelectorAll('td'));
   const first=cells.find(c=>c.textContent==='纵向合并 Vertical');
   const last=cells.find(c=>c.textContent==='右侧单元格 Right cell');
   const start=document.createTreeWalker(first,NodeFilter.SHOW_TEXT).nextNode(),end=document.createTreeWalker(last,NodeFilter.SHOW_TEXT).nextNode();
   const range=document.createRange();range.setStart(start,2);range.setEnd(end,4);getSelection().removeAllRanges();getSelection().addRange(range);last.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
 });
 await page.locator('#target-text').filter({hasText:'合并 Vertical右侧单元'}).waitFor();await save('跨两个单元格的原文');
 await ensureBackup(page); await page.locator('#export-format').selectOption('annotations');let pending=page.waitForEvent('download');await ensureBackup(page); await page.locator('#download-button').click();const json=path.join(temp,'review.json');await (await pending).saveAs(json);const data=JSON.parse(await readFile(json,'utf8'));
 assert.equal(data.annotations[0].target.docx.start.offset,'脚注与尾注 Notes'.length);
 assert.equal(data.annotations[0].target.quote.exact,'引用后的文字');
 const image=data.annotations[1].target.docx.blocks.find(b=>b.image);assert.equal(image.image.mediaPath,'word/media/image1.png');assert.equal(image.paraId,undefined);
 assert.equal(data.annotations[3].target.docx.occurrences,2);
 const cells=data.annotations[4].target.docx;
 assert.equal(cells.blocks.length,2);assert.equal(cells.start.offset,2);assert.equal(cells.end.offset,4);
 assert.deepEqual(cells.blocks.map(b=>[b.table.row,b.table.column]),[[2,1],[2,2]]);
 const check=await runPython(['scripts/inspect_review.py',json,source]);assert.match(check.stdout,/版本校验通过/);assert.match(check.stdout,/引用后的文字/);
 // Removing the originally selected duplicate must not silently bind the survivor.
 const revised=await JSZip.loadAsync(bytes);const paragraph='<w:p><w:r><w:t xml:space="preserve">重复段落 Duplicate paragraph</w:t></w:r></w:p>';
 let changed=(await revised.file('word/document.xml').async('string'));const first=changed.indexOf(paragraph),second=changed.indexOf(paragraph,first+paragraph.length);assert(second>first);changed=changed.slice(0,second)+changed.slice(second+paragraph.length);revised.file('word/document.xml',changed);await writeFile(source,await revised.generateAsync({type:'nodebuffer'}));
 const chooser=page.waitForEvent('filechooser');await page.locator('#reload-preview').click();await (await chooser).setFiles(source);await page.waitForFunction(()=>!document.getElementById('open-button').disabled);
 await frame.locator('p').filter({hasText:/^重复段落/}).count().then(count=>assert.equal(count,1));
 await page.locator('.annotation-card').nth(3).locator('[data-action=locate]').click();await page.locator('.annotation-card').nth(3).locator('.location-status.ambiguous').waitFor();
 await context.close();console.log('PASS DOCX source accuracy: reference offsets, root-absolute media, native paraId image, table paths, cross-cell selection, Python evidence and deleted duplicate remains ambiguous');
} finally {await browser?.close();await rm(temp,{recursive:true,force:true});console.log('PROCESS_CLEANUP_COMPLETE');}
