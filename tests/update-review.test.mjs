import {runPython} from '../scripts/python.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm, symlink, readdir, realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash, webcrypto} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../', import.meta.url));
const updater = path.join(root, 'scripts/update_review.py');
const inspector = path.join(root, 'scripts/inspect_review.py');
const update = (...args) => runPython([updater, ...args], {encoding: 'utf8'});
const timestamp = '2026-01-01T00:00:00.000Z';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function setup(t) {
  try { await runPython(['--version']); }
  catch (_) { t.skip('Python 3.8+ is unavailable; update_review.py tests are skipped.'); return null; }
  const dir = await mkdtemp(path.join(tmpdir(), 'html-review-results-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const sourceBytes = Buffer.from('<!doctype html><p>原始页面</p>');
  const data = {
    format: 'html-review', schemaVersion: 1, createdAt: timestamp, updatedAt: timestamp,
    source: {name: 'source.html', path: 'source.html', byteLength: sourceBytes.length,
      sha256: digest(sourceBytes), base64: sourceBytes.toString('base64'), encoding: 'utf-8', lastModified: null}, resources: [],
    annotations: [
      {id: 'one', kind: 'page', comment: '意见保持原样', createdAt: timestamp, updatedAt: timestamp, target: {kind: 'page', text: '整页'}},
      {id: 'two', kind: 'page', comment: '第二条', createdAt: timestamp, updatedAt: timestamp, revision: 3, status: 'open', target: {kind: 'page', text: '整页'}},
      {id: 'done', kind: 'page', comment: '已完成', createdAt: timestamp, updatedAt: timestamp, revision: 2, status: 'resolved', target: {kind: 'page', text: '整页'}}
    ]
  };
  const light = structuredClone(data);
  light.format = 'html-review-annotations';
  delete light.source.base64;
  const json = path.join(dir, 'source.review.json');
  const html = path.join(dir, 'source.review.html');
  const gzip = html + '.gz';
  const source = path.join(dir, 'source.html');
  const document = `<script id="html-review-data" type="application/json">${JSON.stringify(data)}</script>`;
  await Promise.all([writeFile(json, JSON.stringify(light)), writeFile(html, document), writeFile(gzip, gzipSync(document)), writeFile(source, sourceBytes)]);
  return {dir, data, light, json, html, gzip, source};
}

test('completion CLI accepts full, gzip and lightweight review after source changes and emits only guarded results', async t => {
  const f = await setup(t); if (!f) return;
  await writeFile(f.source, '<p>已经修改后的页面</p>');
  for (const [i, input] of [f.html, f.gzip, f.json].entries()) {
    const before = await readFile(input);
    const output = path.join(f.dir, `output-${i}.json`);
    const {stdout} = await update(input, '--id', 'two', '--id', 'one', '--summary', '统一标题层级。', '--output', output);
    assert.equal(stdout.trim(), await realpath(output));
    const raw = await readFile(output, 'utf8');
    const result = JSON.parse(raw);
    assert.equal(result.format, 'html-review-results');
    assert.equal(result.schemaVersion, 1);
    assert.match(result.batchId, /^[0-9a-f-]{36}$/);
    assert.deepEqual(result.results.map(row => [row.id, row.revision]), [['two', 3], ['one', 1]]);
    for (const row of result.results) {
      assert.deepEqual(Object.keys(row).sort(), ['annotationUpdatedAt', 'at', 'by', 'id', 'revision', 'status', 'summary']);
      assert.equal(row.annotationUpdatedAt, timestamp);
      assert.equal(row.status, 'resolved');
      assert.equal(row.summary, '统一标题层级。');
      assert.equal(row.by, 'agent');
      assert.equal(Number.isNaN(Date.parse(row.at)), false);
    }
    assert.equal(raw.includes('base64'), false);
    assert.equal(raw.includes(f.data.source.base64), false);
    assert.equal(raw.includes('意见保持原样'), false);
    assert.deepEqual(await readFile(input), before);
  }
  assert.equal(await readFile(f.source, 'utf8'), '<p>已经修改后的页面</p>');
});

test('selection is explicit; pending selects only open annotations and explicit IDs can reopen completed work', async t => {
  const f = await setup(t); if (!f) return;
  const output = path.join(f.dir, 'source.review-results.json');
  await assert.rejects(update(f.json, '--output', output), error => error.code === 2);
  await update(f.json, '--pending', '--output', output);
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')).results.map(row => row.id), ['one', 'two']);
  const batchId = JSON.parse(await readFile(output, 'utf8')).batchId;
  await update(f.json, '--id', 'done', '--status', 'open', '--by', 'reviewer', '--summary', '需要继续修改', '--output', output);
  const result = JSON.parse(await readFile(output, 'utf8'));
  assert.notEqual(result.batchId, batchId);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].status, 'open');
  assert.equal(result.results[0].by, 'reviewer');
  assert.equal((await readdir(f.dir)).some(name => name.startsWith('.review-results-')), false);
});

