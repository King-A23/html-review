import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import JSZip from 'jszip';

const context = {crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, URL, btoa, atob, JSZip};
for (const file of ['core', 'handoff']) vm.runInNewContext(await readFile(new URL('../src/' + file + '.js', import.meta.url), 'utf8'), context);
const core = context.HRCore;
const encode = text => new TextEncoder().encode(text);
const html = (path = '页面/中文.html', resources = []) => core.importSource({name: path.split('/').pop(), path, bytes: encode('\ufeff<!doctype html>\r\n<img src="../图片/图.png"><p>中文</p>')}, resources);
const create = data => context.HRHandoff.create(data, {type: 'uint8array'});

test('handoff contains byte-exact original and resources with lightweight metadata and concise task', async () => {
  const data = await html('页面/中文.html', [{path: '图片/图.png', bytes: new Uint8Array([0, 1, 255, 10]), mime: 'image/png'}, {path: 'review/TASK.md', bytes: encode('original resource'), mime: 'text/markdown'}, {path: 'README.md', bytes: encode('original readme'), mime: 'text/markdown'}]);
  const before = JSON.stringify(data);
  const result = await create(data);
  assert.equal(result.filename, '中文.agent-handoff.zip');
  const zip = await JSZip.loadAsync(result.bytes);
  assert.deepEqual(await zip.file(result.sourcePath).async('uint8array'), core.base64ToBytes(data.source.base64));
  assert.deepEqual(await zip.file('original/图片/图.png').async('uint8array'), new Uint8Array([0, 1, 255, 10]));
  assert.equal(await zip.file('original/review/TASK.md').async('string'), 'original resource');
  assert.equal(await zip.file('original/README.md').async('string'), 'original readme');
  const light = JSON.parse(await zip.file(result.annotationsPath).async('string'));
  assert.equal(light.source.path, data.source.path);
  assert.equal(light.source.base64, undefined);
  assert.ok(light.resources.every(resource => resource.base64 === undefined));
  assert.equal(light.format, 'html-review-annotations');
  await core.validateAnnotationExport(light);
  const task = await zip.file(result.taskPath).async('string');
  assert.ok(task.includes(result.sourcePath));
  assert.ok(task.includes(data.source.sha256));
  assert.ok(task.includes('html-review-results'));
  assert.ok(task.length < 3000);
  assert.equal(JSON.stringify(data), before, 'packaging does not mutate workspace');
  assert.ok(!Object.keys(zip.files).some(path => /index|preview|html-review\.html/.test(path)));
});

test('binary DOCX and PDF originals are never decoded or altered', async () => {
  for (const [name, bytes] of [['中文.docx', new Uint8Array([0x50, 0x4b, 0, 255, 128])], ['中文.pdf', encode('%PDF-1.7\r\n%\u00ff\u0000\r\n')]]) {
    const data = await core.importSource({name, bytes});
    const result = await create(data);
    const zip = await JSZip.loadAsync(result.bytes);
    assert.deepEqual(await zip.file(result.sourcePath).async('uint8array'), bytes);
    assert.ok((await zip.file(result.taskPath).async('string')).includes(name.endsWith('docx') ? 'OOXML' : '页面指纹'));
  }
});

test('unsafe paths cannot create traversal entries or ambiguous extracted files', async () => {
  for (const path of ['../page.html', '/page.html', 'C:/page.html', 'safe/../page.html', 'safe//page.html', 'bad\u0000.html', 'CON.html', 'safe/trailing./page.html', 'safe/question?.html']) {
    const data = await html();
    data.source.path = path;
    await assert.rejects(create(data));
  }
});

test('cross-platform filename and directory collisions reject without overwriting originals', async () => {
  for (const [path, resource] of [['page.html', 'PAGE.HTML'], ['é.html', 'e\u0301.html'], ['assets', 'assets/page.css']]) {
    const data = await html(path, [{path: resource, bytes: encode('resource'), mime: 'text/plain'}]);
    await assert.rejects(create(data), /冲突/);
  }
});

test('corrupt snapshots are rejected before producing a handoff', async () => {
  const data = await html();
  data.source.base64 = core.bytesToBase64(encode('tampered'));
  await assert.rejects(create(data), /完整性/);
});

test('download filename is safe even when source display name contains reserved or path characters', async () => {
  const data = await html();
  data.source.name = 'CON.docx';
  assert.equal((await create(data)).filename, '_CON.agent-handoff.zip');
  data.source.name = '../中文\\危?险.html';
  assert.equal((await create(data)).filename, '.._中文_危_险.agent-handoff.zip');
});
