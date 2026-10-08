/* Exercise current source adapter and native Worker without rebuilding index.html. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import JSZip from 'jszip';
import {chromium} from 'playwright';
import {createDocxFixture} from './docx-fixtures.mjs';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const zip=await JSZip.loadAsync(await createDocxFixture());
zip.file('word/styles.xml',`<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="ListBullet2"><w:name w:val="List Bullet 2"/><w:pPr><w:numPr><w:numId w:val="2"/></w:numPr></w:pPr></w:style></w:styles>`);
zip.file('word/numbering.xml',`<w:numbering xmlns:w="${W}">${[1,2].map(id=>`<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/>${id===2?'<w:pStyle w:val="ListBullet2"/>':''}<w:pPr><w:ind w:left="${id*360}"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="${id}"><w:abstractNumId w:val="${id}"/></w:num>`).join('')}</w:numbering>`);
zip.file('word/document.xml',`<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>普通项目</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="ListBullet2"/></w:pPr><w:r><w:t>服务侧  原文保持</w:t></w:r></w:p></w:body></w:document>`);
const bytes=await zip.generateAsync({type:'nodebuffer'});
const worker=await build({entryPoints:[new URL('../src/docx-worker.js',import.meta.url).pathname],bundle:true,write:false,platform:'browser',format:'iife'});
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
try {
 const page=await browser.newPage();
 await page.goto(new URL('../index.html',import.meta.url).href);
 await page.setContent('<script id="hr-docx-worker" type="text/plain"></script>');
 await page.evaluate(code=>document.getElementById('hr-docx-worker').textContent=code,Buffer.from(worker.outputFiles[0].text).toString('base64'));
 await page.addScriptTag({content:await readFile(new URL('../src/core.js',import.meta.url),'utf8')});
 await page.addScriptTag({content:await readFile(new URL('../src/docx.js',import.meta.url),'utf8')});
 const source={sha256:createHash('sha256').update(bytes).digest('hex'),base64:bytes.toString('base64')};
 const inventory=await page.evaluate(async source=>{
  const result=await HRDocx.preview({source},'');const doc=new DOMParser().parseFromString(result.html,'text/html');
  return {items:Array.from(doc.querySelectorAll('ul li')).map(e=>({text:e.textContent,margin:e.style.marginLeft})),nested:doc.querySelectorAll('ul ul').length,map:JSON.parse(doc.querySelector('script[data-docx-map]').textContent),sourceHash:doc.body.getAttribute('data-docx-source-sha256')};
 },source);
 assert.deepEqual(inventory.items,[{text:'普通项目',margin:'0px'},{text:'服务侧  原文保持',margin:'24px'}]);
 assert.equal(inventory.nested,0);assert.equal(inventory.sourceHash,source.sha256);
 assert.equal(inventory.map.dx2.path,'/w:document[1]/w:body[1]/w:p[2]');
 console.log('PASS current worker and prepared DOM preserve distinct single-level bullet indentation, text and source locations');
} finally {await browser.close();}