test('unknown, duplicate and ambiguous selections reject the entire output', async t => {
  const f = await setup(t); if (!f) return;
  const output = path.join(f.dir, 'results.json');
  for (const selection of [['--id', 'one', '--id', 'missing'], ['--id', 'one', '--id', 'one'], ['--pending', '--id', 'one']]) {
    await assert.rejects(update(f.json, ...selection, '--output', output));
    await assert.rejects(readFile(output), error => error.code === 'ENOENT');
  }
});

test('output protection preserves review, HTML, unrelated JSON and symbolic link targets', async t => {
  const f = await setup(t); if (!f) return;
  const unrelated = path.join(f.dir, 'unrelated.json');
  const linked = path.join(f.dir, 'linked.json');
  await writeFile(unrelated, '{"keep":"me"}');
  await symlink(unrelated, linked);
  for (const output of [f.json, f.html, f.source, unrelated, linked]) {
    const before = await readFile(output);
    await assert.rejects(update(f.json, '--id', 'one', '--output', output));
    assert.deepEqual(await readFile(output), before);
  }
});

test('corrupt snapshots, invalid annotation metadata and overlong result text leave earlier results untouched', async t => {
  const f = await setup(t); if (!f) return;
  const output = path.join(f.dir, 'results.json');
  await update(f.json, '--id', 'one', '--output', output);
  const before = await readFile(output);
  for (const mutate of [
    data => { data.source.base64 = Buffer.from('tampered').toString('base64'); },
    data => { data.annotations[0].revision = 0; },
    data => { data.annotations[0].revision = true; },
    data => { data.annotations[0].status = 'other'; },
    data => { data.annotations[0].updatedAt = 'invalid'; },
    data => { data.annotations[1].id = 'one'; },
    data => { data.annotations[0].history = [{revision: 1, status: 'resolved'}]; }
  ]) {
    const data = structuredClone(f.data); mutate(data);
    const bad = path.join(f.dir, 'bad.review.html');
    await writeFile(bad, `<script id="html-review-data" type="application/json">${JSON.stringify(data)}</script>`);
    await assert.rejects(update(bad, '--id', 'one', '--output', output));
    assert.deepEqual(await readFile(output), before);
  }
  for (const args of [['--summary', 'x'.repeat(4001)], ['--summary', '😀'.repeat(2001)], ['--by', 'x'.repeat(201)], ['--by', '😀'.repeat(101)], ['--by', '   ']]) {
    await assert.rejects(update(f.json, '--id', 'one', ...args, '--output', output));
    assert.deepEqual(await readFile(output), before);
  }
});

test('lifecycle history rejects duplicate batches, backward/future revisions, invalid guards and exhausted history', async t => {
  const f = await setup(t); if (!f) return;
  const output = path.join(f.dir, 'results.json');
  const event = {batchId: 'batch-1', revision: 1, status: 'open', summary: '', by: 'agent', at: timestamp};
  for (const history of [
    [event, event],
    [{...event, revision: 2}, {...event, batchId: 'batch-2', revision: 1}],
    [{...event, revision: 4}],
    [{...event, by: '  '}],
    [{...event, batchId: '  '}],
    [{...event, annotationUpdatedAt: 'invalid'}],
    Array.from({length: 501}, (_, i) => ({...event, batchId: 'batch-' + i}))
  ]) {
    const light = structuredClone(f.light);
    light.annotations[1].history = history;
    await writeFile(f.json, JSON.stringify(light));
    await assert.rejects(update(f.json, '--id', 'two', '--output', output));
    await assert.rejects(readFile(output), error => error.code === 'ENOENT');
  }
  const light = structuredClone(f.light);
  light.annotations[1].history = Array.from({length: 500}, (_, i) => ({...event, batchId: 'batch-' + i}));
  await writeFile(f.json, JSON.stringify(light));
  await assert.rejects(update(f.json, '--id', 'two', '--output', output), error => /已达 500 条/.test(error.stderr));
  // The valid 500-event review remains inspectable, though another event cannot fit.
  await runPython([inspector, f.json, f.source], {encoding: 'utf8'});
});

