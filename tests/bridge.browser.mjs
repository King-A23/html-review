/* Standalone iframe bridge checks; no HTTP server required.
 * node tests/bridge.browser.mjs
 * Optional: PLAYWRIGHT_MODULE_PATH=/path/to/playwright (or its index.mjs)
 * Optional: BROWSER_PATH=/path/to/chromium-or-edge
 * With no overrides, install Playwright and its Chromium browser locally.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function loadPlaywright() {
  const configured = process.env.PLAYWRIGHT_MODULE_PATH;
  if (!configured) return import('playwright');
  let modulePath = configured.startsWith('file:') ? fileURLToPath(configured) : path.resolve(configured);
  if ((await fs.stat(modulePath)).isDirectory()) modulePath = path.join(modulePath, 'index.mjs');
  return import(pathToFileURL(modulePath).href);
}

const { chromium } = await loadPlaywright();
const mockWindow = {};
const source = await fs.readFile(new URL('../src/bridge.js', import.meta.url), 'utf8');
new Function('window', source)(mockWindow);
const bridge = '(' + mockWindow.HRBridge.toString() + ')("qa")';
const fixture = '<!doctype html><html><head><base href="https://example.com/folder/"></head>' +
  '<body><main><section id="card"><p id="mixed">Alpha <strong>bold</strong> end.</p>' +
  '<p class="dup">Repeated quote</p><p class="dup">Repeated quote</p>' +
  '<button id="action" onclick="this.dataset.count=Number(this.dataset.count||0)+1">Test action</button>' +
  '<a id="jump" href="#bottom">Jump</a><a id="leave" href="other.html">Leave</a>' +
  '<div style="height:1400px"></div><h2 id="bottom">Bottom</h2></section></main>' +
  '<script data-html-review-owned="bridge">' + bridge + '</script></body></html>';
const results = [];
let browser;
let page;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {})
  });
  page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<iframe sandbox="allow-scripts" style="width:900px;height:600px"></iframe>');
  await page.evaluate(html => {
    window.messages = [];
    addEventListener('message', event => {
      if (event.data && event.data.hr) window.messages.push(event.data);
    });
    document.querySelector('iframe').srcdoc = html;
  }, fixture);
  await page.waitForFunction(() => window.messages.some(message => message.event === 'ready'));
  const frame = page.frames().find(candidate => candidate !== page.mainFrame());
  const initialFrameUrl = frame.url();
  const command = payload => page.evaluate(payload => {
    document.querySelector('iframe').contentWindow.postMessage({ hr: true, channel: 'qa', ...payload }, '*');
  }, payload);
  async function waitEvent(event, requestId, targetId) {
    const match = { event, requestId, targetId };
    await page.waitForFunction(({ event, requestId, targetId }) => window.messages.some(message =>
      message.event === event && (!requestId || message.requestId === requestId) &&
      (!targetId || message.target?.id === targetId)), match);
    return page.evaluate(({ event, requestId, targetId }) => window.messages.filter(message =>
      message.event === event && (!requestId || message.requestId === requestId) &&
      (!targetId || message.target?.id === targetId)).at(-1), match);
  }
  async function locate(target, requestId, expectedStatus) {
    await command({ command: 'locate', target, requestId });
    const result = await waitEvent('located', requestId);
    assert.equal(result.status, expectedStatus, requestId + ': ' + result.reason);
  }

  await command({ command: 'set-mode', mode: 'text' });
  await frame.evaluate(() => {
    const paragraph = document.querySelector('#mixed');
    const range = document.createRange();
    range.setStart(paragraph.firstChild, 0);
    range.setEnd(paragraph.lastChild, 5);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  const textTarget = (await waitEvent('target', undefined, 'mixed')).target;
  assert.equal(textTarget.text, 'Alpha bold end.');
  assert.equal(textTarget.quote.exact, textTarget.text);
  assert.equal(textTarget.position.end - textTarget.position.start, textTarget.text.length);
  results.push('text selection across inline tags preserves exact text, range and offsets');
  await locate(textTarget, 'text-exact', 'exact');
  await frame.evaluate(() => { document.querySelector('#mixed').innerHTML = '<span>Alpha bold end.</span>'; });
  await locate(textTarget, 'text-dom-drift', 'fallback');
  results.push('verified text location and DOM-drift offset fallback');
  await locate({ kind: 'text', text: 'Repeated quote', quote: { exact: 'Repeated quote' } }, 'duplicate', 'ambiguous');
  await locate({ kind: 'text', text: 'gone', quote: { exact: 'gone' } }, 'missing', 'missing');
  results.push('duplicate quote is ambiguous; missing quote is unresolved');

  await command({ command: 'set-mode', mode: 'browse' });
  await frame.locator('#action').click();
  assert.equal(await frame.locator('#action').getAttribute('data-count'), '1');
  await command({ command: 'set-mode', mode: 'element' });
  await frame.locator('#action').click();
  const elementTarget = (await waitEvent('target', undefined, 'action')).target;
  assert.equal(elementTarget.kind, 'element');
  assert.equal(await frame.locator('#action').getAttribute('data-count'), '1');
  results.push('browse permits button scripts; element selection suppresses click');
  await locate(elementTarget, 'element-exact', 'exact');
  await frame.locator('#action').evaluate(element => { element.textContent = 'Different action'; });
  await locate(elementTarget, 'element-changed', 'missing');
  results.push('element verifies content and rejects changed content');
  await command({ command: 'parent-target' });
  assert.equal((await waitEvent('target', undefined, 'card')).target.tag, 'section');
  results.push('parent-target selects surrounding layout section');

  await frame.evaluate(() => {
    const image = document.createElement('img');
    image.id = 'image';
    image.width = 80;
    image.height = 30;
    const rendered = 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="30"><rect width="80" height="30" fill="blue"/></svg>');
    let hash = 2166136261;
    for (let index = 0; index < rendered.length; index++) hash = Math.imul(hash ^ rendered.charCodeAt(index), 16777619);
    image.src = rendered;
    image.alt = 'A'.repeat(260000);
    image.setAttribute('data-html-review-original-attrs', JSON.stringify({ src: {
      value: 'assets/demo.svg', renderedLength: rendered.length,
      renderedFingerprint: (hash >>> 0).toString(16).padStart(8, '0')
    } }));
    document.querySelector('#card').prepend(image);
  });
  await frame.locator('#image').click();
  const imageTarget = (await waitEvent('target', undefined, 'image')).target;
  assert.equal(imageTarget.attributes.src, 'assets/demo.svg');
  assert.equal(imageTarget.attributeFingerprints.alt.length, 260000);
  assert.ok(imageTarget.attributes.alt.length < 4100);
  await locate(imageTarget, 'image-exact', 'exact');
  await frame.locator('#image').evaluate(element => { element.src += '%20'; });
  await locate(imageTarget, 'image-changed', 'missing');
  results.push('original resource path retained; large attribute bounded; dynamic src drift rejected');

  await command({ command: 'set-mode', mode: 'browse' });
  await frame.locator('#jump').click();
  assert.ok(await frame.evaluate(() => scrollY) > 500);
  assert.equal(frame.url(), initialFrameUrl);
  await frame.locator('#leave').click();
  await waitEvent('warning');
  assert.equal(frame.url(), initialFrameUrl);
  results.push('fragment anchors work with base URL; nonhash navigation warns and stays in preview');

  await page.evaluate(() => document.querySelector('iframe').contentWindow.postMessage({
    hr: true, channel: 'wrong', command: 'locate', target: { kind: 'page' }, requestId: 'bad-channel'
  }, '*'));
  await frame.evaluate(() => window.postMessage({
    hr: true, channel: 'qa', command: 'locate', target: { kind: 'page' }, requestId: 'bad-source'
  }, '*'));
  // The valid reply is also a queue barrier for the two rejected messages.
  await locate({ kind: 'page' }, 'good-message', 'exact');
  assert.ok(!await page.evaluate(() => window.messages.some(message =>
    message.requestId === 'bad-channel' || message.requestId === 'bad-source')));
  assert.deepEqual(errors, []);
  results.push('channel and source guards; no page errors');
  console.log(JSON.stringify({ status: 'PASS', results, errors }, null, 2));
} catch (error) {
  if (page && !page.isClosed()) {
    const output = new URL('../test-results/', import.meta.url);
    await fs.mkdir(output, { recursive: true });
    await page.screenshot({ path: fileURLToPath(new URL('bridge-failure.png', output)), fullPage: true }).catch(() => {});
  }
  throw error;
} finally {
  if (browser) await browser.close();
  console.log('PROCESS_CLEANUP_COMPLETE');
}
