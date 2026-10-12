import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile, mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {webcrypto} from 'node:crypto';
import {runPython} from '../scripts/python.mjs';
import {createDocxFixture} from './docx-fixtures.mjs';

const context = {crypto:webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, URL, btoa, atob};
vm.runInNewContext(await readFile(new URL('../src/core.js', import.meta.url), 'utf8'), context);
const core = context.HRCore;
const clone = value => JSON.parse(JSON.stringify(value));
const oldTarget = {kind:'text', selector:'#old', quote:{exact:'历史原文不应出现在静态摘要中'}};
const event = revision => ({revision, target:clone(oldTarget), view:{width:800, height:600, devicePixelRatio:1}, at:'2026-10-08T01:00:00.000Z'});
async function fixture(docx=false) {
  const data = await core.importSource({name:docx?'source.docx':'source.html', bytes:docx?new Uint8Array(await createDocxFixture()):new TextEncoder().encode('<p>当前内容</p>')});
  data.annotations = [{id:'a', kind:'element', comment:'修改当前内容', createdAt:data.createdAt, updatedAt:data.updatedAt,
    revision:4, target:{kind:'element', selector:'#new', tag:'p'}, targetHistory:[event(1), event(3)]}];
  return data;
}
const patchFor = data => ({format:'html-review-results', schemaVersion:1, batchId:'target-history-result', results:[{
  id:'a', revision:data.annotations[0].revision || 1, annotationUpdatedAt:data.annotations[0].updatedAt, status:'resolved', summary:'已修改当前目标', by:'agent'}]});

const invalidHistoryMutations = [
  a => a.targetHistory = null,
  a => a.targetHistory = Array.from({length:101}, (_,i)=>event(i+1)),
  a => a.targetHistory[0].revision = 0,
  a => a.targetHistory[0].revision = 1.5,
  a => a.targetHistory[0].revision = true,
  a => a.targetHistory[1].revision = 1,
  a => a.targetHistory[1].revision = 4,
  a => a.targetHistory.reverse(),
  a => a.targetHistory[0].target = {kind:'element', selector:'#old', tag:'<>p'},
  a => a.targetHistory[0].target.quote.exact = '',
  a => a.targetHistory[0].target.range = {start:{path:[-1], offset:0}, end:{path:[], offset:1}},
  a => a.targetHistory[0].target.rect = {width:-1},
  a => a.targetHistory[0].view = {width:'800'},
  a => a.targetHistory[0].view = null,
  a => a.targetHistory[0].at = 'invalid',
];

test('target history survives normalization, full/light validation and result application across target kinds', async () => {
  const data = await fixture(), before = clone(data.annotations[0].targetHistory);
  await core.validateData(data);
  assert.deepEqual(clone(core.normalizeAnnotation(data.annotations[0]).targetHistory), before);
  const light = core.createAnnotationExport(data); await core.validateAnnotationExport(light);
  assert.deepEqual(clone(light.annotations[0].targetHistory), before);
  const result = core.applyAgentResults(data, patchFor(data)); await core.validateData(result.data);
  assert.deepEqual(clone(result.data.annotations[0].targetHistory), before);
  assert.equal(result.data.annotations[0].target.selector, '#new');
  assert.match(core.createAgentTask(data), /targetHistory 仅记录之前的定位与版本/);
});

test('legacy records keep targetHistory optional', async () => {
  const data = await fixture(); delete data.annotations[0].targetHistory; delete data.annotations[0].revision;
  await core.validateData(data);
  assert.equal(core.createAnnotationExport(data).annotations[0].revision, 1);
  assert.equal('targetHistory' in core.normalizeAnnotation(data.annotations[0]), false);
  assert.equal('targetHistory' in core.applyAgentResults(data, patchFor(data)).data.annotations[0], false);
});

test('malformed target histories reject through stored/light validators and result merge', async () => {
  const good = await fixture();
  for (const mutate of invalidHistoryMutations) {
    const data = clone(good); mutate(data.annotations[0]);
    await assert.rejects(core.validateData(data));
    await assert.rejects(core.validateAnnotationExport(core.createAnnotationExport(data)));
    assert.throws(() => core.applyAgentResults(data, patchFor(data)));
  }
  const boundary = clone(good); boundary.annotations[0].revision = 101;
  boundary.annotations[0].targetHistory = Array.from({length:100}, (_,i)=>event(i+1));
  await core.validateData(boundary);
});

function docxMapping(hash) {
  return {adapterVersion:'1', sourceSha256:hash, blocks:[{id:'old', part:'word/document.xml', path:'/w:document[1]/w:body[1]/w:p[999]'}],
    start:{id:'old',offset:0}, end:{id:'old',offset:2}};
}
async function docxHistoryFixture() {
  const data = await fixture(true);
  data.annotations[0].target = {kind:'page', scope:'whole-document', docx:{adapterVersion:'1', sourceSha256:data.source.sha256, blocks:[]}};
  data.annotations[0].kind = 'page';
  for (const item of data.annotations[0].targetHistory) item.target.docx = docxMapping('a'.repeat(64));
  return data;
}

test('DOCX historical mappings retain old source hashes without requiring current paths or kind', async () => {
  const data = await docxHistoryFixture(); await core.validateData(data);
  await core.validateAnnotationExport(core.createAnnotationExport(data));
  assert.deepEqual(clone(core.applyAgentResults(data, patchFor(data)).data.annotations[0].targetHistory), data.annotations[0].targetHistory);
  assert.match(core.createAgentTask(data), /targetHistory 仅记录之前的定位与版本/);
  const malformed = clone(data); delete malformed.annotations[0].targetHistory[0].target.docx.start;
  await assert.rejects(core.validateData(malformed));
  const missing = clone(data); delete missing.annotations[0].targetHistory[0].target.docx;
  await assert.rejects(core.validateData(missing));
  assert.throws(() => core.applyAgentResults(missing, patchFor(data)));
});

test('Python validates target history and emits only revisions/kinds, preserving old DOCX source hashes', async t => {
  try { await runPython(['--version']); } catch { t.skip('Python is unavailable'); return; }
  const dir = await mkdtemp(path.join(tmpdir(), 'review-target-history-'));
  const inspector = fileURLToPath(new URL('../scripts/inspect_review.py', import.meta.url));
  try {
    for (const data of [await fixture(), await docxHistoryFixture()]) {
      const source = path.join(dir, data.source.name), review = path.join(dir,'review.json');
      await writeFile(source, Buffer.from(data.source.base64,'base64'));
      await writeFile(review, JSON.stringify(core.createAnnotationExport(data)));
      const {stdout} = await runPython([inspector,review,source], {encoding:'utf8'});
      assert.match(stdout, /targetHistorySummary/); assert.match(stdout, /"revision": 3/);
      assert.equal(stdout.includes(oldTarget.quote.exact), false);
      for (const mutate of invalidHistoryMutations) {
        const invalid = clone(data); mutate(invalid.annotations[0]);
        await writeFile(review, JSON.stringify(core.createAnnotationExport(invalid)));
        await assert.rejects(runPython([inspector,review,source], {encoding:'utf8'}));
      }
      const legacy = clone(data); delete legacy.annotations[0].targetHistory; delete legacy.annotations[0].revision;
      await writeFile(review, JSON.stringify(core.createAnnotationExport(legacy)));
      await runPython([inspector,review,source], {encoding:'utf8'});
    }
  } finally { await rm(dir, {recursive:true, force:true}); }
});
