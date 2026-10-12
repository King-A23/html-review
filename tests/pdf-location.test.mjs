/* Exercise production locator code in a VM; internal exposure exists only in this test. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
const coreSource=await readFile(new URL('../src/core.js',import.meta.url),'utf8');
const engineSource=await readFile(new URL('../src/pdf.js',import.meta.url),'utf8');
function engine() {
 const context={crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,URL,btoa,atob,setTimeout,clearTimeout};
 context.window=context;context.addEventListener=()=>{};
 vm.runInNewContext(coreSource,context);
 const marker='global.HRPdf=Object.freeze({';assert.equal(engineSource.split(marker).length,2);
 vm.runInNewContext(engineSource.replace(marker,'global.HRPdf=Object.freeze({_resolve:resolveTarget,_capture:captureSelection,_chosen:chosen,_setCurrent:session=>{current=session;},'),context);
 return context;
}
const sha=character=>character.repeat(64), clone=value=>JSON.parse(JSON.stringify(value));
const geometry={pageNumber:1,label:'1',viewBox:[0,0,600,800],rotation:0,userUnit:2};
const currentFingerprint={textSha256:sha('b'),visualSha256:sha('c')};
const oldFingerprint={textSha256:sha('d'),visualSha256:sha('e')};
function fixture(context,{stream='needle',same=false}={}) {
 const events=[],navigation=[];
 const content={value:{items:[{str:stream,transform:[10,0,0,10,100,100],width:stream.length*10,height:10}]},stream,starts:[0]};
 const slot={number:1,node:{dataset:{noText:'false',rendered:'true'},scrollIntoView:()=>navigation.push(1)}};
 const session={data:{source:{sha256:sha('a')}},geometry:[clone(geometry)],slots:[slot],contents:new Map([[1,content]]),fingerprints:new Map([[1,currentFingerprint]]),destroyed:false,checkSerial:0,searchSerial:0,selectionSerial:0,pageNumber:1,renderGeneration:1,renderQueue:Promise.resolve(),focus:null,container:{querySelectorAll:()=>[]},emit:event=>events.push(event)};
 const target={kind:'text',pdf:{adapterVersion:'1',sourceSha256:same?sha('a'):sha('f'),pages:[{...clone(geometry),fingerprint:same?currentFingerprint:oldFingerprint,rects:[[100,100,160,110]],segments:[{itemIndex:0,start:0,end:6,text:'needle'}],quote:'needle',prefix:'',suffix:''}]}};
 context.HRPdf._setCurrent(session);return {session,target,events,navigation};
}
test('PDF text fallback preserves raw-space width with nondefault UserUnit',async()=>{
 const context=engine(),{session,target}=fixture(context);
 const before=clone(target),result=await context.HRPdf._resolve(session,target);
 assert.equal(result.status,'fallback');assert.deepEqual(clone(result.target.pdf.pages[0].rects),[[100,100,160,110]]);
 assert.deepEqual(target,before,'resolution must not rewrite stored locators');
});
test('PDF same-file locator rejects forged quote and context despite matching page fingerprint',async()=>{
 const context=engine(),{session,target}=fixture(context,{same:true});
 assert.equal((await context.HRPdf._resolve(session,target)).status,'exact');
 for(const key of ['quote','prefix','suffix']) {
  const invalid=clone(target);invalid.pdf.pages[0][key]='forged';
  assert.equal((await context.HRPdf._resolve(session,invalid)).status,'missing',key);
 }
 const invalid=clone(target);invalid.pdf.pages[0].segments[0].text='wrong!';
 assert.equal((await context.HRPdf._resolve(session,invalid)).status,'missing');
});
test('PDF cancellation while final fingerprint is pending cannot apply locator focus or navigation',async()=>{
 const context=engine(),{session,target,events,navigation}=fixture(context,{same:true});
 let release;session.fingerprints.set(1,new Promise(resolve=>{release=resolve;}));
 const pending=context.HRPdf.command('locate',{target,requestId:'note',locationToken:'request'});
 await Promise.resolve();context.HRPdf.cancelOperations();events.length=0;
 release(currentFingerprint);await pending;
 assert.equal(session.focus,null);assert.deepEqual(navigation,[]);assert.equal(events.some(event=>event.event==='located'),false);
});
test('PDF collapsed selection invalidates an asynchronous first selection before it can emit a stale target',async()=>{
 const context=engine(),{session,target,events}=fixture(context,{same:true});
 const capturedSerial=session.selectionSerial;context.getSelection=()=>({rangeCount:1,isCollapsed:true});
 await context.HRPdf._capture(session);context.HRPdf._chosen(session,target,capturedSerial);
 assert.equal(session.selectionSerial,capturedSerial+1);assert.equal(session.focus,null);assert.equal(events.some(event=>event.event==='target'),false);
});
test('PDF changed regions remain missing and duplicate page fingerprints remain ambiguous',async()=>{
 const context=engine(),{session,target}=fixture(context);const region=clone(target);region.kind='region';
 assert.equal((await context.HRPdf._resolve(session,region)).status,'missing');
 session.fingerprints.set(1,oldFingerprint);session.geometry.push({...clone(geometry),pageNumber:2,label:'2'});session.slots.push({number:2});session.fingerprints.set(2,oldFingerprint);
 assert.equal((await context.HRPdf._resolve(session,region)).status,'ambiguous');
});
test('PDF changed text with repeated quote and context remains ambiguous rather than rebinding',async()=>{
 const context=engine(),{session,target}=fixture(context,{stream:'needle needle'});
 assert.equal((await context.HRPdf._resolve(session,target)).status,'ambiguous');
});
test('PDF exact matching preserves UTF-16 partial selections across multiple physical pages',async()=>{
 const context=engine(),{session,target}=fixture(context,{same:true,stream:'prefix 😀 suffix'});
 const first=target.pdf.pages[0];first.segments=[{itemIndex:0,start:7,end:9,text:'😀'}];first.quote='😀';first.prefix='prefix ';first.suffix=' suffix';
 const secondGeometry={...clone(geometry),pageNumber:2,label:'ii',rotation:90};
 session.geometry.push(secondGeometry);session.slots.push({number:2});session.fingerprints.set(2,oldFingerprint);
 session.contents.set(2,{value:{items:[{str:'second page',transform:[10,0,0,10,100,100],width:110,height:10}]},stream:'second page',starts:[0]});
 target.pdf.pages.push({...clone(secondGeometry),fingerprint:oldFingerprint,rects:[[100,100,160,110]],segments:[{itemIndex:0,start:0,end:6,text:'second'}],quote:'second',prefix:'',suffix:' page'});
 const result=await context.HRPdf._resolve(session,target);assert.equal(result.status,'exact');
 assert.deepEqual(clone(result.target.pdf.pages.map(page=>({pageNumber:page.pageNumber,segments:page.segments}))),[{pageNumber:1,segments:[{itemIndex:0,start:7,end:9,text:'😀'}]},{pageNumber:2,segments:[{itemIndex:0,start:0,end:6,text:'second'}]}]);
 const bad=clone(target);bad.pdf.pages[0].segments[0].end=8;bad.pdf.pages[0].segments[0].text='x';assert.equal((await context.HRPdf._resolve(session,bad)).status,'missing');
});
