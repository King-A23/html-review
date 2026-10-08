import {ensureBackup} from './backup-ui.mjs';
/* Real Chromium DOCX import, annotation, offline export and source-refresh acceptance. */
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdtemp, mkdir, rm, stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createDocxFixture} from './docx-fixtures.mjs';
import {runPython} from '../scripts/python.mjs';
import JSZip from 'jszip';
import {DOMParser} from '@xmldom/xmldom';
const root = fileURLToPath(new URL('../', import.meta.url));
let modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
if (modulePath && (await stat(modulePath)).isDirectory()) modulePath = path.join(modulePath, 'index.mjs');
const {chromium} = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const temp = await mkdtemp(path.join(os.tmpdir(), 'html-review-docx-'));
const contexts = []; let browser;
const source = path.join(temp, 'review.docx');
const changedSource = path.join(temp, 'changed', 'review.docx');
const invalidSource = path.join(temp, 'invalid', 'review.docx');
const wordNS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function resolveOOXML(xml, locator) {
  const document = new DOMParser().parseFromString(xml, 'application/xml'); let node = document;
  for (const step of locator.path.split('/').filter(Boolean)) {
    const match = /^w:([a-zA-Z]+)(?:\[(\d+)\])?$/.exec(step);
    assert(match, `Locator is not an explicit Word namespace path: ${locator.path}`);
    const children = Array.from(node.childNodes).filter(n => n.nodeType === 1 && n.namespaceURI === wordNS && n.localName === match[1]);
    node = children[Number(match[2] || 1) - 1]; assert(node, `Locator does not resolve in original OOXML: ${locator.path}`);
  }
  return node;
}
const ready = page => page.waitForFunction(() => !document.getElementById('open-button').disabled);
const frame = page => page.frameLocator('#preview-frame');
async function open(page, filename) { await page.locator('#file-input').setInputFiles(filename); await ready(page); }
async function download(page, format, filename) {
  await ensureBackup(page); await page.locator('#export-format').selectOption(format);
  const pending = page.waitForEvent('download'); await ensureBackup(page); await page.locator('#download-button').click();
  const output = path.join(temp, filename); await (await pending).saveAs(output); return output;
}
async function annotations(page, filename = 'review.json') { const output = await download(page, 'annotations', filename); return {output, data: JSON.parse(await readFile(output, 'utf8'))}; }
async function save(page, comment) { await page.locator('#comment-input').fill(comment); await page.locator('#save-button').click(); }
async function newPage(url = pathToFileURL(path.join(root, 'index.html')).href) {
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, acceptDownloads: true}); contexts.push(context);
  await context.addInitScript(() => { window.showOpenFilePicker = undefined; window.showDirectoryPicker = undefined; });
  const page = await context.newPage(); page.on('dialog', dialog => dialog.accept());
  await page.goto(url); await ready(page); return page;
}
async function newBlockedPickerPage() {
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, acceptDownloads: true}); contexts.push(context);
  await context.addInitScript(() => {
    window.showOpenFilePicker = async () => { throw new DOMException('blocked by this environment', 'SecurityError'); };
    window.showDirectoryPicker = async () => { throw new DOMException('blocked by this environment', 'SecurityError'); };
  });
  const page = await context.newPage(); page.on('dialog', dialog => dialog.accept());
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href); await ready(page); return page;
}
try {
  await Promise.all([mkdir(path.join(temp, 'changed')), mkdir(path.join(temp, 'invalid'))]);
  const base = await createDocxFixture();
  assert.deepEqual(base, await createDocxFixture(), 'DOCX fixture bytes must be reproducible');
  await Promise.all([writeFile(source, base), writeFile(changedSource, await createDocxFixture('changed')), writeFile(invalidSource, await createDocxFixture('invalid'))]);
  const zip = await JSZip.loadAsync(base); const originalXML = await zip.file('word/document.xml').async('string');
  assert.match(originalXML, /<w:tbl>/); assert.match(originalXML, /w:commentRangeStart/);
  browser = await chromium.launch({headless: true, ...(process.env.BROWSER_PATH ? {executablePath: process.env.BROWSER_PATH} : {})});
  const page = await newPage(); const requests = [];
  assert.doesNotMatch(await page.locator('#save-state').textContent(), /已(?:导出|请求下载|下载)/, 'An unopened workspace must not claim that a copy was exported');
  page.on('request', request => { if (/^https?:/i.test(request.url())) requests.push(request.url()); });
  assert.match(await page.locator('#open-button').textContent(), /打开文档/);
  assert.match(await page.locator('#file-input').getAttribute('accept'), /\.docx/); assert.match(await page.locator('#file-input').getAttribute('accept'), /\.json/);
  await open(page, source); await frame(page).locator('body').filter({hasText: '正文与定位'}).waitFor();
  assert.equal(await page.locator('[data-mode=page]').isVisible(), false);
  assert.equal(await frame(page).locator('h1').filter({hasText: '正文与定位'}).count(), 1);
  assert.equal(await frame(page).locator('h1').filter({hasText: 'DOCX 审阅测试 Review fixture'}).count(), 1, 'Word Title maps to a heading');
  assert.equal(await frame(page).locator('p').filter({hasText: '副标题 Subtitle mapping'}).count(), 1, 'Word Subtitle remains a paragraph');
  assert.equal(await frame(page).locator('p').filter({hasText: '图 1：图注 Caption mapping'}).count(), 1, 'Word Caption remains a paragraph');
  assert.equal(await frame(page).locator('p').filter({hasText: /^重复段落 Duplicate paragraph$/}).count(), 2);
  assert(await frame(page).locator('ol li').count() >= 2); assert(await frame(page).locator('ul li').count() >= 1);
  assert(await frame(page).locator('table table').count() >= 1);
  assert.equal(await frame(page).locator('td[colspan="2"]').count(), 1);
  const images = await frame(page).locator('img').evaluateAll(nodes => nodes.map(e => ({src:e.src, ready:e.complete && e.naturalWidth > 0})));
  assert(images.filter(image => image.src.startsWith('data:image/png')).length >= 2);
  assert(images.filter(image => image.src.startsWith('data:image/png')).every(image => image.ready));
  const bodyText = await frame(page).locator('body').textContent();
  assert.match(bodyText, /Footnote content/); assert.match(bodyText, /Endnote content/); assert.match(bodyText, /Inserted revision/);
  assert(!bodyText.includes('Deleted revision'));
  assert.equal(await frame(page).locator('a[href^="javascript:"]').count(), 0);
  const footnote = frame(page).locator('[data-html-review-owned] a[href^="#footnote-"]').first();
  assert.equal(await footnote.count(), 1, 'Footnote marker is tool-owned and cannot become an annotation target');
  const previewDocumentURL = await frame(page).locator('body').evaluate(() => location.href);
  await footnote.evaluate(link => {
    const target = document.getElementById(link.getAttribute('href').slice(1));
    const spacer = document.createElement('div'); spacer.setAttribute('data-html-review-owned', 'true'); spacer.style.height = '1800px';
    target.parentElement.insertBefore(spacer, target); window.scrollTo(0, 0);
  });
  await footnote.evaluate(link => link.click());
  const afterFootnote = await frame(page).locator('body').evaluate(() => ({url: location.href, scrollY: window.scrollY, scrollTop: document.scrollingElement.scrollTop, rootTop: document.documentElement.scrollTop, bodyTop: document.body.scrollTop, frameTop: document.getElementById('footnote-1').getBoundingClientRect().top}));
  assert.equal(afterFootnote.url, previewDocumentURL, 'A DOCX footnote click must not navigate out of the iframe document');
  assert(afterFootnote.scrollY > 0 || afterFootnote.scrollTop > 0 || afterFootnote.rootTop > 0 || afterFootnote.bodyTop > 0, 'Footnote click scrolls within the current preview document: ' + JSON.stringify(afterFootnote));
  const footnoteBack = frame(page).locator('a[href="#footnote-ref-1"]').first();
  assert.equal(await footnoteBack.count(), 1, 'Footnote includes a tool-owned return link');
  await footnoteBack.evaluate(link => link.click());
  const afterBack = await frame(page).locator('body').evaluate(() => ({url: location.href, scrollY: window.scrollY}));
  assert.equal(afterBack.url, previewDocumentURL, 'Footnote return must remain inside the current preview document');
  assert(afterBack.scrollY < afterFootnote.scrollY, 'Footnote return link scrolls back to its marker');
  console.log('PASS DOCX footnote navigation remains in the preview document');
  const sourceMap = await frame(page).locator('script[data-docx-map]').textContent();
  assert(sourceMap); const map = JSON.parse(sourceMap);
  const mapped = await frame(page).locator('[data-docx-id]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-docx-id')));
  assert(mapped.length > 10); assert(mapped.every(id => map[id]), 'Every mapped DOM block has an original OOXML locator');
  assert.match(sourceMap, /word\/document\.xml/); assert.match(sourceMap, /w:body/);
  for (const locator of Object.values(map)) {
    const part = await zip.file(locator.part).async('string'); resolveOOXML(part, locator);
  }
  const duplicate = frame(page).locator('p').filter({hasText: /^重复段落 Duplicate paragraph$/}).nth(1);
  await page.locator('[data-mode=element]').click(); await duplicate.click(); await save(page, '只修改第二个重复段落');
  await page.locator('[data-mode=text]').click();
  await frame(page).locator('p').filter({hasText: '中英混排'}).evaluate(paragraph => {
    const first = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT).nextNode(); const range = document.createRange(); range.setStart(first, 0); range.setEnd(first, 4);
    getSelection().removeAllRanges(); getSelection().addRange(range); paragraph.dispatchEvent(new MouseEvent('mouseup', {bubbles:true}));
  });
  await page.locator('#target-text').filter({hasText:'中英混排'}).waitFor(); await save(page, '调整这一段的文字');
  await page.locator('[data-mode=whole]').click(); await save(page, '统一全文风格');
  const first = await annotations(page);
  assert.equal(first.data.schemaVersion, 2); assert.equal(first.data.source.type, 'docx');
  assert.equal(first.data.annotations.length, 3);
  assert.equal(first.data.annotations[1].target.docx.start.offset, 0);
  assert.equal(first.data.annotations[1].target.docx.end.offset, 4);
  assert.equal(first.data.annotations[1].target.docx.start.id, first.data.annotations[1].target.docx.end.id);
  assert.match(JSON.stringify(first.data.annotations[0].target.docx), /w:p\[5\]/, 'Second identical paragraph maps to original fifth body paragraph');
  assert.equal(first.data.annotations[0].kind, 'element'); assert.equal(first.data.annotations[1].kind, 'text');
  for (const annotation of first.data.annotations.slice(0,2)) {
    assert(annotation.target.docx, 'A DOCX annotation must carry original OOXML locations');
    const locators = JSON.stringify(annotation.target.docx); assert.match(locators, /word\/document\.xml/); assert.match(locators, /w:p/);
    assert(!locators.includes('html/body'), 'Generated preview paths cannot substitute for OOXML paths');
  }
  assert(!('base64' in first.data.source));
  assert.deepEqual(first.data.resources || [], []);
  assert(!('docxMap' in first.data) && !('previewHTML' in first.data) && !('index' in first.data));
  const lightweight = await readFile(first.output, 'utf8');
  assert(!lightweight.includes('data:image')); assert(!lightweight.includes('data-docx-map')); assert(!lightweight.includes('previewHTML'));
  const exportedHTML = await download(page, 'html', 'review.full.html');
  const fullText = await readFile(exportedHTML, 'utf8');
  const embedded = JSON.parse(fullText.match(/<script id="html-review-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(embedded.schemaVersion, 2); assert.equal(embedded.source.type, 'docx');
  assert.deepEqual(Buffer.from(embedded.source.base64, 'base64'), base, 'Full export keeps exact original DOCX ZIP bytes');
  assert(!('previewHTML' in embedded.source)); assert(!('docxMap' in embedded.source));
  assert.deepEqual(embedded.resources || [], []);
  assert(!('docxMap' in embedded) && !('previewHTML' in embedded));
  const offline = await newPage(pathToFileURL(exportedHTML).href);
  await frame(offline).locator('body').filter({hasText: '正文与定位'}).waitFor(); assert.equal(await offline.locator('#annotation-count').textContent(), '3');
  const restored = await newPage(); await open(restored, first.output);
  await restored.locator('#pair-source').waitFor({state:'visible'});
  const pairCompatibleChooser = restored.waitForEvent('filechooser'); await restored.locator('#pair-compatible').click();
  await (await pairCompatibleChooser).setFiles(source); await ready(restored);
  await frame(restored).locator('body').filter({hasText:'正文与定位'}).waitFor();
  assert.equal(await restored.locator('#annotation-count').textContent(), '3');
  assert.deepEqual((await annotations(restored, 'paired.json')).data.annotations, first.data.annotations);
  const task = await restored.evaluate(data => window.HRCore.createAgentTask(data), embedded);
  assert.match(task, /DOCX|docx/); assert.match(task, /word\/document\.xml/); assert.match(task, /第二个重复段落/);
  assert.match(task, /只有原 DOCX 与以下批注也可以完成核对、修改和回报/);
  assert.match(task, /"format":"html-review-results","schemaVersion":1/);
  await restored.evaluate(() => Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{writeText:async()=>{throw new Error('clipboard blocked');}}}));
  await restored.locator('#handoff-button').click(); await restored.locator('#copy-agent-text').click(); await restored.locator('#agent-task-dialog').waitFor({state:'visible'});
  assert.match(await restored.locator('#agent-task-help').textContent(), /原始 DOCX/);
  assert.doesNotMatch(await restored.locator('#agent-task-help').textContent(), /原始 HTML/);
  assert.match(await restored.locator('#agent-task-text').inputValue(), /"annotationUpdatedAt":"对应批注 updatedAt"/);
  await restored.locator('[data-close="agent-task-dialog"]').click();
  console.log('PASS DOCX pairing compatibility and self-contained task');
  if (process.env.DOCX_ARTIFACT_DIR) {
    const artifacts = path.resolve(process.env.DOCX_ARTIFACT_DIR); await mkdir(artifacts, {recursive:true});
    await Promise.all([
      writeFile(path.join(artifacts, 'review.docx'), base),
      writeFile(path.join(artifacts, 'review.review.json'), await readFile(first.output)),
      writeFile(path.join(artifacts, 'review.review.html'), fullText),
      writeFile(path.join(artifacts, 'review.agent-task.txt'), task),
      writeFile(path.join(artifacts, 'review.source-map.json'), JSON.stringify(map, null, 2))
    ]);
    console.log(`DOCX acceptance artifacts saved to ${artifacts}`);
  }

  const resultsPath = path.join(temp, 'review.review-results.json');
  await runPython([path.join(root, 'scripts/update_review.py'), first.output, '--id', first.data.annotations[0].id, '--status', 'resolved', '--summary', '已更新第二段', '--output', resultsPath]);
  await restored.locator('#results-input').setInputFiles(resultsPath); await ready(restored);
  assert.equal(await restored.locator(`.annotation-card[data-annotation-id="${first.data.annotations[0].id}"]`).getAttribute('data-review-state'), 'completed');
  const feedbackPath = path.join(temp, 'review.pending-results.json');
  const feedbackSummary = '原生 Word 批注需确认：随段删除，还是移锚后保留？ <img src=x onerror="window.__feedbackExecuted=true">';
  await runPython([path.join(root, 'scripts/update_review.py'), first.output, '--id', first.data.annotations[0].id, '--status', 'open', '--summary', feedbackSummary, '--output', feedbackPath]);
  await restored.locator('#results-input').setInputFiles(feedbackPath); await ready(restored);
  const feedbackCard = restored.locator(`.annotation-card[data-annotation-id="${first.data.annotations[0].id}"]`);
  await feedbackCard.locator('.annotation-feedback').waitFor({state:'visible'});
  assert.equal(await feedbackCard.getAttribute('data-review-state'), 'pending');
  assert.equal(await feedbackCard.locator('.annotation-feedback').textContent(), '未完成说明' + feedbackSummary, 'Pending agent feedback is visible without expanding history');
  assert.equal(await feedbackCard.locator('.annotation-feedback img, .annotation-feedback script, .annotation-feedback svg').count(), 0, 'Agent feedback is rendered as text, never as markup');
  assert.equal(await restored.evaluate(() => window.__feedbackExecuted), undefined, 'Feedback text cannot execute code');
  await feedbackCard.locator('[data-action=edit]').click(); await restored.locator('#comment-input').fill('更新意见后需要重新处理'); await restored.locator('#save-button').click();
  assert.equal(await restored.locator(`.annotation-card[data-annotation-id="${first.data.annotations[0].id}"] .annotation-feedback`).count(), 0, 'Editing an annotation hides feedback from an older revision');
  console.log('PASS DOCX pending feedback is visible and safely cleared by an edit');
  await restored.locator('#comment-input').fill('保留这条未保存草稿');
  await restored.locator('#settings-button').click(); await restored.locator('#help-button').click();
  const compatibilityHelp=restored.locator('#help-dialog details.help-details').filter({has:restored.locator('#compatible-reload')});
  if (!await compatibilityHelp.evaluate(details => details.open)) await compatibilityHelp.locator('summary').click();
  assert.equal(await restored.locator('#compatible-reload').isDisabled(), false, 'A loaded non-example document exposes compatible reload');
  const reloadPicker = restored.waitForEvent('filechooser'); await restored.locator('#compatible-reload').click(); await (await reloadPicker).setFiles(changedSource); await ready(restored);
  await frame(restored).locator('body').filter({hasText:'Inserted paragraph'}).waitFor();
  assert.equal(await restored.locator('#annotation-count').textContent(), '3'); assert.equal(await restored.locator('#comment-input').inputValue(), '保留这条未保存草稿');
  const beforeFailure = await frame(restored).locator('body').textContent();
  const failedPicker = restored.waitForEvent('filechooser'); await restored.locator('#reload-preview').click(); await (await failedPicker).setFiles(invalidSource); await ready(restored);
  assert.equal(await frame(restored).locator('body').textContent(), beforeFailure); assert.equal(await restored.locator('#annotation-count').textContent(), '3');
  assert.equal(await restored.locator('#comment-input').inputValue(), '保留这条未保存草稿');
  const mappedPage = await newPage(); await open(mappedPage, source);
  await frame(mappedPage).locator('p').filter({hasText: /^重复段落 Duplicate paragraph$/}).nth(1).waitFor();
  await mappedPage.locator('[data-mode=text]').click();
  await frame(mappedPage).locator('body').evaluate(body => {
    const paragraphs = Array.from(body.querySelectorAll('p')).filter(p => p.textContent === '重复段落 Duplicate paragraph');
    const start = document.createTreeWalker(paragraphs[0], NodeFilter.SHOW_TEXT).nextNode();
    const end = document.createTreeWalker(paragraphs[1], NodeFilter.SHOW_TEXT).nextNode();
    const range = document.createRange(); range.setStart(start, 2); range.setEnd(end, 4);
    getSelection().removeAllRanges(); getSelection().addRange(range); paragraphs[1].dispatchEvent(new MouseEvent('mouseup', {bubbles:true}));
  });
  await mappedPage.locator('#target-preview').waitFor({state:'visible'}); await save(mappedPage, '核对跨段选区');
  await mappedPage.locator('[data-mode=element]').click(); await frame(mappedPage).locator('img[data-docx-id]').first().click(); await save(mappedPage, '替换第一幅图');
  const mappingExport = await annotations(mappedPage, 'mapping.json');
  assert(!(await readFile(mappingExport.output, 'utf8')).includes('data:image'), 'Image annotations must not put embedded PNG bytes into lightweight JSON');
  const extra = mappingExport.data;
  const cross = extra.annotations[0].target.docx;
  assert.equal(cross.blocks.length, 2); assert.equal(cross.start.offset, 2); assert.equal(cross.end.offset, 4);
  assert.notEqual(cross.start.id, cross.end.id);
  assert.match(cross.blocks[0].path, /w:p\[4\]/); assert.match(cross.blocks[1].path, /w:p\[5\]/);
  const imageBlock = extra.annotations[1].target.docx.blocks.find(block => block.image);
  assert.equal(imageBlock.part, 'word/document.xml'); assert.equal(imageBlock.image.relationshipId, 'rIdImage1');
  assert.equal(imageBlock.image.mediaPath, 'word/media/image1.png');
  assert.equal(imageBlock.image.sha256, await mappedPage.evaluate(async base64 => window.HRCore.sha256(window.HRCore.base64ToBytes(base64)), (await zip.file('word/media/image1.png').async('base64'))));
  const imageReload = mappedPage.waitForEvent('filechooser'); await mappedPage.locator('#reload-preview').click(); await (await imageReload).setFiles(changedSource); await ready(mappedPage);
  await frame(mappedPage).locator('body').filter({hasText:'Inserted paragraph'}).waitFor();
  await mappedPage.locator(`.annotation-card[data-annotation-id="${extra.annotations[1].id}"] [data-action=locate]`).click();
  await mappedPage.locator(`.annotation-card[data-annotation-id="${extra.annotations[1].id}"] .location-status.missing`).waitFor();
  const blockedPicker = await newBlockedPickerPage();
  await blockedPicker.locator('#open-button').click();
  await blockedPicker.locator('#status').filter({hasText:'此环境无法使用系统选择器'}).waitFor();
  const statusFallback = blockedPicker.locator('#status').getByRole('button', {name:'改用兼容文件选择'});
  const fallbackChooser = blockedPicker.waitForEvent('filechooser'); await statusFallback.click(); await fallbackChooser;
  await blockedPicker.locator('#settings-button').click(); await blockedPicker.locator('#help-button').click();
  const blockedCompatibilityHelp=blockedPicker.locator('#help-dialog details.help-details').filter({has:blockedPicker.locator('#compatible-reload')});
  if (!await blockedCompatibilityHelp.evaluate(details => details.open)) await blockedCompatibilityHelp.locator('summary').click();
  assert.equal(await blockedPicker.locator('#compatible-reload').isDisabled(), true, 'Compatible reload remains unavailable before a document is opened');
  const compatibleOpenChooser = blockedPicker.waitForEvent('filechooser'); await blockedPicker.locator('#compatible-open').click(); await compatibleOpenChooser;
  await blockedPicker.locator('#settings-button').click(); await blockedPicker.locator('#help-button').click();
  if (!await blockedCompatibilityHelp.evaluate(details => details.open)) await blockedCompatibilityHelp.locator('summary').click();
  const compatibleFolderChooser = blockedPicker.waitForEvent('filechooser'); await blockedPicker.locator('#compatible-folder').click(); await compatibleFolderChooser;
  console.log('PASS DOCX compatible open, folder and reload entry points');
  assert.deepEqual(requests, [], 'DOCX preview must never fetch external relationships or conversion services');
  console.log('PASS DOCX: deterministic fixture, Word styles and footnote navigation, original XML locations, pair compatibility, self-contained agent task, fallback chooser, task/results, refresh and failure preservation');
} finally {
  await Promise.allSettled(contexts.map(context => context.close())); await browser?.close(); await rm(temp, {recursive:true,force:true});
  console.log('PROCESS_CLEANUP_COMPLETE');
}
