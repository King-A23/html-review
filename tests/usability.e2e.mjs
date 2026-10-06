/* High-priority usability acceptance checks. Run after `npm run build`.
 * Uses real file:// pages, IndexedDB and the sandboxed preview iframe.
 */
import assert from 'node:assert/strict';
import {mkdir, readFile, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const resultDir = path.join(root, 'test-results');
const appUrl = pathToFileURL(path.join(root, 'index.html')).href;
const financePath = path.join(root, 'examples/finance/index.html');
const financeBytes = await readFile(financePath);
const nativeUndo = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
await mkdir(resultDir, {recursive: true});

let modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
if (modulePath && (await stat(modulePath)).isDirectory()) modulePath = path.join(modulePath, 'index.mjs');
const {chromium} = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const checks = [];
const errors = [];
let browser;
let browserVersion = null;
let processCleanupComplete = false;

async function check(name, task) {
  await task();
  checks.push(name);
  console.log(`PASS ${name}`);
}

async function newPage(initScript) {
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, acceptDownloads: true});
  if (initScript) await context.addInitScript(initScript);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(appUrl);
  return {context, page};
}

async function frameFor(page) {
  await page.locator('#preview-frame').waitFor({state: 'visible'});
  const frame = await page.locator('#preview-frame').contentFrame();
  await frame.locator('body').waitFor();
  await page.waitForFunction(() => !document.querySelector('#open-button').disabled);
  return frame;
}

async function waitAutosaved(page) {
  await page.locator('#autosave-state').filter({hasText: '本机已保存'}).waitFor({state: 'visible'});
}

async function dismissGuide(page) {
  if (await page.locator('#onboarding-card').isVisible()) await page.locator('#onboarding-dismiss').click();
}

async function openFinance(page) {
  await dismissGuide(page);
  await page.locator('#file-input').setInputFiles(financePath);
  const frame = await frameFor(page);
  await frame.locator('#report-title').waitFor();
  return frame;
}

async function openFile(page, filename) {
  await dismissGuide(page);
  await page.locator('#file-input').setInputFiles(filename);
  return frameFor(page);
}

async function selectText(page, selector) {
  await page.locator('[data-mode="text"]').click();
  const frame = await frameFor(page);
  await frame.locator(selector).scrollIntoViewIfNeeded();
  await frame.locator(selector).evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
  });
  await page.locator('#target-preview').waitFor({state: 'visible'});
}

async function saveAnnotation(page, comment) {
  await page.locator('#comment-input').fill(comment);
  await page.locator('#save-button').click();
  await waitAutosaved(page);
}

async function dropHTML(target, name = 'finance-drop.html', bytes = financeBytes) {
  const base64 = Buffer.from(bytes).toString('base64');
  const payload = {name, base64};
  if (typeof target.evaluate === 'function') await target.evaluate(value => {
    const binary = atob(value.base64);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], value.name, {type: 'text/html'}));
    const destination = document.querySelector('#drop-overlay') || document;
    for (const type of ['dragenter', 'dragover', 'drop']) {
      destination.dispatchEvent(new DragEvent(type, {bubbles: true, cancelable: true, dataTransfer: transfer}));
    }
  }, payload);
  else await target.locator('html').evaluate((html, value) => {
    const binary = atob(value.base64);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], value.name, {type: 'text/html'}));
    const destination = html.ownerDocument.querySelector('#drop-overlay') || html.ownerDocument;
    for (const type of ['dragenter', 'dragover', 'drop']) {
      destination.dispatchEvent(new DragEvent(type, {bubbles: true, cancelable: true, dataTransfer: transfer}));
    }
  }, payload);
}

async function annotationCount(page) {
  return Number(await page.locator('#annotation-count').textContent());
}

