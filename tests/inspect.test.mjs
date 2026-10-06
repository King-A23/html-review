import {runPython} from '../scripts/python.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const inspector = path.join(root, 'scripts/inspect_review.py');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const inspect = (...args) => runPython([inspector, ...args], {encoding: 'utf8'});

async function requirePython(t) {
  try { await runPython(['--version']); }
  catch (_) { t.skip('Python 3.8+ is unavailable; inspect_review.py tests are skipped.'); return false; }
  return true;
}

function fixture(sourceBytes) {
  const resource = Buffer.from('binary resource snapshot');
  return {
    format: 'html-review', schemaVersion: 1,
    source: {name: 'source.html', path: 'pages/source.html', byteLength: sourceBytes.length, lastModified: 123,
      sha256: digest(sourceBytes), encoding: 'utf-8', base64: sourceBytes.toString('base64')},
    resources: [{path: 'assets/a.bin', mime: 'application/octet-stream', sha256: digest(resource), base64: resource.toString('base64')}],
    annotations: [{id: 'page-note', kind: 'page', comment: '统一标题层级。', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', target: {kind: 'page', scope: 'whole-document', text: 'source.html'}}]
  };
}

function lightCopy(data) {
  const result = structuredClone(data);
  result.format = 'html-review-annotations';
  delete result.source.base64;
  for (const resource of result.resources) delete resource.base64;
  return result;
}

test('inspect_review accepts full HTML, gzip HTML and lightweight JSON without printing snapshots', async t => {
  if (!await requirePython(t)) return;
  const dir = await mkdtemp(path.join(tmpdir(), 'html-review-inspect-'));
  try {
    const sourceBytes = Buffer.from('<!doctype html><p>私密原文</p>');
    const source = path.join(dir, 'source.html');
    const data = fixture(sourceBytes);
    const html = `<script id="html-review-data" type="application/json">${JSON.stringify(data)}</script>`;
    const full = path.join(dir, 'source.review.html');
    const zipped = path.join(dir, 'source.review.html.gz');
    const light = path.join(dir, 'source.review.json');
    await Promise.all([
      writeFile(source, sourceBytes), writeFile(full, html), writeFile(zipped, gzipSync(html)), writeFile(light, JSON.stringify(lightCopy(data)))
    ]);
    for (const [file, expectedKind] of [[full, '完整批注副本'], [zipped, '完整批注副本（gzip）'], [light, '轻量批注 JSON']]) {
      const {stdout} = await inspect(file, source);
      assert.match(stdout, new RegExp('输入类型：\\s*' + expectedKind.replace(/[（）]/g, '\\$&')));
      assert.match(stdout, /批注数量：\s*1/);
      assert.match(stdout, /统一标题层级/);
      assert.equal(stdout.includes(data.source.base64), false);
      assert.equal(stdout.includes(data.resources[0].base64), false);
    }
  } finally { await rm(dir, {recursive: true, force: true}); }
});

test('inspect_review reports version mismatch and rejects a corrupt embedded snapshot', async t => {
  if (!await requirePython(t)) return;
  const dir = await mkdtemp(path.join(tmpdir(), 'html-review-inspect-'));
  try {
    const sourceBytes = Buffer.from('<p>original</p>');
    const source = path.join(dir, 'source.html');
    const data = fixture(sourceBytes);
    const light = path.join(dir, 'source.review.json');
    const corrupt = path.join(dir, 'corrupt.review.html');
    await writeFile(source, Buffer.from('<p>changed</p>'));
    await writeFile(light, JSON.stringify(lightCopy(data)));
    await assert.rejects(inspect(light, source), error => error.code === 2 && /版本不一致/.test(error.stderr));
    data.source.base64 = Buffer.from('<p>tampered</p>').toString('base64');
    await writeFile(corrupt, `<script id="html-review-data" type="application/json">${JSON.stringify(data)}</script>`);
    await assert.rejects(inspect(corrupt, source), error => error.code === 1 && /快照 SHA-256 不一致/.test(error.stderr));
  } finally { await rm(dir, {recursive: true, force: true}); }
});
