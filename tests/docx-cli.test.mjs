import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {prepareReview,browserLaunchPlan,main} from '../bin/html-review.mjs';
import {createDocxFixture} from './docx-fixtures.mjs';

const block = (html, id) => JSON.parse(html.match(new RegExp('<script id="'+id+'" type="application/json">([\\s\\S]*?)<\\/script>'))[1]);
async function temporary(run) {
  const directory = await mkdtemp(path.join(tmpdir(),'docx-cli-'));
  try {await run(directory);} finally {await rm(directory,{recursive:true,force:true});}
}
test('CLI DOCX paths and file URLs preserve original bytes, names and existing copies',async()=>temporary(async directory=>{
  const filename = path.join(directory,"中文 空格 # % & () ^ + = ; ' $&.DOCX");
  const bytes = await createDocxFixture(); await writeFile(filename,bytes);
  const first = await prepareReview(filename);
  assert.equal(first,filename.replace(/\.docx$/i,'.review.html'));
  const html = await readFile(first,'utf8'); const data = block(html,'html-review-data');
  assert.equal(data.schemaVersion,2); assert.equal(data.source.type,'docx'); assert.equal(data.source.adapterVersion,'1');
  assert.equal(data.source.name,path.basename(filename)); assert.equal(data.source.encoding,undefined);
  assert.deepEqual(Buffer.from(data.source.base64,'base64'),bytes);
  assert.equal(data.source.sha256,createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(await readFile(filename),bytes);
  const second = await prepareReview(pathToFileURL(filename).href);
  assert.equal(second,filename.replace(/\.docx$/i,'.review.1.html'));
  assert.equal(await readFile(first,'utf8'),html);
  assert.equal(await prepareReview(pathToFileURL(first).href),first);
  assert.equal(await readFile(first,'utf8'),html);
}));
test('CLI DOCX full copies retain annotations and reject changed source integrity',async()=>temporary(async directory=>{
  const filename=path.join(directory,'source.docx'); await writeFile(filename,await createDocxFixture());
  const output=await prepareReview(filename); let html=await readFile(output,'utf8'); const data=block(html,'html-review-data');
  data.annotations.push({id:'docx-note',kind:'page',comment:'完整文档意见',createdAt:data.createdAt,updatedAt:data.updatedAt,target:{kind:'page',scope:'whole-document',text:'整份文档',docx:{adapterVersion:'1',sourceSha256:data.source.sha256,blocks:[]}}});
  html=html.replace(/(<script id="html-review-data" type="application\/json">)[\s\S]*?(<\/script>)/,(_,start,end)=>start+JSON.stringify(data)+end);
  await writeFile(output,html); assert.equal(await prepareReview(output),output); assert.equal(await readFile(output,'utf8'),html);
  data.source.sha256='0'.repeat(64);
  await writeFile(output,html.replace(/(<script id="html-review-data" type="application\/json">)[\s\S]*?(<\/script>)/,(_,start,end)=>start+JSON.stringify(data)+end));
  await assert.rejects(prepareReview(output),/完整性/);
}));
test('CLI lightweight DOCX JSON creates a safe standalone pairing workspace without snapshots',async()=>temporary(async directory=>{
  const source=path.join(directory,'source.docx'); await writeFile(source,await createDocxFixture());
  const full=block(await readFile(await prepareReview(source),'utf8'),'html-review-data');
  const {base64,...metadata}=full.source;
  const light={...full,format:'html-review-annotations',source:{...metadata,name:'危险 </script><script>bad()</script>.docx'}};
  const input=path.join(directory,'轻量批注.json'); await writeFile(input,JSON.stringify(light));
  const original=await readFile(input,'utf8'); const output=await prepareReview(pathToFileURL(input).href);
  assert.equal(output,input.replace(/\.json$/,'.review.html'));
  const html=await readFile(output,'utf8'); assert.equal(block(html,'html-review-data'),null);
  assert.deepEqual(block(html,'html-review-pending-annotations'),light);
  assert.equal(block(html,'html-review-pending-annotations').source.base64,undefined);
  assert.equal(html.includes('危险 </script>'),false); assert.equal(await readFile(input,'utf8'),original);
  assert.equal(await prepareReview(input),input.replace(/\.json$/,'.review.1.html'));
  for(const invalid of [
    {...light,schemaVersion:1}, {...light,source:{...metadata,sha256:'bad'}},
    {...light,source:{...metadata,base64}}, {...light,annotations:{}},
    {...light,source:{...metadata,byteLength:-1}}, {...light,source:{...metadata,adapterVersion:'2'}}
  ]) {await writeFile(input,JSON.stringify(invalid)); await assert.rejects(prepareReview(input));}
}));
test('CLI rejects invalid DOCX headers without creating a review',async()=>temporary(async directory=>{
  const source=path.join(directory,'bad.docx'); await writeFile(source,'not a zip');
  await assert.rejects(prepareReview(source),/DOCX/); assert.equal(await readFile(source,'utf8'),'not a zip');
}));
test('DOCX Windows drive and UNC launch paths retain Unicode and reserved URL characters',()=>{
  for(const filename of [String.raw`C:\报告 空格\审阅 # % & (draft) ^ + = ; '.review.html`,String.raw`\\review-server\共享 文件夹\审阅 # %.review.html`]) {
    const plan=browserLaunchPlan(filename,'win32'); assert.equal(plan.command,'rundll32.exe'); assert.equal(plan.options.shell,false);
    assert.equal(fileURLToPath(plan.args[1],{windows:true}),filename);
    assert.match(plan.args[1],/%23/); assert.match(plan.args[1],/%25/); assert.match(plan.args[1],/%20/);
  }
});
test('CLI help describes DOCX import and lightweight pairing',async()=>{
  let help=''; assert.equal(await main(['--help'],{log:value=>help=value}),0);
  assert.match(help,/文件\.docx/); assert.match(help,/轻量批注 JSON/); assert.match(help,/对应的原始 DOCX/);
});
