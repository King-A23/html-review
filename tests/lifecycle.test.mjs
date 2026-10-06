import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';

const context = {crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, URL, btoa, atob};
vm.runInNewContext(await readFile(new URL('../src/core.js', import.meta.url), 'utf8'), context);
const core = context.HRCore;
const clone = value => JSON.parse(JSON.stringify(value));
async function fixture() {
  const data = await core.importSource({name: 'page.html', bytes: new TextEncoder().encode('<p>将被删除的原句</p>')});
  data.annotations = ['a', 'b', 'c'].map(id => ({id, kind: 'text', comment: '删除这句话',
    createdAt: data.createdAt, updatedAt: data.updatedAt, target: {kind: 'text', selector: '#copy', quote: {exact: '将被删除的原句'}}}));
  return data;
}
const patchFor = (data, ids = ['a'], batchId = 'batch-1') => ({format: 'html-review-results', schemaVersion: 1, batchId,
  results: ids.map(id => {const annotation = data.annotations.find(item => item.id === id); return {id,
    revision: annotation.revision || 1, annotationUpdatedAt: annotation.updatedAt, status: 'resolved', summary: '已删除并核对页面', by: 'agent', at: '2026-10-06T10:00:00.000Z'};})});

test('legacy annotations gain explicit workflow metadata on export without losing original context', async () => {
  const data = await fixture(); await core.validateData(data);
  const exported = clone(core.createAnnotationExport(data));
  assert.equal(exported.annotations[0].revision, 1);
  assert.equal(exported.annotations[0].status, 'open');
  assert.equal(exported.annotations[0].taskState, 'new');
  assert.deepEqual(exported.annotations[0].target, data.annotations[0].target);
  assert.equal('base64' in exported.source, false);
  assert.equal(core.resultPath('slides/index.xhtml'), 'slides/index.review-results.json');
});

test('partial results preserve opinions and produce completed, pending and new tasks', async () => {
  const data = await fixture(), before = clone(data), patch = patchFor(data, ['a', 'b']);
  patch.results[1].status = 'open'; patch.results[1].summary = '需要用户补充目标';
  const merged = core.applyAgentResults(data, patch); await core.validateData(merged.data);
  assert.equal(merged.applied, 2); assert.deepEqual(clone(data), before);
  assert.deepEqual(merged.data.annotations.map(core.taskState), ['completed', 'pending', 'new']);
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(merged.data.annotations[i].target, before.annotations[i].target);
    assert.equal(merged.data.annotations[i].comment, before.annotations[i].comment);
    assert.equal(merged.data.annotations[i].updatedAt, before.annotations[i].updatedAt);
  }
  const task = core.createAgentTask(merged.data);
  assert.match(task, /仅处理 status=open/);
  assert.match(task, /update_review.py/);
  assert.equal(JSON.parse(task.slice(task.indexOf('{'))).annotations[0].taskState, 'completed');
});

test('replaying completed results cannot close newly edited opinions; new stale batches reject', async () => {
  const original = await fixture(), patch = patchFor(original);
  const saved = core.applyAgentResults(original, patch).data;
  const edited = clone(saved); edited.annotations[0].revision = 2; edited.annotations[0].status = 'open';
  edited.annotations[0].comment = '再调整一次'; edited.annotations[0].updatedAt = '2026-10-06T11:00:00.000Z';
  const replay = core.applyAgentResults(edited, patch);
  assert.equal(replay.applied, 0); assert.equal(replay.skipped, 1);
  assert.equal(core.taskState(replay.data.annotations[0]), 'updated');
  assert.equal(replay.data.annotations[0].history.length, 1);
  assert.throws(() => core.applyAgentResults(edited, {...patch, batchId: 'new-stale-batch'}), /过期/);
  assert.equal(edited.annotations[0].status, 'open');
});

test('invalid and conflicting result batches fail atomically', async () => {
  const data = await fixture(), before = clone(data), good = patchFor(data, ['a', 'b']);
  const invalids = [
    {...good, results: [good.results[0], {...good.results[1], id: 'unknown'}]},
    {...good, results: [good.results[0], good.results[0]]},
    {...good, results: [good.results[0], {...good.results[1], revision: 2}]},
    {...good, results: [good.results[0], {...good.results[1], annotationUpdatedAt: '2026-01-01T00:00:00.000Z'}]},
    {...good, results: [{...good.results[0], status: 'done'}]},
    {...good, results: [{...good.results[0], summary: 'x'.repeat(4001)}]},
    {...good, results: []}, {...good, batchId: ''}
  ];
  for (const patch of invalids) {assert.throws(() => core.applyAgentResults(data, patch)); assert.deepEqual(clone(data), before);}
  const merged = core.applyAgentResults(data, good).data;
  const conflicting = clone(good); conflicting.results[0].summary = '改变之前的回报';
  assert.throws(() => core.applyAgentResults(merged, conflicting), /冲突/);
  assert.throws(() => core.applyAgentResults(merged, {...good, results: [...good.results, ...patchFor(data, ['c']).results]}), /冲突/);
  assert.throws(() => core.applyAgentResults(merged, {...good, results: [good.results[0]]}), /冲突/);
  const changedTime = clone(good); changedTime.results[0].annotationUpdatedAt = '2026-01-01T00:00:00.000Z';
  assert.throws(() => core.applyAgentResults(merged, changedTime), /冲突/);
});

test('invalid lifecycle data is rejected by stored data validation and public merge API', async () => {
  const data = await fixture();
  for (const metadata of [{revision: 0}, {status: 'done'}, {history: null}, {history: {}}]) {
    const invalid = clone(data); Object.assign(invalid.annotations[0], metadata);
    await assert.rejects(core.validateData(invalid));
    assert.throws(() => core.applyAgentResults(invalid, patchFor(data)));
  }
  const saved = core.applyAgentResults(data, patchFor(data)).data;
  const backwards = clone(saved); backwards.annotations[0].history.push({...backwards.annotations[0].history[0], batchId: 'another', revision: 2});
  await assert.rejects(core.validateData(backwards), /版本/);
});
