import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {createDocxFixture} from './docx-fixtures.mjs';
const context={crypto:webcrypto,TextDecoder,TextEncoder,Uint8Array,ArrayBuffer,URL,btoa,atob};
vm.runInNewContext(await readFile(new URL('../src/core.js',import.meta.url),'utf8'),context);
const core=context.HRCore;
const clone=value=>JSON.parse(JSON.stringify(value));
async function fixture(){return core.importSource({name:'中文审阅.docx',bytes:new Uint8Array(await createDocxFixture())});}
function annotation(data){return {id:'a',kind:'text',comment:'精简这一段',createdAt:data.createdAt,updatedAt:data.updatedAt,target:{kind:'text',selector:'[data-docx-id="dx1"]',quote:{exact:'中英混排',prefix:'',suffix:''},docx:{adapterVersion:'1',sourceSha256:data.source.sha256,blocks:[{id:'dx1',part:'word/document.xml',path:'/w:document[1]/w:body[1]/w:p[1]'}],start:{id:'dx1',offset:0},end:{id:'dx1',offset:4}}}};}
test('DOCX stores exact original bytes with binary metadata and emits no snapshots to task JSON',async()=>{
 const data=await fixture();data.annotations=[annotation(data)];await core.validateData(data);
 assert.equal(data.schemaVersion,2);assert.equal(data.source.type,'docx');assert.equal(data.source.encoding,undefined);
 assert.deepEqual(Buffer.from(data.source.base64,'base64'),await createDocxFixture());
 const light=core.createAnnotationExport(data);await core.validateAnnotationExport(light);
 assert.equal(light.source.base64,undefined);assert.equal(light.preview,undefined);assert.equal(light.index,undefined);
 assert.deepEqual(clone(light.resources),[]);assert(!core.createAgentTask(data).includes(data.source.base64));
 assert.match(core.createAgentTask(data),/OOXML/);assert.equal(core.resultPath('目录/中文审阅.docx'),'目录/中文审阅.review-results.json');
});
test('DOCX rejects corrupted metadata, missing mapping, unsafe source paths and malformed ranges transactionally',async()=>{
 const good=await fixture();good.annotations=[annotation(good)];
 for(const mutate of [d=>d.source.encoding='utf-8',d=>d.source.adapterVersion='2',d=>delete d.annotations[0].target.docx,d=>d.annotations[0].target.docx.blocks[0].path='/w:p[0]',d=>d.annotations[0].target.docx.blocks.push({...d.annotations[0].target.docx.blocks[0]}),d=>d.annotations[0].target.docx.end.offset=-1,d=>d.annotations[0].target.docx.start.offset=5,d=>d.annotations[0].target.docx.blocks[0].table={path:'/w:tbl[1]',row:0,column:1},d=>d.resources=[{path:'x',mime:'image/png'}]]) {
  const bad=clone(good);mutate(bad);await assert.rejects(core.validateData(bad));
 }
 const light=clone(core.createAnnotationExport(good));light.source.base64=good.source.base64;await assert.rejects(core.validateAnnotationExport(light),/快照/);
 const badLight=clone(core.createAnnotationExport(good));delete badLight.annotations[0].target.docx;await assert.rejects(core.validateAnnotationExport(badLight),/定位/);
 const wrongVersion=clone(core.createAnnotationExport(good));wrongVersion.schemaVersion=1;await assert.rejects(core.validateAnnotationExport(wrongVersion),/格式版本/);
});
test('DOCX source reload keeps historical target version and completion protocol independent of new bytes',async()=>{
 const old=await fixture();old.annotations=[annotation(old)];
 const newer=await core.importSource({name:old.source.name,bytes:new Uint8Array(await createDocxFixture('changed'))});newer.annotations=clone(old.annotations);
 await core.validateData(newer);assert.notEqual(newer.source.sha256,newer.annotations[0].target.docx.sourceSha256);
 const patch={format:'html-review-results',schemaVersion:1,batchId:'completed',results:[{id:'a',revision:1,annotationUpdatedAt:old.updatedAt,status:'resolved',summary:'完成',by:'agent'}]};
 const result=core.applyAgentResults(newer,patch);assert.equal(result.data.annotations[0].status,'resolved');assert.equal(result.data.annotations[0].target.docx.sourceSha256,old.source.sha256);
});
