/* IndexedDB session checks against Chromium over a real file:// page.
 * node tests/session.browser.mjs
 * Optional: PLAYWRIGHT_MODULE_PATH=/path/to/playwright (or its index.mjs/index.js)
 * Optional: BROWSER_PATH=/path/to/chromium-or-chrome
 * With no overrides, install Playwright and its Chromium browser locally.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

async function loadPlaywright() {
  const configured = process.env.PLAYWRIGHT_MODULE_PATH;
  if (!configured) return import('playwright');
  let modulePath = configured.startsWith('file:') ? fileURLToPath(configured) : path.resolve(configured);
  if ((await fs.stat(modulePath)).isDirectory()) modulePath = path.join(modulePath, 'index.mjs');
  const loaded = await import(pathToFileURL(modulePath).href);
  return loaded.chromium ? loaded : loaded.default;
}

const {chromium} = await loadPlaywright();

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sessionSource = await fs.readFile(path.join(root, 'src/session.js'), 'utf8');
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'html-review-session-'));
const pagePath = path.join(workspace, 'session.html');
const pageHTML = '<!doctype html><meta charset="utf-8"><title>session fixture</title><script>' +
  sessionSource.replace(/<\/script/gi, '<\\/script') + '</script>';
let browser;

try {
  await fs.writeFile(pagePath, pageHTML, 'utf8');
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_PATH ? {executablePath: process.env.BROWSER_PATH} : {})
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(pathToFileURL(pagePath).href);

  const result = await page.evaluate(async source => {
    const {HRSession} = window;
    const ensure = (condition, message) => { if (!condition) throw new Error(message); };
    ensure(HRSession && typeof HRSession.save === 'function', 'HRSession API is missing');
    ensure(Object.isFrozen(HRSession), 'HRSession API should be frozen');
    await new Promise((resolve, reject) => {
      const deletion = indexedDB.deleteDatabase('html-review-workspaces');
      deletion.onsuccess = resolve;
      deletion.onerror = () => reject(deletion.error);
      deletion.onblocked = () => reject(new Error('existing test connection blocked database cleanup'));
    });

    const base64 = 'QUJD'.repeat(1024 * 1024);
    const initial = {data: {source: {name: 'large.html', base64}}, draft: {text: 'draft'}, preferences: {sidebar: 'left'}};
    const saved = await HRSession.save('large-file', initial);
    ensure(saved.key === 'large-file', 'save did not retain its key');
    ensure(/^\d{4}-\d{2}-\d{2}T/.test(saved.savedAt), 'save did not attach savedAt');
    ensure(initial.savedAt === undefined, 'save mutated the caller record');
    const restored = await HRSession.load('large-file');
    ensure(restored.data.source.base64 === base64, 'large base64 was changed during storage');
    ensure(restored.draft.text === 'draft', 'draft was not restored');
    ensure(restored.preferences.sidebar === 'left', 'preferences were not restored');

    await Promise.all([
      HRSession.save('ordered', {revision: 1}),
      HRSession.save('ordered', {revision: 2}),
      HRSession.save('other-key', {revision: 7})
    ]);
    ensure((await HRSession.load('ordered')).revision === 2, 'same-key saves were not ordered');
    ensure((await HRSession.load('other-key')).revision === 7, 'independent key was not stored');

    let failure;
    try { await HRSession.save('failed-transaction', {unsupported: () => {}}); } catch (error) { failure = error; }
    ensure(failure && (failure.name === 'DataCloneError' || /clone/i.test(failure.message)), 'transaction failure was reported as success');
    ensure(await HRSession.load('failed-transaction') === null, 'failed transaction stored data');
    await HRSession.save('failed-transaction', {recovered: true});
    ensure((await HRSession.load('failed-transaction')).recovered === true, 'queue did not recover after a failure');

    await HRSession.remove('large-file');
    ensure(await HRSession.load('large-file') === null, 'remove did not clear the record');

    const firstWindow = {indexedDB};
    const secondWindow = {indexedDB};
    new Function('window', source)(firstWindow);
    new Function('window', source)(secondWindow);
    const firstSession = firstWindow.HRSession;
    const secondSession = secondWindow.HRSession;
    await firstSession.load('cross-window-clear');
    await secondSession.load('cross-window-clear');
    await secondSession.save('cross-window-clear', {owner: 'second'});
    await secondSession.remove('cross-window-clear');
    let stale;
    try { await firstSession.save('cross-window-clear', {owner: 'stale-first'}); } catch (error) { stale = error; }
    ensure(stale?.name === 'StaleSessionError', 'a stale session save revived a cleared record');
    ensure(await secondSession.load('cross-window-clear') === null, 'the tombstone was not read as an empty session');
    await firstSession.load('cross-window-clear');
    await firstSession.save('cross-window-clear', {owner: 'first-after-refresh'});
    ensure((await secondSession.load('cross-window-clear')).owner === 'first-after-refresh', 'a session could not save after explicitly refreshing its epoch');

    // The old save captures epoch 0 when its API is called. Its two preceding
    // same-key loads leave room for the other instance's remove transaction;
    // the second queued load then learns epoch 1 before the old save executes.
    // The old save must retain epoch 0 rather than borrowing that later value.
    await firstSession.load('queued-epoch');
    const firstQueuedLoad = firstSession.load('queued-epoch');
    const epochRefreshingLoad = firstSession.load('queued-epoch');
    const delayedOldSave = firstSession.save('queued-epoch', {owner: 'old-call'});
    const concurrentRemove = secondSession.remove('queued-epoch');
    await Promise.all([firstQueuedLoad, epochRefreshingLoad, concurrentRemove]);
    let delayedFailure;
    try { await delayedOldSave; } catch (error) { delayedFailure = error; }
    ensure(delayedFailure?.name === 'StaleSessionError', 'a queued old save inherited an epoch from a later load');
    await firstSession.save('queued-epoch', {owner: 'after-queued-refresh'});
    ensure((await secondSession.load('queued-epoch')).owner === 'after-queued-refresh', 'the queued load did not refresh the instance epoch');
    await firstSession.close();
    await secondSession.close();

    await HRSession.close();
    await HRSession.save('after-close', {reopened: true});
    ensure((await HRSession.load('after-close')).reopened === true, 'close did not permit a later reopen');
    await HRSession.close();
    return {base64Bytes: base64.length, savedAt: saved.savedAt};
  }, sessionSource);

  const unavailable = await page.evaluate(async source => {
    const fakeWindow = {};
    new Function('window', source)(fakeWindow);
    try {
      await fakeWindow.HRSession.save('disabled', {value: true});
      return null;
    } catch (error) {
      return {name: error.name, message: error.message};
    }
  }, sessionSource);
  assert.equal(unavailable.name, 'IndexedDBUnavailableError');
  assert.match(unavailable.message, /IndexedDB/);
  console.log(`PASS: file:// IndexedDB stores and restores ${result.base64Bytes.toLocaleString()} bytes of base64 without loss`);
  console.log('PASS: same-key writes remain ordered; tombstones block stale cross-window saves; remove, close/reopen, unavailable storage, and failed transactions reject correctly');
} finally {
  try {
    await browser?.close();
  } finally {
    await fs.rm(workspace, {recursive: true, force: true});
  }
}
