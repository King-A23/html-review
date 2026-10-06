import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {findPython, runPython} from '../scripts/python.mjs';
const execute = promisify(execFile), root = fileURLToPath(new URL('../', import.meta.url));
const wrapper = path.join(root, 'scripts/python.mjs');

test('Python subprocesses preserve Chinese and emoji despite legacy output encoding', async () => {
  const {stdout} = await runPython(['-c', 'print("中文 😀")'], {encoding:'utf8', env:{PYTHONUTF8:'0', PYTHONIOENCODING:'ascii'}});
  assert.equal(stdout.trim(), '中文 😀');
});

test('portable Python entrypoint discovers an interpreter and preserves filename/argument boundaries', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'html-review-python-'));
  try {
    const script = path.join(dir, '中文 & (helper) %.py');
    await writeFile(script, 'import sys,json\nprint(json.dumps(sys.argv[1:],ensure_ascii=False))\n');
    const env = {...process.env, PYTHONIOENCODING:'ascii'}; delete env.PYTHON;
    const {stdout} = await execute(process.execPath, [wrapper, script, '意见 #%.json', '中文 😀'], {encoding:'utf8', env});
    assert.deepEqual(JSON.parse(stdout), ['意见 #%.json', '中文 😀']);
    await assert.rejects(execute(process.execPath, [wrapper, script], {env:{...process.env, PYTHON:path.join(dir,'missing-python')}}),
      error => error.code === 1 && /PYTHON must point/.test(error.stderr));
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('direct agent scripts emit UTF-8 when piped without the Node wrapper', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'html-review-utf8-'));
  try {
    const html = await readFile(path.join(root,'examples/demo.review.html'),'utf8');
    const data = JSON.parse(html.match(/<script id="html-review-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    const source = path.join(dir,'报告 😀.html'), review = path.join(dir,'报告.review.json');
    await writeFile(source,Buffer.from(data.source.base64,'base64'));
    data.format='html-review-annotations'; delete data.source.base64;
    data.source.name='报告 😀.html'; data.source.path='报告 😀.html';
    data.annotations[0].comment='修改标题，保留中文 😀';
    await writeFile(review,JSON.stringify(data));
    const {command,args} = await findPython();
    const options={encoding:'utf8',env:{...process.env,PYTHONUTF8:'0',PYTHONIOENCODING:'ascii'}};
    const inspected=await execute(command,[...args,path.join(root,'scripts/inspect_review.py'),review,source],options);
    assert.match(inspected.stdout,/修改标题，保留中文 😀/);
    const output=path.join(dir,'结果 😀.review-results.json');
    const updated=await execute(command,[...args,path.join(root,'scripts/update_review.py'),review,'--id',data.annotations[0].id,'--summary','已修改 😀','--output',output],options);
    assert.match(updated.stdout,/结果 😀/);
    assert.equal(JSON.parse(await readFile(output,'utf8')).results[0].summary,'已修改 😀');
  } finally {await rm(dir,{recursive:true,force:true});}
});
