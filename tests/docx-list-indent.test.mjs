import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {webcrypto} from 'node:crypto';
import {build} from 'esbuild';
import JSZip from 'jszip';
import {DOMParser} from '@xmldom/xmldom';
import {createDocxFixture} from './docx-fixtures.mjs';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const bundled=await build({entryPoints:[fileURLToPath(new URL('../src/docx-worker.js',import.meta.url))],bundle:true,write:false,platform:'browser',format:'iife',globalName:'adapter'});
const context={crypto:webcrypto,TextDecoder,TextEncoder,Uint8Array,ArrayBuffer,URL,Blob,setImmediate,clearImmediate,setTimeout,clearTimeout,console};
vm.runInNewContext(bundled.outputFiles[0].text,context);
async function convert(left='720',direct='') {
 const zip=await JSZip.loadAsync(await createDocxFixture());
 zip.file('word/styles.xml',`<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="BaseBullet"><w:name w:val="Base Bullet"/><w:pPr><w:numPr><w:numId w:val="2"/></w:numPr></w:pPr></w:style><w:style w:type="paragraph" w:styleId="DeepBullet"><w:name w:val="Deep Bullet"/><w:basedOn w:val="BaseBullet"/></w:style></w:styles>`);
 zip.file('word/numbering.xml',`<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:pPr><w:ind w:left="360"/></w:pPr></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:pStyle w:val="DeepBullet"/><w:pPr><w:ind w:left="${left}"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num></w:numbering>`);
 zip.file('word/document.xml',`<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>普通项目</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="DeepBullet"/>${direct}</w:pPr><w:r><w:t>服务侧  原文保持</w:t></w:r></w:p></w:body></w:document>`);
 const bytes=new Uint8Array(await zip.generateAsync({type:'uint8array'}));const original=Buffer.from(bytes);
 const result=await context.adapter.convertDocx(bytes);assert.deepEqual(Buffer.from(bytes),original,'Original source bytes stay unchanged');return result;
}
test('single-level 720 vs 360 twip bullets preserve extra spacing without nested lists or changed original locators',async()=>{
 const result=await convert();assert.equal(result.listIndents.dx1,0);assert.equal(result.listIndents.dx2,24);
 const doc=new DOMParser().parseFromString('<root>'+result.html+'</root>','application/xml');
 const lists=Array.from(doc.getElementsByTagName('ul'));assert.equal(lists.length,1);assert.equal(lists[0].getElementsByTagName('li').length,2);
 assert.match(doc.documentElement.textContent,/普通项目服务侧  原文保持/);
 assert.equal(result.map.dx1.path,'/w:document[1]/w:body[1]/w:p[1]');assert.equal(result.map.dx2.path,'/w:document[1]/w:body[1]/w:p[2]');
 assert.deepEqual(Object.keys(result.map.dx2).sort(),['id','part','path']);
});
test('direct paragraph indentation overrides numbering; extreme and malformed values cannot displace preview unboundedly',async()=>{
 assert.equal((await convert('720','<w:ind w:left="1080"/>')).listIndents.dx2,48);
 assert.equal((await convert('720','<w:ind w:start="900" w:left="1080"/>')).listIndents.dx2,36);
 assert.equal((await convert('999999999')).listIndents.dx2,192);
 assert.equal((await convert('-720')).listIndents.dx2,0);
 assert.equal((await convert('not-a-number')).listIndents.dx2,undefined);
});