try {
  browser = await chromium.launch({headless: true, ...(process.env.BROWSER_PATH ? {executablePath: process.env.BROWSER_PATH} : {})});
  browserVersion = await browser.version();

  await check('first-run guide describes the three steps, restarts from help, and sample provides three usable targets', async () => {
    const {context, page} = await newPage();
    try {
      await page.locator('#onboarding-card').waitFor({state: 'visible'});
      for (const step of ['open', 'annotate', 'deliver']) assert(await page.locator(`[data-guide-step="${step}"]`).isVisible());
      await page.locator('#onboarding-dismiss').click();
      await page.reload();
      assert.equal(await page.locator('#onboarding-card').isVisible(), false);
      await page.locator('#settings-button').click();
      await page.locator('#help-button').click();
      await page.locator('#restart-guide').click();
      await page.locator('#onboarding-card').waitFor({state: 'visible'});
      await page.locator('#onboarding-dismiss').click();
      await page.locator('#example-button').click();
      await frameFor(page);
      assert.equal(await annotationCount(page), 3);
      assert.deepEqual(await page.locator('.annotation-card .tag').allTextContents(), ['文字', '元素', '整体']);
      for (const card of await page.locator('.annotation-card').all()) {
        await card.locator('[data-action="locate"]').click();
        await card.locator('.location-status.exact').waitFor();
      }
    } finally { await context.close(); }
  });

  await check('dropping an HTML file works on the app and preview iframe, while an invalid drop preserves the existing workspace', async () => {
    const {context, page} = await newPage();
    try {
      await dismissGuide(page);
      await dropHTML(page);
      const frame = await frameFor(page);
      assert.equal(await page.locator('#source-name').textContent(), 'finance-drop.html');
      assert.equal(await frame.locator('#report-title').textContent(), '澄明增长组合季度跟踪报告');
      await selectText(page, '#cross-line-copy');
      await page.locator('#comment-input').fill('拖入后的草稿必须被保留。');
      const priorTarget = await page.locator('#target-text').textContent();
      await page.evaluate(() => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(['not html'], 'note.txt', {type: 'text/plain'}));
        document.querySelector('#drop-overlay').dispatchEvent(new DragEvent('drop', {bubbles: true, cancelable: true, dataTransfer: transfer}));
      });
      assert.equal(await page.locator('#source-name').textContent(), 'finance-drop.html');
      assert.equal(await page.locator('#comment-input').inputValue(), '拖入后的草稿必须被保留。');
      assert.equal(await page.locator('#target-text').textContent(), priorTarget);
      await page.evaluate(() => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(['a'], 'first.html', {type: 'text/html'}));
        transfer.items.add(new File(['b'], 'second.html', {type: 'text/html'}));
        document.querySelector('#drop-overlay').dispatchEvent(new DragEvent('drop', {bubbles: true, cancelable: true, dataTransfer: transfer}));
      });
      assert.equal(await page.locator('#source-name').textContent(), 'finance-drop.html');
      page.removeAllListeners('dialog');
      page.once('dialog', dialog => dialog.dismiss());
      await dropHTML(page, 'discard-cancelled.html');
      await page.waitForTimeout(100);
      assert.equal(await page.locator('#source-name').textContent(), 'finance-drop.html');
      assert.equal(await page.locator('#comment-input').inputValue(), '拖入后的草稿必须被保留。');
      page.on('dialog', dialog => dialog.accept());
      await dropHTML(frame, 'finance-frame-drop.html');
      await page.locator('#source-name').filter({hasText: 'finance-frame-drop.html'}).waitFor();
      await frameFor(page);
    } finally { await context.close(); }
  });

  await check('finance fixture supports cross-node text, duplicate text, SVG, image, table, parent and whole-document annotations', async () => {
    const {context, page} = await newPage();
    try {
      const frame = await openFinance(page);
      await selectText(page, '#cross-line-copy');
      assert.match(await page.locator('#target-text').textContent(), /有质量的现金流/);
      await saveAnnotation(page, '跨节点文案应突出长期假设。');

      await selectText(page, '#duplicate-copy-a');
      await saveAnnotation(page, '重复文案的第一个位置需要更具体的结论。');

      await page.locator('[data-mode="element"]').click();
      await frame.locator('#performance-chart').click();
      await page.locator('#target-preview').waitFor({state: 'visible'});
      await saveAnnotation(page, '图表的图例与期末收益应增加口径说明。');

      await page.locator('[data-mode="element"]').click();
      await frame.locator('#market-image').click();
      await saveAnnotation(page, '首图应补充图像来源和替代文本。');

      await page.locator('[data-mode="element"]').click();
      await frame.locator('#research-image').click();
      await saveAnnotation(page, '研究卡片中的第二张图片应说明其代表的主题。');

      await page.locator('[data-mode="element"]').click();
      await frame.locator('#kpi-return .kpi-icon').click();
      await saveAnnotation(page, '收益率卡片的趋势图标应补充无障碍标签。');

      await page.locator('[data-mode="element"]').click();
      await frame.locator('#market-image').click();
      await page.locator('#target-selector').filter({hasText: /^#market-image$/}).waitFor();
      await page.locator('#parent-target').click();
      await page.locator('#target-selector').filter({hasText: /figure|hero-visual/i}).waitFor();
      assert.match(await page.locator('#target-selector').textContent(), /figure|hero-visual/i);
      await saveAnnotation(page, '图片和图注应提供更清楚的来源说明。');

      await page.locator('[data-mode="element"]').click();
      await frame.locator('#holding-b').click();
      await saveAnnotation(page, '表格中的现金流验证状态需要进一步解释。');

      await page.getByText('整体', {exact: true}).first().click();
      await saveAnnotation(page, '全页的风险提示应始终在主要结论附近可见。');
      assert.equal(await annotationCount(page), 9);
      const cards = await page.locator('.annotation-card').all();
      for (const card of cards) {
        await card.locator('[data-action="locate"]').click();
        await card.locator('.location-status.exact').waitFor();
      }
      await page.screenshot({path: path.join(resultDir, 'usability-finance-left.png'), fullPage: true});
      await page.locator('#sidebar-position').selectOption('right');
      await page.screenshot({path: path.join(resultDir, 'usability-finance-right.png'), fullPage: true});
      await page.setViewportSize({width: 600, height: 900});
      await page.screenshot({path: path.join(resultDir, 'usability-finance-narrow.png'), fullPage: true});
    } finally { await context.close(); }
  });

  await check('autosave restores same-tab drafts, offers recovery in a new tab, and never replaces a deliberately imported source', async () => {
    const {context, page} = await newPage();
    try {
      await openFinance(page);
      await saveAnnotation(page, '已保存的整体意见。');
      await selectText(page, '#cross-line-copy');
      await page.locator('#comment-input').fill('刷新后必须恢复的文字草稿。');
      await waitAutosaved(page);
      await page.reload();
      await frameFor(page);
      assert.equal(await page.locator('#recovery-banner').isVisible(), false, 'same-tab refresh restores from the resume marker without a prompt');
      assert.equal(await annotationCount(page), 1);
      assert.equal(await page.locator('#comment-input').inputValue(), '刷新后必须恢复的文字草稿。');
      assert.equal(await page.locator('#target-kind').textContent(), '文字');
      await page.screenshot({path: path.join(resultDir, 'usability-recovered-draft.png'), fullPage: true});
      const downloads = [];
      page.on('download', download => downloads.push(download));
      await page.locator('#download-button').click();
      await page.waitForTimeout(150);
      assert.equal(downloads.length, 0, 'a pending draft must block export instead of silently omitting it');
      await page.locator('#save-button').click();
      await waitAutosaved(page);
      const pending = page.waitForEvent('download');
      await page.locator('#download-button').click();
      const download = await pending;
      assert.equal(download.suggestedFilename(), 'index.review.html');
      await waitAutosaved(page);

      const recoverable = await context.newPage();
      recoverable.on('dialog', dialog => dialog.accept());
      await recoverable.goto(appUrl);
      await recoverable.locator('#recovery-banner').waitFor({state: 'visible'});
      await recoverable.locator('#recover-session').click();
      await frameFor(recoverable);
      assert.equal(await recoverable.locator('#source-name').textContent(), 'index.html');

      const imported = await context.newPage();
      imported.on('dialog', dialog => dialog.accept());
      await imported.goto(appUrl);
      await imported.locator('#recovery-banner').waitFor({state: 'visible'});
      await openFile(imported, path.join(root, 'examples/demo.html'));
      assert.equal(await imported.locator('#source-name').textContent(), 'demo.html');
      assert.equal(await imported.locator('#recovery-banner').isVisible(), false);
      await imported.locator('#clear-recovery').click();
      await imported.locator('#autosave-state').filter({hasText: '恢复记录已清除'}).waitFor({state: 'visible'});
      const cleared = await context.newPage();
      await cleared.goto(appUrl);
      await cleared.waitForTimeout(250);
      assert.equal(await cleared.locator('#recovery-banner').isVisible(), false, 'clearing must not immediately recreate a recovery session');
    } finally { await context.close(); }
  });

  await check('delete history is undoable and redoable, and agent task copying never includes snapshots or unsaved drafts', async () => {
    const {context, page} = await newPage();
    try {
      await openFinance(page);
      await saveAnnotation(page, '用于撤销和 agent 任务的整体意见。');
      const initialCard = page.locator('.annotation-card').first();
      const annotationId = await initialCard.getAttribute('data-annotation-id');
      await initialCard.locator('[data-action="edit"]').click();
      await page.locator('#comment-input').fill('更新后的整体意见。');
      await page.locator('#save-button').click();
      assert.equal(await page.locator('.annotation-card').first().getAttribute('data-annotation-id'), annotationId);
      assert.match(await page.locator('.annotation-card').first().locator('.annotation-comment').textContent(), /更新后/);
      await page.keyboard.press('Control+z');
      assert.equal(await page.locator('.annotation-card').first().getAttribute('data-annotation-id'), annotationId);
      assert.match(await page.locator('.annotation-card').first().locator('.annotation-comment').textContent(), /用于撤销/);
      await page.keyboard.press('Control+Shift+z');
      assert.match(await page.locator('.annotation-card').first().locator('.annotation-comment').textContent(), /更新后/);
      await page.locator('.annotation-card [data-action="delete"]').click();
      assert.equal(await annotationCount(page), 0);
      await page.keyboard.press('Control+z');
      assert.equal(await annotationCount(page), 1);
      assert.equal(await page.locator('.annotation-card').first().getAttribute('data-annotation-id'), annotationId);
      await page.keyboard.press('Control+Shift+z');
      assert.equal(await annotationCount(page), 0);
      await page.locator('#undo-button').click();
      assert.equal(await annotationCount(page), 1);
      await page.keyboard.press('Control+z');
      assert.match(await page.locator('.annotation-card').first().locator('.annotation-comment').textContent(), /用于撤销/);

      await selectText(page, '#cross-line-copy');
      const secondQuote = await page.locator('#target-text').textContent();
      await saveAnnotation(page, '第二条文字批注用于验证添加顺序。');
      assert.equal(await annotationCount(page), 2);
      const orderedIds = await page.locator('.annotation-card').evaluateAll(cards => cards.map(card => card.dataset.annotationId));
      assert.equal(orderedIds.length, 2);
      assert.equal(orderedIds[0], annotationId);
      assert.notEqual(orderedIds[1], annotationId);
      assert.match(await page.locator('.annotation-card').nth(1).locator('.annotation-quote').textContent(), new RegExp(secondQuote.slice(0, 16)));
      await page.keyboard.press('Control+z');
      assert.equal(await annotationCount(page), 1);
      assert.equal(await page.locator('.annotation-card').first().getAttribute('data-annotation-id'), annotationId);
      await page.keyboard.press('Control+Shift+z');
      assert.equal(await annotationCount(page), 2);
      assert.deepEqual(await page.locator('.annotation-card').evaluateAll(cards => cards.map(card => card.dataset.annotationId)), orderedIds);

      await page.locator('.annotation-card').first().locator('[data-action="delete"]').click();
      assert.equal(await annotationCount(page), 1);
      await page.keyboard.press('Control+z');
      assert.deepEqual(await page.locator('.annotation-card').evaluateAll(cards => cards.map(card => card.dataset.annotationId)), orderedIds);
      assert.match(await page.locator('.annotation-card').nth(1).locator('.annotation-quote').textContent(), new RegExp(secondQuote.slice(0, 16)));

      const saveStateBeforeCopy = await page.locator('#save-state').textContent();
      await page.evaluate(() => {
        window.__agentTask = '';
        window.HRSession = window.HRSession;
        Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async text => { window.__agentTask = text; }}});
      });
      await page.locator('#copy-agent-task').click();
      assert.equal(await page.locator('#save-state').textContent(), saveStateBeforeCopy, 'copying must not alter download-dirty state');
      const copied = await page.evaluate(() => window.__agentTask);
      assert.match(copied, /用于撤销和 agent 任务的整体意见/);
      const copiedExport = JSON.parse(copied.slice(copied.indexOf('\n{') + 1));
      assert.equal(copiedExport.source.base64, undefined);
      assert.equal(copiedExport.resources.some(resource => 'base64' in resource), false);
      assert.equal(copiedExport.annotations[0].comment, '用于撤销和 agent 任务的整体意见。');
      assert.equal(typeof copiedExport.annotations[0].target.context, 'object');
      await page.locator('#comment-input').fill('这条草稿不能泄露给 agent。');
      assert.equal(await page.locator('#copy-agent-task').isDisabled(), true, 'pending editor text must block task copy');
      await page.locator('#cancel-edit').click();

      await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async () => { throw new Error('denied'); }}});
      });
      await page.locator('#copy-agent-task').click();
      await page.locator('#agent-task-dialog').waitFor({state: 'visible'});
      const task = await page.locator('#agent-task-text').inputValue();
      assert.match(task, /finance\/index\.html|index\.html/);
      assert.match(task, /用于撤销和 agent 任务的整体意见/);
      const fallbackExport = JSON.parse(task.slice(task.indexOf('\n{') + 1));
      assert.equal(fallbackExport.source.base64, undefined);
      assert.equal(fallbackExport.resources.some(resource => 'base64' in resource), false);
      await page.locator('#copy-agent-text').click();
    } finally { await context.close(); }
  });

  await check('shortcuts work in the main page and iframe without hijacking real inputs or dialogs', async () => {
    // This suite exercises the input picker path; native file handles have a dedicated reload suite.
    const {context, page} = await newPage(() => { window.showOpenFilePicker = undefined; });
    try {
      const frame = await openFinance(page);
      const mainChooser = page.waitForEvent('filechooser');
      await page.locator('body').press('Control+o');
      await mainChooser;
      for (const [key, mode] of [['v', 'browse'], ['t', 'text'], ['e', 'element'], ['p', 'page'], ['a', 'whole']]) {
        await page.locator('body').press(key);
        assert.equal(await page.locator(`[data-mode="${mode}"]`).getAttribute('aria-pressed'), 'true');
      }
      await page.locator('body').press('?');
      await page.locator('#shortcuts-dialog').waitFor({state: 'visible'});
      await page.keyboard.press('Escape');
      await page.locator('#settings-dialog').waitFor({state: 'hidden'});

      await frame.locator('#topic-input').focus();
      const before = await frame.locator('#topic-input').inputValue();
      await frame.locator('#topic-input').press('t');
      assert.equal((await frame.locator('#topic-input').inputValue()).length, before.length + 1);
      assert.match(await frame.locator('#topic-input').inputValue(), /现金流质量/);
      assert.equal(await page.locator('[data-mode="whole"]').getAttribute('aria-pressed'), 'true');
      await frame.locator('#topic-input').press(nativeUndo);
      assert.equal(await frame.locator('#topic-input').inputValue(), before);

      await frame.locator('body').evaluate(body => {
        const editor = document.createElement('div');
        editor.id = 'shortcut-contenteditable';
        editor.contentEditable = 'true';
        editor.textContent = 'edit';
        body.append(editor);
      });
      const editor = frame.locator('#shortcut-contenteditable');
      await editor.focus();
      await editor.press('End');
      await editor.press('t');
      assert.equal((await editor.textContent()).length, 5);
      assert.match(await editor.textContent(), /edit/);
      assert.equal(await page.locator('[data-mode="whole"]').getAttribute('aria-pressed'), 'true');
      await editor.press(nativeUndo);
      assert.equal(await editor.textContent(), 'edit');

      await page.locator('[data-mode="browse"]').click();
      const iframeChooser = page.waitForEvent('filechooser');
      await frame.locator('body').press('Control+o');
      await iframeChooser;
      await frame.locator('body').press('t');
      assert.equal(await page.locator('[data-mode="text"]').getAttribute('aria-pressed'), 'true');
      await selectText(page, '#cross-line-copy');
      await page.locator('#comment-input').fill('快捷键 Ctrl+Enter 应保存。');
      await page.locator('#comment-input').press('Control+Enter');
      assert.equal(await annotationCount(page), 1);
      const pending = page.waitForEvent('download');
      await page.locator('body').press('Control+s');
      await pending;
      await page.locator('#settings-button').click();
      await page.locator('#shortcuts-button').click();
      await page.locator('#shortcuts-dialog').waitFor({state: 'visible'});
      await page.locator('#shortcuts-dialog .shortcut-row').filter({hasText: '下载当前格式'}).locator('kbd').filter({hasText: 'S'}).waitFor();
      await page.screenshot({path: path.join(resultDir, 'usability-shortcuts.png'), fullPage: true});
    } finally { await context.close(); }
  });

  await check('a rejected initial recovery read can retry, and a rejected local-session write never reports success', async () => {
    const {context, page} = await newPage(() => {
      let original;
      Object.defineProperty(window, 'HRSession', {
        configurable: true,
        get() { return original; },
        set(value) {
          window.__realHRSession = value;
          original = window.__allowRealSession ? value : Object.freeze({...value, load: async () => { throw new Error('forced initial load failure'); }});
        }
      });
    });
    try {
      await page.locator('#retry-recovery').waitFor({state: 'visible'});
      await page.evaluate(() => { window.__allowRealSession = true; window.HRSession = window.__realHRSession; });
      await page.locator('#retry-recovery').click();
      await page.locator('#retry-recovery').waitFor({state: 'hidden'});
      await openFinance(page);
      await waitAutosaved(page);
    } finally { await context.close(); }

    const corrupt = await newPage();
    const {context: corruptContext, page: corruptPage} = corrupt;
    try {
      await corruptPage.evaluate(async () => {
        const key = 'workspace:' + location.href.split('#')[0];
        await window.HRSession.save(key, {version: 1, data: {}, draft: {}, preferences: {}});
      });
      await corruptPage.reload();
      await corruptPage.locator('#status').filter({hasText: '本机恢复记录损坏'}).waitFor({state: 'visible'});
      assert.equal(await corruptPage.locator('#source-name').textContent(), '尚未打开页面');
      assert.equal(await corruptPage.locator('#recovery-banner').isVisible(), false);
      await openFinance(corruptPage);
      await waitAutosaved(corruptPage);
    } finally { await corruptContext.close(); }

    const next = await newPage();
    const {context: writeContext, page: writePage} = next;
    try {
      await writePage.evaluate(() => {
        window.__realHRSession = window.HRSession;
        window.HRSession = Object.freeze({...window.HRSession, save: async () => { throw new Error('forced storage failure'); }});
      });
      await openFinance(writePage);
      await writePage.locator('#comment-input').fill('触发本机保存失败的整体草稿。');
      await writePage.waitForFunction(() => /失败|不可用/.test(document.querySelector('#autosave-state').textContent));
      assert.equal((await writePage.locator('#autosave-state').textContent()).includes('本机已保存'), false);
      await writePage.evaluate(() => { window.HRSession = window.__realHRSession; });
      await writePage.locator('#retry-recovery').click();
      await waitAutosaved(writePage);
    } finally { await writeContext.close(); }
  });
} catch (error) {
  errors.push(String(error.stack || error));
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close().then(() => { processCleanupComplete = true; }, () => { processCleanupComplete = false; });
  await writeFile(path.join(resultDir, 'usability-report.json'), JSON.stringify({checks, errors, browserVersion, processCleanupComplete}, null, 2));
  console.log(processCleanupComplete ? 'PROCESS_CLEANUP_COMPLETE' : 'PROCESS_CLEANUP_BLOCKED');
}
