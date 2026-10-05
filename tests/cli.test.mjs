import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
const run=promisify(execFile);
const root=fileURLToPath(new URL('../',import.meta.url));
const cli=path.join(root,'bin/html-review.mjs');
const command=(...args)=>run(process.execPath,[cli,...args,'--no-open']);
const dataOf=s=>JSON.parse(s.match(/<script id="html-review-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
test('CLI opens workbench without writing or launching processes in no-open mode',async()=>{
 const {stdout}=await command(); assert.equal(stdout.trim(),path.join(root,'index.html'));
});
test('CLI preserves source bytes, Unicode names and literal template replacement characters',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'html-review-'));
 try {
  const source=path.join(dir,'报告 $&.html'); const bytes=Buffer.from('\uFEFF<!doctype html>\r\n<meta charset="utf-8"><p>中文 😀</p>');
  await writeFile(source,bytes); const {stdout}=await command(source); const output=stdout.trim();
  const data=dataOf(await readFile(output,'utf8'));
  assert.equal(data.source.name,'报告 $&.html'); assert.deepEqual(Buffer.from(data.source.base64,'base64'),bytes);
  assert.equal(data.source.sha256,createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(await readFile(source),bytes);
  const second=(await command(source)).stdout.trim(); assert.notEqual(second,output);
  assert(second.endsWith('.review.1.html'));
  data.annotations.push({id:'note',kind:'page',comment:'修改标题',createdAt:data.createdAt,updatedAt:data.updatedAt,target:{kind:'page',text:'整页'}});
  const reviewed=(await readFile(output,'utf8')).replace(/(<script id="html-review-data" type="application\/json">)[\s\S]*?(<\/script>)/,(_,a,b)=>a+JSON.stringify(data)+b);
  await writeFile(output,reviewed);
  assert.equal((await command(output)).stdout.trim(),output); assert.equal(await readFile(output,'utf8'),reviewed);
 } finally {await rm(dir,{recursive:true,force:true});}
});
test('CLI rejects malformed annotated copies instead of erasing annotations',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'html-review-'));
 try { const filename=path.join(dir,'bad.review.html'); await writeFile(filename,'<script id="html-review-data" type="application/json">{"format":"bad"}</script>'); await assert.rejects(command(filename)); }
 finally {await rm(dir,{recursive:true,force:true});}
});
