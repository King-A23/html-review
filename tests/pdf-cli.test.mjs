import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {prepareReview,main} from '../bin/html-review.mjs';
import {runPython} from '../scripts/python.mjs';
const block=(html,id)=>JSON.parse(html.match(new RegExp('<script id="'+id+'" type="application/json">([\\s\\S]*?)<\\/script>'))[1]);
async function temporary(run){const directory=await mkdtemp(path.join(tmpdir(),'pdf-cli-'));try{await run(directory);}finally{await rm(directory,{recursive:true,force:true});}}
test('CLI imports PDF binary and file URLs without overwriting source or earlier reviews',async()=>temporary(async directory=>{
 const filename=path.join(directory,"中文 空格 # % & '.PDF"),bytes=Buffer.from('%PDF-1.7\n\x00\xff binary\n%%EOF','latin1');await writeFile(filename,bytes);
 const first=await prepareReview(pathToFileURL(filename).href);assert.equal(first,filename.replace(/\.pdf$/i,'.review.html'));
 const data=block(await readFile(first,'utf8'),'html-review-data');assert.equal(data.schemaVersion,3);assert.equal(data.source.type,'pdf');assert.deepEqual(Buffer.from(data.source.base64,'base64'),bytes);assert.deepEqual(await readFile(filename),bytes);
 assert.equal(await prepareReview(filename),filename.replace(/\.pdf$/i,'.review.1.html'));assert.equal(await prepareReview(first),first);
 const json=path.join(directory,'批注.json'),{base64,...metadata}=data.source,light={...data,format:'html-review-annotations',source:metadata};await writeFile(json,JSON.stringify(light));
 const paired=await prepareReview(json),html=await readFile(paired,'utf8');assert.equal(block(html,'html-review-data'),null);assert.deepEqual(block(html,'html-review-pending-annotations'),light);
 for(const invalid of [{...light,schemaVersion:1},{...light,source:{...metadata,base64}},{...light,index:[]}]){await writeFile(json,JSON.stringify(invalid));await assert.rejects(prepareReview(json));}
}));
test('PDF inspection verifies hashes and locator metadata without claiming parsed text evidence',async()=>temporary(async directory=>{
 const source=path.join(directory,'source.pdf');await writeFile(source,'%PDF-1.7\n%%EOF');const full=block(await readFile(await prepareReview(source),'utf8'),'html-review-data');
 const page={pageNumber:1,label:'1',viewBox:[0,0,612,792],rotation:0,userUnit:1,fingerprint:{textSha256:'a'.repeat(64),visualSha256:'b'.repeat(64)},rects:[[10,10,50,50]]};
 full.annotations=[{id:'pdf-note',kind:'region',comment:'这里修改',createdAt:full.createdAt,updatedAt:full.updatedAt,target:{kind:'region',pdf:{adapterVersion:'1',sourceSha256:full.source.sha256,pages:[page]}}}];const {base64,...metadata}=full.source;const light={...full,format:'html-review-annotations',source:metadata};const json=path.join(directory,'review.json');await writeFile(json,JSON.stringify(light));
 const script=fileURLToPath(new URL('../scripts/inspect_review.py',import.meta.url));const output=await runPython([script,json,source],{encoding:'utf8'});assert.match(output.stdout,/未解析或验证页面文字/);assert.match(output.stdout,/viewBox/);assert.match(output.stdout,/这里修改/);assert.equal(output.stdout.includes(base64),false);
 light.annotations[0].target.pdf.pages[0].rects[0][0]=-1;await writeFile(json,JSON.stringify(light));await assert.rejects(runPython([script,json,source],{encoding:'utf8'}));
}));
test('CLI PDF help and signature errors are explicit',async()=>temporary(async directory=>{
 let help='';await main(['--help'],{log:value=>help=value});assert.match(help,/文件\.pdf/);
 const filename=path.join(directory,'bad.pdf');await writeFile(filename,'not a pdf');await assert.rejects(prepareReview(filename),/PDF/);
}));
