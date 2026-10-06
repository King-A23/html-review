import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,symlink,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {EventEmitter} from 'node:events';
import {browserLaunchPlan, openReview, main} from '../bin/html-review.mjs';
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
  assert.match(await readFile(output, 'utf8'), /id="html-review-example">null<\/script>/);
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
test('CLI accepts file URLs and relative paths with Windows-valid special characters',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'html-review-'));
 try {
  const name="中文 空格 # % & () ^ + = ; '.html";
  const source=path.join(dir,name); const bytes=Buffer.from('<!doctype html><meta charset="utf-8"><p>URL 字节快照</p>');
  await writeFile(source,bytes);
  const fromURL=(await command(pathToFileURL(source).href)).stdout.trim();
  const data=dataOf(await readFile(fromURL,'utf8'));
  assert.equal(data.source.name,name); assert.deepEqual(Buffer.from(data.source.base64,'base64'),bytes);
  assert.equal((await command(pathToFileURL(fromURL).href)).stdout.trim(),fromURL,'annotated file URLs reopen the original copy');
  const relative=(await run(process.execPath,[cli,name,'--no-open'],{cwd:dir})).stdout.trim();
  assert.equal(await realpath(relative),await realpath(path.join(dir,name.replace(/\.html$/i,'.review.1.html'))));
 } finally {await rm(dir,{recursive:true,force:true});}
});
test('Windows browser launch plans preserve drive and UNC file URLs without a shell',()=>{
 const filenames=[
  String.raw`C:\报告 文件夹\审阅 # % & (draft) ^ + = ; '.html`,
  String.raw`\\review-server\共享 文件夹\审阅 # % & (draft).html`
 ];
 for(const filename of filenames) {
  const plan=browserLaunchPlan(filename,'win32');
  assert.equal(plan.command,'rundll32.exe');
  assert.equal(plan.args[0],'url.dll,FileProtocolHandler'); assert.equal(plan.args.length,2);
  const url=new URL(plan.args[1]); assert.equal(url.protocol,'file:'); assert.equal(url.hash,''); assert.equal(url.search,'');
  assert.equal(fileURLToPath(url,{windows:true}),filename);
  assert.match(plan.args[1],/%23/); assert.match(plan.args[1],/%25/); assert.match(plan.args[1],/%20/);
  assert.equal(plan.options.shell,false); assert.equal(plan.options.windowsHide,true);
 }
 assert.equal(new URL(browserLaunchPlan(filenames[1],'win32').args[1]).hostname,'review-server');
});
test('platform launch plans use argument arrays and native file URL escaping',()=>{
 const filename=path.join(root,"报告 # % & ; '.html");
 const mac=browserLaunchPlan(filename,'darwin');
 assert.equal(mac.command,'open'); assert.deepEqual(mac.args,['-a','Google Chrome',filename]); assert.equal(mac.options.shell,false);
 const linux=browserLaunchPlan('/tmp/报告 # % & ; file.html','linux');
 assert.equal(linux.command,'xdg-open'); assert.equal(linux.args.length,1);
 assert.equal(fileURLToPath(linux.args[0],{windows:false}),'/tmp/报告 # % & ; file.html');
});
test('browser launch uses the tested plan and propagates controlled startup failures',async()=>{
 const filename=String.raw`C:\中文 文件夹\报告 # % &.html`;
 let captured;
 await openReview(filename,{platform:'win32',spawnProcess:(...args)=>{
  captured=args; const child=new EventEmitter(); queueMicrotask(()=>child.emit('exit',0)); return child;
 }});
 const plan=browserLaunchPlan(filename,'win32'); assert.deepEqual(captured,[plan.command,plan.args,plan.options]);
 const failure=new Error('controlled missing executable');
 await assert.rejects(openReview(filename,{platform:'win32',spawnProcess:()=>{
  const child=new EventEmitter(); queueMicrotask(()=>child.emit('error',failure)); return child;
 }}),error=>error===failure);
 for(const code of [1,null]) {
  await assert.rejects(openReview(filename,{platform:'win32',spawnProcess:()=>{
   const child=new EventEmitter(); queueMicrotask(()=>child.emit('exit',code,'SIGTERM')); return child;
  }}),error=>/手动打开/.test(error.message) && !/macOS/.test(error.message));
 }
});
test('CLI entrypoint passes prepared paths to an injected opener and honors no-open/help',async()=>{
 const logs=[],errors=[],opened=[];
 const options={openFile:async filename=>opened.push(filename),log:value=>logs.push(value),errorLog:value=>errors.push(value)};
 assert.equal(await main([],options),0); assert.deepEqual(opened,[path.join(root,'index.html')]);
 assert.equal(await main(['--no-open'],options),0); assert.equal(opened.length,1);
 assert.equal(await main(['--help'],options),0); assert.equal(opened.length,1);
 assert.equal(await main(['--invalid'],options),1); assert.equal(opened.length,1); assert.equal(errors.length,1);
 const dir=await mkdtemp(path.join(tmpdir(),'html-review-'));
 try {
  const source=path.join(dir,'源 文件 # %.html'); await writeFile(source,'<!doctype html><p>源文件</p>');
  assert.equal(await main([pathToFileURL(source).href],options),0);
  assert.equal(opened.at(-1),source.replace(/\.html$/,'.review.html'));
  assert.equal(logs.at(-1),opened.at(-1));
 } finally {await rm(dir,{recursive:true,force:true});}
});
test('a linked CLI entrypoint still runs without opening a browser',{skip:process.platform==='win32'},async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'html-review-'));
 try {
  const linked=path.join(dir,'html-review'); await symlink(cli,linked);
  const {stdout}=await run(process.execPath,[linked,'--no-open']);
  assert.equal(stdout.trim(),path.join(root,'index.html'));
 } finally {await rm(dir,{recursive:true,force:true});}
});
