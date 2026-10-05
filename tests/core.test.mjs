import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto, createHash} from 'node:crypto';

const context = {crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, URL, btoa, atob};
vm.runInNewContext(await readFile(new URL('../src/core.js', import.meta.url), 'utf8'), context);
const core = context.HRCore;
const encode = text => new TextEncoder().encode(text);
const source = () => core.importSource({name: 'page.html', path: 'pages/page.html', bytes: encode('<!doctype html>\r\n<title>中文 😀</title>\r\n<p>原文</p>'), lastModified: 123456789});
const clone = object => JSON.parse(JSON.stringify(object));

test('source byte identity survives CRLF, Unicode, BOM and repeated JSON round trips', async () => {
  const bytes = new Uint8Array([0xEF, 0xBB, 0xBF, ...encode('<!doctype html>\r\n<p>中文 😀</p>\r\n')]);
  const data = await core.importSource({name: '测试.html', bytes, lastModified: 1234});
  assert.equal(data.source.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(data.source.byteLength, bytes.length);
  assert.equal(data.source.lastModified, 1234);
  assert.equal(data.source.encoding, 'utf-8');
  assert.deepEqual(core.base64ToBytes(JSON.parse(core.serialize(data)).source.base64), bytes);
  assert.equal(await core.validateData(JSON.parse(core.serialize(JSON.parse(core.serialize(data))))).then(value => value.source.sha256), data.source.sha256);
});

test('SHA-256 covers ArrayBuffer views without hashing unused prefix/suffix bytes', async () => {
  const backing = encode('___abc___');
  assert.equal(await core.sha256(backing.subarray(3, 6)), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(await core.sha256(encode('').buffer), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('inert JSON serialization cannot close a script tag, including in annotation comments', async () => {
  const data = await source();
  const comment = '</ScRiPt><img src=x onerror=alert(1)> & 中文\u2028\u2029';
  data.annotations.push({id: 'x', kind: 'page', comment, createdAt: data.createdAt, updatedAt: data.updatedAt, target: {kind: 'page', text: '页'}});
  const serialized = core.serialize(data);
  assert.equal(serialized.includes('<'), false);
  assert.equal(serialized.includes('&'), false);
  assert.equal(JSON.parse(serialized).annotations[0].comment, comment);
  await core.validateData(JSON.parse(serialized));
});

test('encoding detection preserves original UTF-16 bytes and rejects undecodable data', () => {
  assert.deepEqual({...core.decodeBytes(new Uint8Array([255, 254, 65, 0, 45, 78]))}, {text: 'A中', encoding: 'utf-16le'});
  assert.deepEqual({...core.decodeBytes(new Uint8Array([254, 255, 0, 65, 78, 45]))}, {text: 'A中', encoding: 'utf-16be'});
  assert.throws(() => core.decodeBytes(new Uint8Array([0xC0, 0xAF])), /编码/);
  assert.throws(() => core.decodeBytes(encode('<meta charset="no-such-encoding">')), /不支持/);
  assert.equal(core.decodeBytes(new Uint8Array([...encode('<meta charset="windows-1252"><p>'), 0xE9])).text.endsWith('é'), true);
});

test('folder resources use stable normalized paths, hashes and inferred MIME types', async () => {
  const data = await core.importSource({name: 'page.html', path: 'nested/page.html', bytes: encode('<img src="../img/a.svg">')}, [
    {path: 'img/a.svg', bytes: encode('<svg/>')},
    {path: 'styles/a.css', bytes: encode('body{color:red}'), mime: 'application/octet-stream'},
    {path: 'nested/page.html', bytes: encode('ignored duplicate original')}
  ]);
  assert.equal(data.resources.length, 2);
  assert.equal(data.resources.find(item => item.path.endsWith('.css')).mime, 'text/css');
  assert.equal(data.resources.find(item => item.path.endsWith('.svg')).mime, 'image/svg+xml');
  await core.validateData(data);
  await assert.rejects(core.importSource({name: 'a.html', bytes: encode('x')}, [{path: 'img/a.svg', bytes: encode('a')}, {path: 'img/a.svg', bytes: encode('b')}]), /重复/);
});

test('path traversal and absolute filesystem paths cannot enter portable data', async () => {
  for (const path of ['../secret.txt', 'a/../../b', '/tmp/a', 'C:\\Users\\a', 'http://example.com/a', 'a//b', 'a/./b']) {
    assert.throws(() => core.normalizePath(path), /路径/);
  }
  assert.equal(core.normalizePath('pages\\我的页面.html'), 'pages/我的页面.html');
  await assert.rejects(core.importSource({name: 'x', bytes: encode('x')}, [{path: '../x', bytes: encode('x')}]), /路径/);
});

test('valid annotations of all three kinds survive export and validation', async () => {
  const data = await source();
  for (const kind of ['text', 'element', 'page']) data.annotations.push({id: kind, kind,
    comment: '把间距改成 24px', createdAt: data.createdAt, updatedAt: data.updatedAt,
    target: kind === 'page' ? {kind, text: '页面'} : {kind, selector: '#content', tag: 'p', quote: {exact: '原文', prefix: '', suffix: ''}, range: {start: {path: [1, 2], offset: 0}, end: {path: [1, 2], offset: 2}}},
    view: {width: 1280, height: 800}});
  const reopened = JSON.parse(core.serialize(data));
  await core.validateData(reopened);
  assert.equal(reopened.annotations.length, 3);
  const lightweight = JSON.parse(core.serialize(core.createAnnotationExport(data), true));
  assert.equal(lightweight.format, 'html-review-annotations');
  assert.equal(lightweight.source.base64, undefined);
  assert.equal(lightweight.source.sha256, data.source.sha256);
  assert.deepEqual(lightweight.annotations, clone(data.annotations));
  assert.equal(data.source.base64, core.bytesToBase64(encode('<!doctype html>\r\n<title>中文 😀</title>\r\n<p>原文</p>')));
});

test('corrupt bytes, schema and resource integrity are rejected before preview', async () => {
  const data = await core.importSource({name: 'x.html', bytes: encode('<p>source</p>')}, [{path: 'x.png', bytes: new Uint8Array([1, 2, 3])}]);
  const lightweight = core.createAnnotationExport(data);
  assert.equal(lightweight.resources[0].base64, undefined);
  assert.equal(lightweight.resources[0].sha256, data.resources[0].sha256);
  assert.equal(data.resources[0].base64, 'AQID');
  const cases = [
    [value => value.schemaVersion = 2, /格式版本/],
    [value => value.source.base64 = core.bytesToBase64(encode('<p>edited</p>')), /完整性/],
    [value => value.source.sha256 = '0'.repeat(64), /完整性/],
    [value => value.source.byteLength++, /完整性/],
    [value => value.source.encoding = 'windows-1252', /编码/],
    [value => value.resources[0].base64 = 'BAUG', /完整性/],
    [value => value.resources.push(clone(value.resources[0])), /重复/],
    [value => value.resources[0].mime = 'text/html;foo=<script>', /类型/],
    [value => value.updatedAt = 'bad-time', /时间/]
  ];
  for (const [mutate, expected] of cases) {
    const modified = clone(data); mutate(modified);
    await assert.rejects(core.validateData(modified), expected);
  }
});

test('invalid, duplicate and hostile annotation records are rejected', async () => {
  const data = await source();
  const annotation = {id: 'a', kind: 'text', comment: '修改意见', createdAt: data.createdAt, updatedAt: data.updatedAt, target: {kind: 'text', selector: '#content', quote: {exact: '原文'}}};
  const records = [
    [{...annotation, kind: 'unknown'}], [{...annotation, comment: '   '}],
    [{...annotation, target: null}], [{...annotation, updatedAt: 'invalid'}],
    [annotation, annotation], [{...annotation, target: JSON.parse('{"__proto__":{"polluted":true}}')}]
  ];
  for (const annotations of records) await assert.rejects(core.validateData({...clone(data), annotations}));
  const recursive = {kind: 'text'}; recursive.loop = recursive;
  await assert.rejects(core.validateData({...clone(data), annotations: [{...annotation, target: recursive}]}), /复杂/);
});

test('Base64 rejects noncanonical encodings and enforces decoded byte limits', () => {
  assert.deepEqual(core.base64ToBytes(''), new Uint8Array());
  for (const value of ['Zh==', 'Zg=', 'Zg==\n', '#$==', 'Zm9v=']) assert.throws(() => core.base64ToBytes(value), /Base64/);
  assert.throws(() => core.base64ToBytes('Zm9v', 2), /限制/);
  assert.equal(core.getSourceText({source: {base64: core.bytesToBase64(encode('a\r\nb😀'))}}), 'a\r\nb😀');
});

test('multi-megabyte resource encoding validates without a recursive regexp stack overflow', () => {
  const bytes = new Uint8Array(4 * 1024 * 1024);
  for (let offset = 0; offset < bytes.length; offset++) bytes[offset] = offset % 251;
  const decoded = core.base64ToBytes(core.bytesToBase64(bytes));
  assert.deepEqual(decoded, bytes);
});

test('target validation rejects malformed nested fields before UI rendering or locator execution', async () => {
  const good = {kind: 'text', selector: '#intro', text: '原文', quote: {exact: '原文', prefix: '', suffix: ''},
    range: {start: {path: [1, 0, 0], offset: 0}, end: {path: [1, 0, 0], offset: 2}},
    position: {start: 0, end: 2}, attributes: {id: 'intro'}};
  assert.equal(core.validateTarget(good, 'text'), good);
  assert.equal(core.validateTarget({kind: 'page', text: '布局反馈', scope: 'whole-document', context: {sourcePath: 'index.html'}, viewport: {width: 1280, height: 800}}).kind, 'page');
  const mutations = [
    target => target.quote.exact = 42,
    target => target.quote = [],
    target => target.text = {toString: null},
    target => target.attributes.alt = {},
    target => target.attributes = [],
    target => target.selector = null,
    target => target.kind = 'element',
    target => target.range.start.path = [-1],
    target => target.range.end.offset = -1,
    target => target.position.end = 0,
    target => target.viewport = {width: {}},
    target => target.rect = {x: NaN},
    target => target.context = {ancestor: {text: ['invalid']}},
    target => target.attributeFingerprints = {src: {length: 999, hash: 'not-a-hash'}}
  ];
  for (const mutate of mutations) {
    const target = clone(good); mutate(target);
    assert.throws(() => core.validateTarget(target, 'text'));
  }
  assert.throws(() => core.validateTarget({kind: 'element', selector: '#image', tag: 'img', attributes: {src: {}}}));
  const data = await source();
  data.annotations.push({id: 'a', kind: 'page', comment: '布局反馈', createdAt: data.createdAt, updatedAt: data.updatedAt,
    target: {kind: 'page', text: '页'}, view: {width: {toString: null}}});
  await assert.rejects(core.validateData(data), /视口/);
});

test('agent task preserves complete annotation context while excluding file and resource snapshots', async () => {
  const data = await source();
  data.resources = [{path: 'img/a.svg', mime: 'image/svg+xml', byteLength: 6, sha256: 'a'.repeat(64), base64: 'PHN2Zy8+'}];
  data.annotations = [{id: 'task-note', kind: 'text', comment: '替换句子；保留字面量 </script> 与 $&。', createdAt: data.createdAt, updatedAt: data.updatedAt,
    target: {kind: 'text', selector: '#copy', quote: {exact: '原文', prefix: '前文', suffix: '后文'}, context: {ancestor: {tag: 'section', id: 'chapter', text: '章节'}}, range: {start: {path: [1, 0], offset: 0}, end: {path: [1, 0], offset: 2}}}, view: {width: 390, height: 800}}];
  const task = core.createAgentTask(data);
  const payload = JSON.parse(task.slice(task.indexOf('{')));
  assert.deepEqual(payload.annotations, data.annotations);
  assert.equal(payload.source.sha256, data.source.sha256);
  assert.equal(payload.source.path, 'pages/page.html');
  assert.equal(payload.resources[0].path, 'img/a.svg');
  assert.equal('base64' in payload.source, false);
  assert.equal('base64' in payload.resources[0], false);
  assert(task.includes('校验原文件的 SHA-256'));
});

test('single-page scope requires bounded semantic page metadata and survives light export', async () => {
  const data = await source();
  const target = {kind:'page',scope:'page',pageIndex:2,pageCount:3,pageTitle:'第二页',selector:'#page-2',tag:'section',text:'第二页内容'};
  data.annotations.push({id:'single-page',kind:'page',comment:'只修改第二页',target,createdAt:data.createdAt,updatedAt:data.updatedAt});
  await core.validateData(data);
  assert.deepEqual(clone(core.createAnnotationExport(data).annotations[0].target),target);
  for (const invalid of [{pageIndex:0},{pageIndex:4},{pageCount:1001},{pageTitle:'x'.repeat(101)},{tag:''},{selector:undefined}]) {
    assert.throws(()=>core.validateTarget({...target,...invalid},'page'),/单页|JSON/);
  }
});