test('pending on a fully completed review fails instead of writing an unimportable empty batch', async t => {
  const f = await setup(t); if (!f) return;
  const output = path.join(f.dir, 'results.json');
  for (const annotation of f.light.annotations) annotation.status = 'resolved';
  await writeFile(f.json, JSON.stringify(f.light));
  await assert.rejects(update(f.json, '--pending', '--output', output), error => /没有可回报/.test(error.stderr));
  await assert.rejects(readFile(output), error => error.code === 'ENOENT');
});

test('Python result batch applies in browser core without altering opinions and replay remains safe after user edits', async t => {
  const f = await setup(t); if (!f) return;
  const context = {crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, URL, btoa, atob};
  vm.runInNewContext(await readFile(path.join(root, 'src/core.js'), 'utf8'), context);
  const core = context.HRCore;
  await core.validateData(f.data);
  const output = path.join(f.dir, 'results.json');
  await update(f.json, '--id', 'one', '--id', 'two', '--summary', '完成并验证', '--output', output);
  const patch = JSON.parse(await readFile(output, 'utf8'));
  const before = JSON.stringify(f.data);
  const first = core.applyAgentResults(f.data, patch);
  assert.equal(first.applied, 2);
  assert.equal(first.skipped, 0);
  assert.equal(JSON.stringify(f.data), before);
  for (const annotation of first.data.annotations.slice(0, 2)) {
    const original = f.data.annotations.find(row => row.id === annotation.id);
    assert.equal(annotation.comment, original.comment);
    assert.equal(JSON.stringify(annotation.target), JSON.stringify(original.target));
    assert.equal(annotation.updatedAt, original.updatedAt);
    assert.equal(annotation.revision, original.revision || 1);
    assert.equal(annotation.status, 'resolved');
    assert.equal(annotation.history[0].batchId, patch.batchId);
    assert.equal(annotation.history[0].at, patch.results[0].at);
  }
  await core.validateData(first.data);
  const edited = JSON.parse(JSON.stringify(first.data));
  edited.annotations[0].revision++;
  edited.annotations[0].status = 'open';
  edited.annotations[0].comment = '用户修改了意见';
  edited.annotations[0].updatedAt = '2026-01-02T00:00:00.000Z';
  const replay = core.applyAgentResults(edited, patch);
  assert.equal(replay.applied, 0);
  assert.equal(replay.skipped, 2);
  assert.equal(replay.data.annotations[0].status, 'open');
  assert.equal(replay.data.annotations[0].comment, '用户修改了意见');
  assert.throws(() => core.applyAgentResults(edited, {...patch, batchId: 'another-batch'}), /过期/);
});

test('inspector displays normalized defaults and new, updated, pending and completed task states', async t => {
  const f = await setup(t); if (!f) return;
  const event = {batchId: 'batch-1', revision: 1, status: 'open', summary: '仍需修改', by: 'agent', at: timestamp};
  f.light.annotations[1].history = [event];
  f.light.annotations.push({...structuredClone(f.light.annotations[0]), id: 'pending', history: [event]});
  await writeFile(f.json, JSON.stringify(f.light));
  const {stdout} = await runPython([inspector, f.json, f.source], {encoding: 'utf8'});
  const annotations = JSON.parse(stdout.slice(stdout.indexOf('[\n'), stdout.lastIndexOf('\n]') + 2));
  assert.deepEqual(annotations.map(row => row.taskState), ['new', 'updated', 'completed', 'pending']);
  assert.deepEqual([annotations[0].revision, annotations[0].status, annotations[0].history], [1, 'open', []]);
  assert.equal(annotations[0].comment, f.light.annotations[0].comment);
  assert.deepEqual(annotations[0].target, f.light.annotations[0].target);
});
