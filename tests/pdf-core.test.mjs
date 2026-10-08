import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
const context={crypto:webcrypto,TextDecoder,TextEncoder,Uint8Array,ArrayBuffer,URL,btoa,atob};
vm.runInNewContext(await readFile(new URL('../src/core.js',import.meta.url),'utf8'),context);
const core=context.HRCore, clone=value=>JSON.parse(JSON.stringify(value));
const bytes=new TextEncoder().encode('%PDF-1.7\n% binary source fixture\n%%EOF');
async function fixture(){return core.importSource({name:'中文 空格 # %.pdf',bytes});}
function annotation(data,kind='text') {
 const page={pageNumber:1,label:'i',viewBox:[-20,-10,592,782],rotation:90,userUnit:2,fingerprint:{textSha256:'a'.repeat(64),visualSha256:'b'.repeat(64)},rects:[[0,1,40,20]],quads:[[0,1,40,1,0,20,40,20]],segments:[{itemIndex:2,start:3,end:5,text:'😀'}],quote:'😀',prefix:'前文',suffix:'后文'};
 return {id:'pdf-note',kind,comment:'处理这部分',createdAt:data.createdAt,updatedAt:data.updatedAt,target:{kind,...(kind==='page'?{scope:'single-page'}:{}),pdf:{adapterVersion:'1',sourceSha256:data.source.sha256,pages:[page]}}};
}
test('PDF preserves exact binary bytes and exports bounded raw PDF locators without snapshots',async()=>{
 const data=await fixture();data.annotations=[annotation(data)];await core.validateData(data);
 assert.equal(data.schemaVersion,3);assert.equal(data.source.type,'pdf');assert.equal(data.source.encoding,undefined);
 assert.deepEqual(Buffer.from(data.source.base64,'base64'),Buffer.from(bytes));
 const light=core.createAnnotationExport(data);await core.validateAnnotationExport(light);
 assert.equal(light.source.base64,undefined);assert.deepEqual(clone(light.resources),[]);
 assert.equal(light.source.adapterVersion,'1');assert.equal(core.resultPath('目录/原始.PDF'),'目录/原始.review-results.json');
 const task=core.createAgentTask(data);assert.match(task,/原始 PDF 用户空间坐标/);assert.match(task,/UTF-16/);assert.match(task,/SHA-256/);assert.equal(task.includes(data.source.base64),false);
 assert.throws(()=>core.getSourceText(data));
});
test('PDF supports region, single physical page and whole-document scopes',async()=>{
 for(const kind of ['region','page']) {const data=await fixture();data.annotations=[annotation(data,kind)];await core.validateData(data);}
 const data=await fixture(),note=annotation(data,'page');note.target.scope='whole-document';note.target.pdf.pages=[];data.annotations=[note];await core.validateData(data);
 const leading=await core.importSource({name:'leading.pdf',bytes:new TextEncoder().encode('junk\n%PDF-1.4\n%%EOF')});await core.validateData(leading);
 await assert.rejects(core.importSource({name:'bad.pdf',bytes:new TextEncoder().encode('not PDF')}),/PDF/);
});
test('PDF rejects malformed coordinates, nonfinite numbers, UTF-16 ranges, scopes and snapshot caches',async()=>{
 const good=await fixture();good.annotations=[annotation(good)];
 for(const mutate of [d=>d.schemaVersion=1,d=>d.source.encoding='utf-8',d=>d.source.adapterVersion='2',d=>d.index=[],d=>d.source.textIndex=[],d=>delete d.annotations[0].target.pdf,d=>d.annotations[0].kind='element',d=>d.annotations[0].target.pdf.pages[0].rects[0][0]=-21,d=>d.annotations[0].target.pdf.pages[0].quads[0][0]=Infinity,d=>d.annotations[0].target.pdf.pages[0].viewBox[2]=-20,d=>d.annotations[0].target.pdf.pages[0].rotation=45,d=>d.annotations[0].target.pdf.pages[0].userUnit=0,d=>d.annotations[0].target.pdf.pages[0].fingerprint.textSha256='bad',d=>d.annotations[0].target.pdf.pages[0].segments[0].end=4,d=>d.annotations[0].target.pdf.pages[0].segments[0].start=-1,d=>d.annotations[0].target.pdf.pages.push({...d.annotations[0].target.pdf.pages[0]}),d=>{d.annotations[0].kind='page';d.annotations[0].target.kind='page';d.annotations[0].target.scope='whole-document';}]) {
  const bad=clone(good);mutate(bad);await assert.rejects(core.validateData(bad));
 }
 const light=core.createAnnotationExport(good);light.source.base64=good.source.base64;await assert.rejects(core.validateAnnotationExport(light),/快照/);
});
test('PDF target history follows its own kind and retains old source versions after reload',async()=>{
 const old=await fixture();old.annotations=[annotation(old)];
 const newer=await core.importSource({name:old.source.name,bytes:new TextEncoder().encode('%PDF-1.7\nnew\n%%EOF')});newer.annotations=clone(old.annotations);
 const note=newer.annotations[0];note.revision=2;note.targetHistory=[{revision:1,at:old.updatedAt,target:clone(note.target)}];note.kind='region';note.target.kind='region';
 await core.validateData(newer);assert.notEqual(note.target.pdf.sourceSha256,newer.source.sha256);
 const bad=clone(newer);bad.annotations[0].targetHistory[0].target={kind:'page',scope:'whole-document'};await assert.rejects(core.validateData(bad),/历史/);
 const result=core.applyAgentResults(newer,{format:'html-review-results',schemaVersion:1,batchId:'pdf-done',results:[{id:note.id,revision:2,annotationUpdatedAt:note.updatedAt,status:'resolved',summary:'完成',by:'agent'}]});assert.equal(result.data.annotations[0].status,'resolved');
});
