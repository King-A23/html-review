(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const core = window.HRCore;
  const local = window.HRLocalFiles;
  const frame = $('preview-frame');
  const workspace = document.querySelector('.workspace');
  const sidebarPreferenceKey = 'html-review.sidebar-position';
  const recoveryKey = 'workspace:' + location.href.split('#')[0];
  const resumeKey = 'html-review.resume:' + recoveryKey;
  const guideKey = 'html-review.guide-dismissed';
  const labels = {text: '文字', element: '元素', page: '单页'};
  const targetLabel = target => target.kind === 'page' && (target.scope === 'whole-document' || !target.selector) ? '整体' : labels[target.kind];
  let pageInventory = [];
  let renderedIds = new Set();
  const hints = {
    browse: '可以正常阅读和点击页面。直接填写意见即可批注整个文件；也可切换到文字或元素模式。',
    text: '在预览中拖选文字，再填写修改意见。可跨越相邻的行内标签。',
    element: '点击预览中的元素；使用「选父级容器」可指定卡片、区块等布局区域。',
    page: '选择 HTML 中已有的幻灯片或打印页：点击页面，或从下方列表选择。',
    whole: '针对整个文件提出修改意见，无需选择文字或元素。适合整体内容、结构和视觉风格。'
  };
  let data = null;
  let pendingLight = null;
  const isDocx = value => value?.source?.type === 'docx';
  let mode = 'browse';
  let channel = '';
  let previewReady = false;
  let pendingTarget = null;
  let editingId = null;
  let draftBaseline = '';
  let draftTargetChanged = false;
  let dirty = false;
  let lastExportFormat = 'html';
  let busy = false;
  let folderFiles = null;
  let folderEntries = [];
  let currentEntryPath = '';
  let localAccess = null;
  let reloadSelection = null;
  let pendingPicker = null;
  let documentOutline = [];
  let searchTimer = null;
  let exampleWorkspace = false;
  const reviewFiles = new WeakSet();
  let renderGeneration = 0;
  const locations = new Map();
  const manualLocationRequests = new Map();
  let locationReview = null;
  let locationRequest = null;
  let locationTimer = null;
  const needsLocationReview = annotation => core.annotationStatus(annotation) === 'open' && ['missing','ambiguous','fallback'].includes(locations.get(annotation.id)?.status);
  const undoStack = [];
  const redoStack = [];
  let bootPromise = Promise.resolve();
  let cachedSession = null;
  let persistenceReady = false;
  let restoringSession = false;
  let autosaveTimer = null;
  let autosaveRevision = 0;
  let autosavePhase = 'idle';
  let guideDismissed = false;
  let delivered = false;
  let guideAnnotated = false;
  let autosavePaused = false;
  let needsEpochRefresh = false;
  let recoveryChannel = null;
  const recoverySignalKey = 'html-review.recovery-cleared';
  function pauseRecovery(completed = false) {
    clearTimeout(autosaveTimer); autosaveTimer = null; ++autosaveRevision;
    autosavePaused = true; cachedSession = null; autosavePhase = 'idle';
    needsEpochRefresh = true;
    try { sessionStorage.removeItem(resumeKey); } catch (_) {}
    $('recovery-banner').hidden = true;
    autosaveStatus(completed ? '本机恢复记录已清除；下次修改会重新保存' : '正在清除本机恢复记录…');
  }
  try {
    recoveryChannel = new BroadcastChannel('html-review-recovery');
    recoveryChannel.onmessage = event => {
      if (event.data?.key !== recoveryKey) return;
      if (['clear', 'cleared'].includes(event.data?.action)) pauseRecovery(event.data.action === 'cleared');
      else if (event.data?.action === 'saved') refreshAvailableRecovery();
    };
  } catch (_) { /* Storage events also coordinate browsers without BroadcastChannel. */ }
  window.addEventListener('storage', event => {
    if (event.key !== recoverySignalKey || !event.newValue) return;
    try { const signal = JSON.parse(event.newValue); if (signal.key === recoveryKey) { if (signal.action === 'saved') refreshAvailableRecovery(); else if (['clear','cleared'].includes(signal.action)) pauseRecovery(signal.action === 'cleared'); } } catch (_) {}
  });

  async function refreshAvailableRecovery() {
    await bootPromise;
    if (data || busy || pendingLight || !persistenceReady) return;
    try {
      const record = await window.HRSession.load(recoveryKey);
      if (!record || data || busy || pendingLight) return;
      await validateSession(record);
      if (data || busy || pendingLight || (cachedSession && Date.parse(cachedSession.savedAt) >= Date.parse(record.savedAt))) return;
      cachedSession = record;
      $('recovery-description').textContent = `本机有 ${record.data.source.name} 的恢复记录（${new Date(record.savedAt).toLocaleString()}）。`;
      $('recovery-banner').hidden = false;
      autosaveStatus('发现本机恢复记录，可选择继续');
    } catch (_) { /* A later successful save can notify this empty workspace again. */ }
  }

  function id() { return crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16)).join('-'); }
  function note(message, error = false) {
    $('status').textContent = message;
    $('status').classList.toggle('error', error);
    $('status').hidden = !message;
  }
  function showWarnings(warnings) {
    const box = $('warnings');
    box.replaceChildren();
    box.hidden = !warnings.length;
    if (!warnings.length) return;
    const unique = Array.from(new Set(warnings));
    const missing = unique.filter(warning => warning.startsWith('未附带本地资源：')).length;
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = missing ? `缺少 ${missing} 项本地资源 · 导入文件夹可补全 · 查看详情` : `预览提示 ${unique.length} 项 · 查看详情`;
    details.append(summary);
    if (missing) {
      const help = document.createElement('p');
      help.textContent = '只打开 HTML 不会读取旁边的图片、样式等文件。请选择包含当前 HTML 和资源的文件夹，再选择对应入口。';
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = '导入资源文件夹';
      button.addEventListener('click', () => openDirectory());
      details.append(help, button);
    }
    const list = document.createElement('ul');
    for (const warning of unique) { const item = document.createElement('li'); item.textContent = warning; list.append(item); }
    details.append(list);
    box.append(details);
  }
  function setBusy(value) {
    busy = value;
    $('cancel-conversion').textContent = pendingPicker ? '取消选择' : '取消转换';
    $('cancel-conversion').hidden = !value;
    $('open-button').disabled = value;
    $('welcome-open').disabled = value;
    $('folder-button').disabled = value;
    $('example-button').disabled = value;
    $('entry-select').disabled = value;
    $('download-button').disabled = value || !data;
    $('export-format').disabled = value;
    $('reload-preview').disabled = value || !data;
    $('data-button').disabled = value || !data;
    updateEditor();
  }
  function draftDirty() { return $('comment-input').value !== draftBaseline || (draftTargetChanged && Boolean($('comment-input').value.trim())); }
  function confirmDiscard() {
    const pendingRecovery = !$('recovery-banner').hidden && cachedSession;
    if (!(dirty || draftDirty() || pendingRecovery)) return true;
    return confirm(pendingRecovery
      ? `本机仍有 ${cachedSession.data.source.name} 的恢复记录。打开其他页面将替换该记录及其中的草稿。确定继续吗？`
      : '当前修改还未下载保存。确定打开其他页面并放弃这些修改吗？');
  }
  function markDirty() { autosavePaused = false; dirty = true; data.updatedAt = new Date().toISOString(); updateSaveState(); }
  function updateSaveState() {
    const saved = {html: '当前无未下载的修改；HTML 副本可继续编辑', gzip: '当前无未下载的修改；压缩副本解压后可继续编辑', annotations: '轻量批注需与原始文档一起交付'};
    $('save-state').textContent = dirty ? '● 有未下载的修改，请下载保存' : (data ? saved[lastExportFormat] : '批注保存在下载的副本中');
  }
  function view() {
    return {width: Math.round(frame.clientWidth), height: Math.round(frame.clientHeight), devicePixelRatio: window.devicePixelRatio || 1};
  }
  function pageTarget() {
    return {kind: 'page', text: data.source.name, scope: 'whole-document', context: {sourcePath: data.source.path}, viewport: view(), ...(isDocx(data) ? {docx:{adapterVersion:'1',sourceSha256:data.source.sha256,blocks:[]}} : {})};
  }
  function send(command, extra = {}) {
    if (frame.contentWindow && channel) frame.contentWindow.postMessage({hr: true, channel, command, ...extra}, '*');
  }
  function setMode(next) {
    if (!['browse', 'text', 'element', 'page', 'whole'].includes(next)) return;
    if (next === 'page' && isDocx(data)) return;
    autosavePaused = false;
    mode = next;
    for (const button of document.querySelectorAll('[data-mode]')) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    send('set-mode', {mode: mode === 'whole' ? 'browse' : mode});
    if (data && (mode === 'whole' || (mode === 'browse' && !editingId))) {
      send('clear-focus');
      setTarget(pageTarget());
    } else if (mode !== 'browse' && pendingTarget && (pendingTarget.kind !== mode || (mode === 'page' && pendingTarget.scope === 'whole-document'))) {
      pendingTarget = null;
      draftTargetChanged = true;
      $('target-preview').hidden = true;
      send('clear-focus');
    }
    document.querySelector('.mode-tabs').style.setProperty('--mode-index', (isDocx(data) ? ['browse','text','element','whole'] : ['browse','text','element','page','whole']).indexOf(mode));
    renderPageControls();
    updateEditor();
  }
  function renderPageControls() {
    $('page-controls').hidden = mode !== 'page';
    $('page-select').disabled = busy || !pageInventory.length;
    $('page-description').textContent = pageInventory.length ? `识别到 ${pageInventory.length} 个分页区块，也可直接点击预览选择。` : '未发现明确的分页区块。连续页面可使用整体或元素批注。';
  }
  function targetText(target) {
    if (target.kind === 'page') return (target.scope === 'whole-document' || !target.selector) ? `整个文件 · ${data.source.name}` : `第 ${target.pageIndex || '?'} 页 · ${target.pageTitle || target.text || '分页区块'}`;
    return target.quote?.exact || target.text || target.attributes?.alt || `<${target.tag || '元素'}> ${target.selector || ''}`;
  }
  function setTarget(target) {
    if(isDocx(data)) {try {core.validateDocxTarget(target);} catch(error) {pendingTarget=null;$('target-preview').hidden=true;send('clear-focus');updateEditor();note(error.message,true);return;} }
    autosavePaused = false;
    pendingTarget = target;
    draftTargetChanged = true;
    $('target-preview').hidden = false;
    $('target-kind').textContent = targetLabel(target) || '目标';
    const text = targetText(target);
    $('target-text').textContent = text.length > 600 ? text.slice(0, 600) + '…' : text;
    const docxBlock=target.docx?.blocks[0];
    $('target-selector').textContent = isDocx(data) ? (target.scope==='whole-document' ? '整个 DOCX 文档' : docxBlock?.table ? `表格 · 第 ${docxBlock.table.row} 行 / 第 ${docxBlock.table.column} 列` : docxBlock?.image ? '文档图片' : docxBlock?.part==='word/footnotes.xml' ? '脚注内容' : docxBlock?.part==='word/endnotes.xml' ? '尾注内容' : '正文内容') : target.selector || `视口 ${target.viewport?.width || view().width} × ${target.viewport?.height || view().height}px`;
    $('parent-target').hidden = target.kind !== 'element';
    if (target.kind === 'page' && target.scope === 'page') { $('page-select').value = String(target.pageIndex); window.HRUI.syncSelect('page-select'); }
    updateEditor();
  }
  function updateEditor() {
    $('handoff-button').hidden = !data?.annotations.length;
    $('handoff-button').disabled = busy || !data?.annotations.length || draftDirty();
    $('handoff-button').title = draftDirty() ? '先保存或取消编辑框中的意见' : '查看需要交给 agent 的文件与任务';
    $('document-nav-button').hidden = !isDocx(data);
    $('document-nav-button').disabled = busy || !previewReady;
    $('compatible-reload').disabled = busy || !data || exampleWorkspace;
    $('undo-button').disabled = busy || !undoStack.length;
    $('redo-button').disabled = busy || !redoStack.length;
    $('copy-agent-task').disabled = busy || !data || !data.annotations.length || draftDirty();
    $('copy-agent-task').title = draftDirty() ? '先保存或取消编辑框中的意见，再复制任务' : '复制已保存批注和定位信息，连同原文件交给 agent';
    $('retry-recovery').disabled = busy;
    $('import-results').disabled = busy || !data;
    $('clear-target').hidden = !pendingTarget || pendingTarget.scope === 'whole-document';
    $('clear-target').disabled = busy;
    $('mode-hint').textContent = data ? (mode === 'browse' && editingId ? '可以正常阅读和点击页面。正在编辑已有批注，修改意见仍对应下方目标。' : isDocx(data) && mode === 'element' ? '点击段落、表格或图片，再写意见。需要更大范围时，可继续扩大选择。' : hints[mode]) : '先打开 HTML 或 DOCX，或体验下方示例。';
    $('comment-input').disabled = !data || busy;
    $('save-button').disabled = !data || busy || !pendingTarget || !$('comment-input').value.trim();
    $('draft-status').textContent = draftDirty() ? '尚未保存' : '';
    $('save-button').textContent = editingId ? '更新批注' : '保存批注';
    $('editor-title').textContent = editingId ? '编辑批注' : '添加批注';
    $('cancel-edit').hidden = !editingId && (!pendingTarget || pendingTarget.kind === 'page') && !$('comment-input').value;
    renderPageControls();
    updateGuide();
    queueAutosave();
  }
  function clearEditor() {
    pendingTarget = null;
    $('page-select').value = ''; window.HRUI.syncSelect('page-select');
    editingId = null;
    draftBaseline = '';
    draftTargetChanged = false;
    $('comment-input').value = '';
    $('target-preview').hidden = true;
    send('clear-selection');
    if (data && ['browse', 'whole'].includes(mode)) setTarget(pageTarget());
    draftTargetChanged = false;
    updateEditor();
  }
  function clearTarget() {
    if (busy || !pendingTarget || pendingTarget.scope === 'whole-document') return;
    autosavePaused = false;
    pendingTarget = null;
    $('page-select').value = ''; window.HRUI.syncSelect('page-select');
    draftTargetChanged = true;
    $('target-preview').hidden = true;
    send('clear-selection');
    updateEditor();
    note('已取消选择，修改意见已保留。请重新选择目标，或切换到「整体」批注。');
  }
  function resetFolder() {
    folderFiles = null;
    folderEntries = [];
    currentEntryPath = '';
    localAccess = null;
    exampleWorkspace = false;
    $('entry-label').hidden = true;
    $('entry-select').replaceChildren();
  }
  function renderSource() {
    const docx = isDocx(data);
    workspace.classList.add('has-document');
    $('format-note').hidden = !docx;
    $('format-note').textContent = docx ? 'Word 内容预览：可以批注文字、表格和图片；排版可能与 Word 不同。' : '';
    frame.title = docx ? 'DOCX 文档内容预览' : '原始 HTML 页面';
    document.querySelector('.preview-section').setAttribute('aria-label', docx ? 'Word 文档预览' : 'HTML 页面预览');
    document.querySelector('[data-mode=page]').hidden = docx;
    document.querySelector('.mode-tabs').classList.toggle('is-docx',docx);
    document.querySelectorAll('[data-docx-hide]').forEach(node=>node.hidden=docx);
    $('source-name').textContent = data.source.name;
    $('preview-label').textContent = data.source.name;
    document.title = `${data.source.name} · HTML 批注`;
    $('welcome').hidden = true;
    frame.hidden = false;
    updateSaveState();
  }
  function textNode(tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = content;
    return element;
  }
  function renderAnnotations() {
    const list = $('annotation-list');
    const previousIds = renderedIds; renderedIds = new Set(data?.annotations.map(item => item.id));
    list.replaceChildren();
    const annotations = data?.annotations || [];
    $('annotation-count').textContent = annotations.length;
    const pendingCount = annotations.filter(annotation => core.annotationStatus(annotation) === 'open').length;
    $('review-progress').textContent = `待处理 ${pendingCount} · 已完成 ${annotations.length - pendingCount}`;
    renderLocationReview();
    const filter = $('annotation-filter').value;
    if (!annotations.length) { list.append(textNode('p', 'empty-list', '还没有批注。直接填写整体意见，或选择具体内容后批注。')); return; }
    annotations.forEach((annotation, index) => {
      const resolved = core.annotationStatus(annotation) === 'resolved';
      if (filter === 'attention' ? !needsLocationReview(annotation) : filter !== 'all' && (resolved ? 'resolved' : 'open') !== filter) return;
      const state = core.taskState(annotation);
      const stateLabels = {new: '新增意见', updated: '已更新', pending: '待处理', completed: '已完成'};
      const card = document.createElement('article');
      card.className = 'annotation-card' + (resolved ? ' is-resolved' : '') + (!previousIds.has(annotation.id) ? ' is-new' : '') + (editingId === annotation.id ? ' active' : '');
      card.dataset.annotationId = annotation.id; card.dataset.reviewState = state;
      const top = document.createElement('div'); top.className = 'annotation-top';
      const meta = document.createElement('div'); meta.className = 'annotation-top-meta';
      meta.append(textNode('span', 'annotation-state ' + state, stateLabels[state]), textNode('span', 'annotation-number', String(index + 1).padStart(2, '0')));
      top.append(textNode('span', 'tag', targetLabel(annotation.target)), meta);
      card.append(top, textNode('p', 'annotation-comment', annotation.comment));
      card.append(textNode('div', 'annotation-quote', targetText(annotation.target).slice(0, 180)));
      const location = locations.get(annotation.id);
      if (location && !resolved) { const line = textNode('div', 'location-status ' + location.status, location.message); card.append(line); }
      const latest = annotation.history?.[annotation.history.length - 1];
      if (state === 'pending' && latest?.summary) {
        const feedback = textNode('div', 'annotation-feedback', '');
        feedback.append(textNode('strong', '', '处理反馈'), textNode('p', '', latest.summary));
        card.append(feedback);
      }
      const actions = document.createElement('div'); actions.className = 'annotation-actions';
      for (const [action, label] of [['locate', '定位'], ['edit', '编辑'], ['status', resolved ? '重新待处理' : '标记完成'], ['delete', '删除']]) {
        const button = textNode('button', 'text-button' + (action === 'delete' ? ' delete-button' : ''), label);
        button.type = 'button'; button.dataset.action = action; button.dataset.id = annotation.id;
        if (action === 'locate' && resolved) { button.disabled = true; button.title = '已完成批注保留为记录，无需再次定位'; }
        actions.append(button);
      }
      if (needsLocationReview(annotation)) {
        const button = textNode('button', 'text-button reselect-button', '重新选择位置');
        button.type = 'button'; button.dataset.action = 'reselect'; button.dataset.id = annotation.id;
        actions.prepend(button);
      }
      card.append(actions);
      if (annotation.targetHistory?.length) {
        const history = document.createElement('details'); history.className = 'annotation-history target-history';
        history.append(textNode('summary', '', `原定位记录 · ${annotation.targetHistory.length}`));
        for (const event of annotation.targetHistory.slice().reverse()) history.append(textNode('p', '', `第 ${event.revision} 版 · ${new Date(event.at).toLocaleString()}\n${targetLabel(event.target)} · ${targetText(event.target).slice(0,180)}`));
        card.append(history);
      }
      if (annotation.history?.length) {
        const history = document.createElement('details'); history.className = 'annotation-history';
        history.append(textNode('summary', '', `处理记录 · ${annotation.history.length}`));
        for (const event of annotation.history.slice().reverse()) {
          const by = event.by === 'user' ? '你' : event.by;
          history.append(textNode('p', '', `${event.status === 'resolved' ? '已完成' : '待处理'} · 第 ${event.revision} 版 · ${by} · ${new Date(event.at).toLocaleString()}\n${event.summary || '未附说明'}`));
        }
        card.append(history);
      }
      list.append(card);
    });
    if (!list.childElementCount) list.append(textNode('p', 'empty-list', filter === 'attention' ? '目前没有需要确认位置的批注。' : filter === 'open' ? '目前没有待处理意见。' : '还没有已完成的处理记录。'));
    renderLocationReview();
    window.HRUI.enterCards(list);
  }
  function locationDescription(status, reason = '') {
    const description = {exact:'位置与原文已匹配',fallback:'原定位已变化，通过原文找到候选，请核对',ambiguous:'有多个候选，不能自动确认原位置',missing:'原文或元素已变化，无法确认原位置'}[status];
    return description + (reason ? ' · ' + reason.slice(0,500) : '');
  }
  function renderLocationReview() {
    if (!locationReview || !data) { $('reload-review').hidden = true; return; }
    $('reload-review').hidden = locationReview.dismissed;
    const pending = data.annotations.filter(annotation => core.annotationStatus(annotation) === 'open');
    const counts = {exact:0,fallback:0,ambiguous:0,missing:0};
    for (const annotation of pending) { const status = locations.get(annotation.id)?.status; if (status in counts) ++counts[status]; }
    const checked = Object.values(counts).reduce((a,b) => a+b,0);
    const attention = counts.fallback + counts.ambiguous + counts.missing;
    const completedNow = data.annotations.filter(annotation => core.annotationStatus(annotation) === 'resolved' && locationReview.completedNow.includes(annotation.id)).length;
    $('reload-review-title').textContent = locationReview.changed ? '已读取新版本' : '已重新读取文档';
    $('reload-review-summary').textContent = `已完成 ${data.annotations.length-pending.length} · 待处理 ${pending.length}` + (completedNow ? ` · 本次新完成 ${completedNow}` : '') + (locationReview.checking ? ` · 正在检查位置 ${checked}/${pending.length}` : ` · 需确认位置 ${attention}`);
    $('reload-review-detail').textContent = locationReview.checking ? '正在核对待处理意见，检查不会改变选区、草稿或完成状态。' :
      [counts.missing ? `无法确认 ${counts.missing} 条（原文可能被修改或删除）` : '',counts.ambiguous ? `多处候选 ${counts.ambiguous} 条` : '',counts.fallback ? `通过原文找到 ${counts.fallback} 条，需核对` : '', checked < pending.length ? `${pending.length-checked} 条尚未检查，可重试或手动定位` : ''].filter(Boolean).join('；') || '待处理意见的位置已匹配。已完成批注保留作记录，不再检查旧目标。';
    $('review-attention').hidden = !attention;
    $('review-retry').hidden = locationReview.checking || checked === pending.length;
    $('review-retry').disabled = busy || !previewReady;
  }
  function startLocationReview() {
    if (!locationReview || !previewReady || !data) return;
    clearTimeout(locationTimer); locationRequest = null; locations.clear();
    locationReview.queue = data.annotations.filter(annotation => core.annotationStatus(annotation) === 'open').map(annotation => annotation.id);
    locationReview.checking = true;
    nextLocationBatch();
  }
  function nextLocationBatch() {
    if (!locationReview || !previewReady || !data) return;
    const records = new Map(data.annotations.map(annotation => [annotation.id,annotation]));
    const items = locationReview.queue.splice(0,10).map(id => records.get(id)).filter(annotation => annotation && core.annotationStatus(annotation) === 'open').map(annotation => ({id:annotation.id,revision:core.annotationRevision(annotation),target:structuredClone(annotation.target)}));
    if (!items.length) {
      if (locationReview.queue.length) { locationTimer = setTimeout(nextLocationBatch,0); return; }
      locationReview.checking = false; locationRequest = null; renderAnnotations(); return;
    }
    locationRequest = {id:id(),items};
    send('check-targets', {requestId:locationRequest.id,items});
    renderLocationReview();
    locationTimer = setTimeout(() => {
      locationRequest = null;
      if (locationReview) { locationReview.checking = false; locationReview.queue = []; renderAnnotations(); }
    },8000);
  }
  async function preparePreview(nextData) {
    if(isDocx(nextData)) note('正在生成 DOCX 内容预览，可随时取消…');
    const nextChannel = id();
    const bridge = `(${window.HRBridge.toString()})(${JSON.stringify(nextChannel)}, ${window.HRShortcut.toString()}, ${JSON.stringify(isDocx(nextData) ? {sourceSha256:nextData.source.sha256} : null)});`;
    const result = await (isDocx(nextData) ? window.HRDocx.preview(nextData, bridge) : core.createPreview(nextData, bridge));
    return {...result, channel: nextChannel};
  }
  function installPreview(result) {
    previewReady = false;
    documentOutline = []; clearTimeout(searchTimer);
    $('document-search').value = ''; renderDocumentNavigation();
    pageInventory = []; $('page-select').replaceChildren(new Option('点击预览或选择页面', '')); renderPageControls();
    channel = result.channel;
    clearTimeout(locationTimer); locationRequest = null; manualLocationRequests.clear();
    const localChannel = result.channel;
    locations.clear();
    showWarnings(result.warnings);
    frame.srcdoc = result.html;
    renderAnnotations();
    setTimeout(() => {
      if (channel === localChannel && !previewReady) {
        if (locationReview) { locationReview.checking = false; renderLocationReview(); }
        note('页面已载入，但批注定位脚本未响应。原页面可能存在脚本错误、跳转或不支持的结构；可重载或改用普通静态 HTML。', true);
      }
    }, 8000);
  }
  async function renderPreview() {
    const generation = ++renderGeneration;
    const localData = data;
    const prepared = await preparePreview(localData);
    if (generation !== renderGeneration || data !== localData) return;
    installPreview(prepared);
  }
  async function activate(nextData) {
    if (!nextData) return;
    await core.validateData(nextData);
    const prepared = await preparePreview(nextData);
    autosavePaused = false;
    data = nextData;
    locationReview = null; $('reload-review').hidden = true;
    if ($('annotation-filter').value === 'attention') { $('annotation-filter').value = 'all'; window.HRUI.syncSelect('annotation-filter'); }
    data.annotations = data.annotations.map(core.normalizeAnnotation);
    undoStack.length = 0; redoStack.length = 0;
    cachedSession = null; $('recovery-banner').hidden = true;
    delivered = false;
    guideAnnotated = false;
    dirty = false;
    lastExportFormat = isDocx(nextData) ? 'annotations' : 'html';
    if(isDocx(nextData)) $('export-format').value = lastExportFormat;
    updateExportFormat();
    clearEditor();
    renderSource();
    setMode('browse');
    renderAnnotations();
    ++renderGeneration;
    installPreview(prepared);
    note(`已打开 ${data.source.name}，载入 ${data.annotations.length} 条批注。`);
  }
  async function readFile(file, path = file.name, resources = []) {
    if (file.size > 100 * 1024 * 1024) throw new Error('待导入文件超过 100 MiB。');
    if (/\.docx$/i.test(file.name) && file.size > core.limits.source) throw new Error('DOCX 文件超过 20 MiB 限制。');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (/\.docx$/i.test(file.name)) return core.importSource({bytes,name:file.name,path,lastModified:file.lastModified,type:'docx'});
    if (/\.json$/i.test(file.name)) {
      const imported = JSON.parse(new TextDecoder().decode(bytes));
      if(imported.format !== 'html-review-annotations' || ![1,2].includes(imported.schemaVersion)) throw new Error('请选择轻量批注 JSON；agent 结果请使用导入处理结果。');
      if(imported.schemaVersion===1) throw new Error('HTML 轻量批注恢复暂不支持，请打开完整批注副本。');
      await core.validateAnnotationExport(imported);
      pendingLight=imported; $('pair-source').hidden=false; note('已读取轻量批注，请选择配套原始 DOCX；当前工作区已保留。');
      return null;
    }
    if (!/\.(html?|xhtml)$/i.test(file.name)) throw new Error('支持 HTML、DOCX、完整副本和轻量批注 JSON。');
    const decoded = core.decodeBytes(bytes);
    const parsed = new DOMParser().parseFromString(decoded.text, 'text/html');
    const nodes = parsed.querySelectorAll('script#html-review-data[type="application/json"]');
    if (nodes.length) {
      reviewFiles.add(file);
      if (nodes.length !== 1) throw new Error('副本中包含多个批注数据块，无法确定应读取哪一份。');
      let imported;
      try { imported = JSON.parse(nodes[0].textContent); } catch (_) { throw new Error('批注 JSON 数据损坏，无法打开。'); }
      if (!imported) throw new Error('这是尚未载入页面的工具文件，请选择原始 HTML 或已保存的批注副本。');
      await core.validateData(imported);
      return imported;
    }
    return core.importSource({bytes, name: file.name, path, lastModified: file.lastModified}, resources);
  }
  async function run(task) {
    await bootPromise;
    if (busy) return;
    setBusy(true);
    note('正在处理本地文件…');
    try { await task(); } catch (error) { note(error.message || String(error), true); }
    finally { setBusy(false); }
  }
  function folderPath(file) {
    return local.path(file);
  }
  async function readFolderEntry(path, files) {
    const entry = files.find(file => folderPath(file) === path);
    if (!entry) throw new Error('找不到所选文档。');
    const resources = [];
    for (const file of files) {
      if (/\.docx$/i.test(entry.name)) break;
      if (file === entry || folderPath(file) === core.resultPath(path)) continue;
      resources.push({path: folderPath(file), bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type});
    }
    return readFile(entry, path, resources);
  }
  async function openFolderEntry(path) {
    let files = folderFiles;
    if (localAccess?.directoryHandle) {
      await local.permission(localAccess.directoryHandle);
      files = await local.directoryFiles(localAccess.directoryHandle);
    }
    const nextData = await readFolderEntry(path, files);
    await activate(nextData);
    const directory = localAccess?.directoryHandle;
    updateFolder(files, path);
    localAccess = directory && !reviewFiles.has(files.find(file => folderPath(file) === path))
      ? {directoryHandle: directory, entryPath: path, entries: folderEntries.map(folderPath)} : null;
    queueAutosave();
  }

  function updateFolder(files, entryPath) {
    folderFiles = files;
    folderEntries = files.filter(file => /\.(html?|xhtml|docx)$/i.test(file.name)).sort((a, b) => folderPath(a).localeCompare(folderPath(b)));
    currentEntryPath = entryPath;
    showFolderEntries(folderEntries.map(folderPath), entryPath);
  }
  function showFolderEntries(entries, entryPath) {
    currentEntryPath = entryPath;
    $('entry-select').replaceChildren(...entries.map(path => new Option(path, path)));
    $('entry-select').value = entryPath;
    window.HRUI.syncSelect('entry-select');
    $('entry-label').hidden = !entries.length;
  }
  async function replaceSource(nextData, access, files = null, entryPath = nextData.source.path) {
    // Prepare everything before committing, so permission/read/parse errors cannot erase work.
    nextData.annotations = structuredClone(data.annotations);
    nextData.createdAt = data.createdAt;
    const previousResources = new Map(data.resources.map(resource => [resource.path, resource]));
    const changed = nextData.source.sha256 !== data.source.sha256 || nextData.resources.length !== data.resources.length ||
      nextData.resources.some(resource => {
        const previous = previousResources.get(resource.path);
        return !previous || resource.sha256 !== previous.sha256 || resource.mime !== previous.mime;
      });
    nextData.updatedAt = changed ? new Date().toISOString() : data.updatedAt;
    await core.validateData(nextData);
    let resultCount = 0, resultError = '';
    if (files) {
      const resultsFile = files.find(file => folderPath(file) === core.resultPath(entryPath));
      if (resultsFile) {
        try {
          const merged = core.applyAgentResults(nextData, await readResultFile(resultsFile));
          nextData = merged.data; resultCount = merged.applied;
        } catch (error) { resultError = error.message; }
      }
    }
    await core.validateData(nextData);
    if(isDocx(nextData)!==isDocx(data)) throw new Error('重载文件格式发生变化，当前工作区已保留。');
    const prepared = await preparePreview(nextData);
    const completedNow = nextData.annotations.filter(annotation => core.annotationStatus(annotation) === 'resolved' && core.annotationStatus(data.annotations.find(item => item.id === annotation.id)) !== 'resolved').map(annotation => annotation.id);
    if (resultCount) recordResultsChange(data, nextData);
    data = nextData;
    locationReview = {changed, completedNow, queue:[], checking:true, dismissed:false};
    $('reload-review').hidden = false;
    localAccess = access;
    exampleWorkspace = false;
    if (files) updateFolder(files, entryPath);
    if (pendingTarget?.scope === 'whole-document') pendingTarget = pageTarget();
    if (changed || resultCount) markDirty();
    renderSource();
    ++renderGeneration;
    installPreview(prepared);
    updateEditor();
    queueAutosave();
    if (resultError) note('预览已更新；agent 处理结果未导入：' + resultError + '。原批注和草稿已保留。', true);
    else note((changed ? `已读取最新文档和资源，保留 ${data.annotations.length} 条批注及草稿。`
      : '已从原文件重新载入，批注和草稿已保留。') + (resultCount ? ` 已更新 ${resultCount} 条处理记录。` : ''));
  }
  async function importSelectedFile(file, handle = null, reloading = false) {
    if (reloading && file.name !== data.source.name) throw new Error(`请选择当前原文件 ${data.source.name}，批注和草稿已保留。`);
    if (!reloading && !pendingLight && handle && localAccess?.directoryHandle) {
      const directory = localAccess.directoryHandle;
      const relative = await directory.resolve(handle);
      if (relative) {
        await local.permission(directory);
        const files = await local.directoryFiles(directory);
        const path = relative.join('/');
        const nextData = await readFolderEntry(path, files);
        await activate(nextData);
        updateFolder(files, path);
        localAccess = !reviewFiles.has(files.find(file => folderPath(file) === path))
          ? {directoryHandle: directory, entryPath: path, entries: folderEntries.map(folderPath)} : null;
        queueAutosave(); return;
      }
    }
    let nextData = await readFile(file, reloading ? data.source.path : file.name);
    if(!nextData) return;
    if(pendingLight && !reloading) {
      if(!isDocx(nextData) || nextData.source.sha256 !== pendingLight.source.sha256 || nextData.source.byteLength !== pendingLight.source.byteLength) throw new Error('版本不一致：请选择批注时对应的原始 DOCX。当前工作区和待恢复批注已保留。');
      nextData={...pendingLight,format:core.FORMAT,source:{...pendingLight.source,base64:nextData.source.base64}};
      await core.validateData(nextData);
    }
    if (reloading && reviewFiles.has(file)) throw new Error('请选择 agent 修改后的原始文档，而不是旧批注副本。当前批注已保留。');
    const access = handle && !reviewFiles.has(file) ? {fileHandle: handle} : null;
    if (reloading) {
      nextData.resources = structuredClone(data.resources);
      await replaceSource(nextData, access);
    } else {
      await activate(nextData); resetFolder(); localAccess = access;
      pendingLight=null; $('pair-source').hidden=true;
      queueAutosave();
    }
  }
  function pickerError(error, reloading, directory = false) {
    if (['AbortError', 'SecurityError', 'NotSupportedError'].includes(error.name)) {
      note(error.name === 'AbortError' ? '已取消选择，当前页面、批注和草稿已保留。' : '此环境无法使用系统选择器，当前工作区已保留。');
      const fallback = document.createElement('button');
      fallback.type = 'button'; fallback.className = 'text-button';
      fallback.textContent = directory ? '改用兼容文件夹选择' : '改用兼容文件选择';
      fallback.title = '兼容方式不能建立持续读取关联；重载时需重新选择原文件。';
      fallback.addEventListener('click', () => openCompatible(reloading, directory));
      $('status').append(' ', fallback); return;
    }
    throw error;
  }
  function openCompatible(reloading = false, directory = false) {
    if (busy) return;
    reloadSelection = reloading ? (directory ? 'directory' : 'file') : null;
    $(directory ? 'folder-input' : 'file-input').click();
  }
  function cancelPicker() {
    if (!pendingPicker) return false;
    pendingPicker = null; setBusy(false);
    note('已取消选择，当前页面、批注和草稿已保留。');
    return true;
  }
  async function selectSource(selected, reloading, directory, importSelection) {
    const token = {}; pendingPicker = token; setBusy(true);
    note(directory ? '请在系统窗口中选择文件夹。没有弹出窗口？' : '请在系统窗口中选择文档。没有弹出窗口？');
    const fallback = textNode('button', 'text-button', '使用兼容选择'); fallback.type = 'button';
    fallback.addEventListener('click', () => { if (pendingPicker !== token) return; cancelPicker(); openCompatible(reloading, directory); });
    $('status').append(' ', fallback);
    try {
      const selection = await selected;
      if (pendingPicker !== token) return;
      pendingPicker = null; setBusy(false);
      await run(() => importSelection(selection));
    } catch (error) {
      if (pendingPicker !== token) return;
      pendingPicker = null; setBusy(false);
      try { pickerError(error, reloading, directory); } catch (failure) { note(failure.message, true); }
    }
  }
  function openHTML(reloading = false) {
    if (busy) return;
    if (!local.canPickFile()) { reloadSelection = reloading ? 'file' : null; $('file-input').click(); return; }
    if (!reloading && !confirmDiscard()) return;
    // Invoke the picker in the click event, before any asynchronous file work.
    const selected = local.pickFile();
    return selectSource(selected, reloading, false, async ([handle]) => importSelectedFile(await handle.getFile(), handle, reloading));
  }
  async function importDirectory(files, directory = null, reloading = false) {
    if (files.length > 500 || files.reduce((size, file) => size + file.size, 0) > 50 * 1024 * 1024) throw new Error('文件夹最多 500 个文件、合计最多 50 MiB。请选择只包含页面所需资源的目录。');
    const entries = files.filter(file => /\.(html?|xhtml|docx)$/i.test(file.name)).sort((a, b) => folderPath(a).localeCompare(folderPath(b)));
    if (!entries.length) throw new Error('所选文件夹没有 HTML 或 DOCX 文件。');
    let path = '';
    let attach = reloading;
    if (data && directory) {
      if (localAccess?.fileHandle) {
        const relative = await directory.resolve(localAccess.fileHandle);
        if (relative) { path = relative.join('/'); attach = true; }
      } else if (localAccess?.directoryHandle && await directory.isSameEntry(localAccess.directoryHandle)) {
        path = localAccess.entryPath; attach = true;
      }
    }
    if (data && !path) {
      const matching = entries.filter(file => file.name === data.source.name);
      const exactPath = matching.find(file => folderPath(file) === data.source.path);
      if (reloading) {
        if (!exactPath && matching.length !== 1) throw new Error(`文件夹中无法唯一找到 ${data.source.path}，当前工作区已保留。`);
        path = folderPath(exactPath || matching[0]);
      } else {
        const candidates = exactPath ? [exactPath] : matching;
        const identical = [];
        for (const file of candidates) if (await core.sha256(new Uint8Array(await file.arrayBuffer())) === data.source.sha256) identical.push(file);
        if (identical.length === 1) { path = folderPath(identical[0]); attach = true; }
      }
    }
    if (!path) path = folderPath(entries.find(file => /^index\.html?$/i.test(folderPath(file))) || entries[0]);
    if (!attach && !confirmDiscard()) return;
    const nextData = await readFolderEntry(path, files);
    const sourceFile = files.find(file => folderPath(file) === path);
    if (attach && reviewFiles.has(sourceFile)) throw new Error('请选择包含原始文档的文件夹，当前批注和草稿已保留。');
    const access = directory && !reviewFiles.has(sourceFile)
      ? {directoryHandle: directory, entryPath: path, entries: entries.map(folderPath)} : null;
    if (attach) await replaceSource(nextData, access, files, path);
    else { await activate(nextData); resetFolder(); updateFolder(files, path); localAccess = access; queueAutosave(); }
  }
  function openDirectory(reloading = false) {
    if (busy) return;
    if (!local.canPickDirectory()) { reloadSelection = reloading ? 'directory' : null; $('folder-input').click(); return; }
    const selected = local.pickDirectory();
    return selectSource(selected, reloading, true, async directory => importDirectory(await local.directoryFiles(directory), directory, reloading));
  }
  function reloadSource() {
    if (busy || !data) return;
    if (exampleWorkspace) return run(async () => { await renderPreview(); note('示例预览已重新载入，批注和草稿已保留。'); });
    if (!localAccess) {
      const folder = Boolean(folderFiles || data.resources.length);
      const canAssociate = folder ? local.canPickDirectory() : local.canPickFile();
      note(canAssociate ? '首次重载需选择原文件或资源文件夹以建立关联，批注和草稿会保留。'
        : '此浏览器重载需重新选择原文件或资源文件夹，批注和草稿会保留。');
      return folder ? openDirectory(true) : openHTML(true);
    }
    return run(async () => {
      const access = localAccess;
      const handle = access.directoryHandle || access.fileHandle;
      await local.permission(handle);
      if (access.directoryHandle) {
        const files = await local.directoryFiles(access.directoryHandle);
        const nextData = await readFolderEntry(access.entryPath, files);
        if (reviewFiles.has(files.find(file => folderPath(file) === access.entryPath))) throw new Error('关联的原文件已变成批注副本，当前工作区已保留。');
        const nextAccess = {...access, entries: files.filter(file => /\.(html?|xhtml|docx)$/i.test(file.name)).map(folderPath).sort()};
        await replaceSource(nextData, nextAccess, files, access.entryPath);
      } else {
        const file = await access.fileHandle.getFile();
        const nextData = await readFile(file, data.source.path);
        if (reviewFiles.has(file)) throw new Error('关联的原文件已变成批注副本，当前工作区已保留。');
        nextData.resources = structuredClone(data.resources);
        await replaceSource(nextData, access);
      }
    });
  }
  async function readResultFile(file) {
    if (file.size > 20 * 1024 * 1024) throw new Error('处理结果文件超过 20 MiB。');
    try { return JSON.parse(await file.text()); }
    catch (_) { throw new Error('处理结果不是有效 JSON。'); }
  }
  function recordResultsChange(before, after) {
    const items = [];
    before.annotations.forEach((annotation, index) => {
      const updated = after.annotations[index];
      if (core.annotationStatus(annotation) !== core.annotationStatus(updated) || (annotation.history?.length || 0) !== (updated.history?.length || 0)) items.push({before: structuredClone(annotation), after: structuredClone(updated), index});
    });
    if (!items.length) return;
    undoStack.push({items}); if (undoStack.length > 50) undoStack.shift(); redoStack.length = 0;
  }
  async function importResults(file) {
    const merged = core.applyAgentResults(data, await readResultFile(file));
    await core.validateData(merged.data);
    if (merged.applied) {
      recordResultsChange(data, merged.data); data = merged.data;
      markDirty(); renderAnnotations(); updateEditor(); queueAutosave();
      startLocationReview();
    }
    note(merged.applied ? `已更新 ${merged.applied} 条处理记录；原批注和草稿已保留，可撤销。结果只更新处理状态，请重载 agent 修改后的原文档查看新内容。` : '该批处理结果已导入，无需重复更新。');
    if (merged.applied) {
      const next = textNode('button', 'text-button', '读取修改后的文档'); next.type = 'button';
      next.addEventListener('click', reloadSource); $('status').append(' ', next);
    }
  }
  function toggleStatus(annotation) {
    if (busy) return;
    const status = core.annotationStatus(annotation) === 'resolved' ? 'open' : 'resolved';
    const patch = {format: 'html-review-results', schemaVersion: 1, batchId: id(), results: [{id: annotation.id,
      revision: core.annotationRevision(annotation), annotationUpdatedAt: annotation.updatedAt, status, by: 'user',
      summary: status === 'resolved' ? '用户标记已完成' : '用户重新设为待处理', at: new Date().toISOString()}]};
    const merged = core.applyAgentResults(data, patch);
    recordResultsChange(data, merged.data); data = merged.data;
    markDirty(); renderAnnotations(); updateEditor();
    startLocationReview();
    note(status === 'resolved' ? '已标记完成，批注原文作为记录保留，可撤销。' : '已重新设为待处理，下次交接会包含这条意见。');
  }
  function saveAnnotation() {
    const comment = $('comment-input').value.trim();
    if (!data || !pendingTarget || !comment) { note('请先选择批注目标并填写修改意见。', true); return; }
    if (data.annotations.length >= 10000 && !editingId) { note('单个副本最多支持 10000 条批注。', true); return; }
    const now = new Date().toISOString();
    const existing = editingId && data.annotations.find(annotation => annotation.id === editingId);
    if (pendingTarget.kind === 'page') pendingTarget.viewport = view();
    const annotation = {revision: existing ? core.annotationRevision(existing) + 1 : 1, status: 'open', history: existing?.history || [], id: existing?.id || id(), kind: pendingTarget.kind, comment, createdAt: existing?.createdAt || now, updatedAt: now, target: structuredClone(pendingTarget), view: view()};
    if (existing?.targetHistory) annotation.targetHistory = structuredClone(existing.targetHistory);
    const targetChanged = existing && JSON.stringify(existing.target) !== JSON.stringify(annotation.target);
    if (targetChanged) {
      if ((existing.targetHistory?.length || 0) >= 100) { note('这条意见已保留 100 次定位记录，请新建批注继续；当前意见和草稿已保留。',true); return; }
      annotation.targetHistory = [...(annotation.targetHistory || []), {revision:core.annotationRevision(existing),target:structuredClone(existing.target),...(existing.view ? {view:structuredClone(existing.view)} : {}),at:now}];
    }
    recordChange(existing || null, annotation, existing ? data.annotations.indexOf(existing) : data.annotations.length);
    if (existing) data.annotations[data.annotations.indexOf(existing)] = annotation;
    else data.annotations.push(annotation);
    locations.delete(annotation.id);
    manualLocationRequests.delete(annotation.id);
    guideAnnotated = true;
    markDirty(); clearEditor(); renderAnnotations(); window.HRUI.saved($('save-button'));
    startLocationReview();
    note(targetChanged ? '新位置已保存，原定位保留作记录；交给 agent 时会使用新的位置。' : existing ? '批注已更新。准备好后，点击「交给 agent」交付本轮意见。' : '批注已添加。准备好后，点击「交给 agent」；下载副本可留作备份。');
  }
  function recordChange(before, after, index) {
    undoStack.push({before: before ? structuredClone(before) : null, after: after ? structuredClone(after) : null, index});
    if (undoStack.length > 50) undoStack.shift();
    redoStack.length = 0;
  }
  function reverseChange(redo = false) {
    if (!data || busy) return;
    if (draftDirty()) { note('编辑框中有未保存的意见，请先保存或取消编辑，再撤销或重做。', true); return; }
    const from = redo ? redoStack : undoStack;
    const to = redo ? undoStack : redoStack;
    const change = from.pop();
    if (!change) return;
    for (const item of change.items || [change]) {
      const target = redo ? item.after : item.before;
      const changedId = (item.before || item.after).id;
      data.annotations = data.annotations.filter(annotation => annotation.id !== changedId);
      if (target) data.annotations.splice(Math.min(item.index, data.annotations.length), 0, structuredClone(target));
      locations.delete(changedId);
    }
    to.push(change);
    markDirty(); clearEditor(); setMode('browse'); renderAnnotations();
    startLocationReview();
    note(redo ? '已重做批注操作，下载可保存最新结果。' : '已撤销上次批注操作，原批注内容和位置已恢复。');
  }
  function locate(annotation) {
    if (core.annotationStatus(annotation) === 'resolved') { note('这条批注已完成，原文与位置保留作处理记录。需要继续修改时可编辑意见或重新待处理。'); return; }
    if (annotation.kind === 'page' && (annotation.target.scope === 'whole-document' || !annotation.target.selector)) {
      const width = annotation.view?.width || annotation.target.viewport?.width;
      const available = ['390', '768', '1280'];
      note(`整体批注：${data.source.name}。意见适用于整个文件；记录视口 ${width || '未知'} × ${annotation.view?.height || annotation.target.viewport?.height || '未知'}px。`);
      if (available.includes(String(width))) { $('preview-width').value = String(width); applyWidth(); }
      locations.set(annotation.id, {status: 'exact', message: '整体反馈 · 适用于整个文件'});
      renderAnnotations(); return;
    }
    if (!previewReady) { note('页面还在载入，请稍后定位。', true); return; }
    const token = id();
    manualLocationRequests.set(annotation.id, {token,revision:core.annotationRevision(annotation),target:JSON.stringify(annotation.target)});
    send('locate', {target: annotation.target, requestId: annotation.id,locationToken:token});
  }
  function edit(annotation) {
    if (draftDirty() && !confirm('编辑框中有未保存的修改。确定切换到这条批注吗？')) return;
    editingId = annotation.id;
    $('comment-input').value = annotation.comment;
    draftBaseline = annotation.comment;
    setMode(annotation.kind === 'page' && (annotation.target.scope === 'whole-document' || !annotation.target.selector) ? 'whole' : annotation.kind);
    const restoredTarget = structuredClone(annotation.target);
    if (annotation.kind === 'page' && !restoredTarget.selector) restoredTarget.scope = 'whole-document';
    setTarget(restoredTarget);
    locate(annotation);
    draftTargetChanged = false;
    updateEditor(); renderAnnotations();
    $('comment-input').focus();
  }
  function reselect(annotation) {
    if (busy || !previewReady) { note('文档还在载入，请稍后重新选择位置。',true); return; }
    if (draftDirty() && !confirm('编辑框中有未保存的修改。确定切换到这条批注并重新选择位置吗？')) return;
    editingId = annotation.id; draftBaseline = annotation.comment;
    $('comment-input').value = annotation.comment;
    pendingTarget = null; draftTargetChanged = false;
    $('target-preview').hidden = true; send('clear-selection'); send('clear-focus');
    setMode(annotation.kind === 'page' ? 'page' : annotation.kind);
    updateEditor(); renderAnnotations();
    note('在预览中重新选择位置，再点击「更新批注」。意见会保留，保存后原位置也会留作记录。');
  }
  async function download(requestedFormat) {
    if (draftDirty()) { note('编辑框中还有未保存的修改，请先点击「保存批注」或「更新批注」，再下载副本。', true); return; }
    await core.validateData(data);
    const format = requestedFormat || $('export-format').value;
    const basename = data.source.name.replace(/\.(html?|xhtml|docx)$/i, '').replace(/[\\/:*?"<>|]/g, '_') + '.review';
    if (format === 'annotations') {
      const blob = new Blob([core.serialize(core.createAnnotationExport(data), true)], {type: 'application/json;charset=utf-8'});
      downloadBlob(blob, basename + '.json');
      finishDownload(format, '已导出轻量批注，不含原文件快照和编辑界面。请将 JSON 与原文件一起交给 agent；DOCX JSON 可选择配套原文件恢复批注。');
      return;
    }
    const copy = document.documentElement.cloneNode(true);
    copy.querySelector('#html-review-data').textContent = core.serialize(data);
    const copiedFrame = copy.querySelector('#preview-frame');
    copiedFrame.removeAttribute('srcdoc'); copiedFrame.removeAttribute('src'); copiedFrame.hidden = true;
    for (const dialog of copy.querySelectorAll('dialog')) { dialog.removeAttribute('open'); dialog.removeAttribute('data-closing'); }
    for (const node of copy.querySelectorAll('[data-ui-transient],[data-site-only],.select-popover')) node.remove();
    for (const node of copy.querySelectorAll('[data-motion],[inert]')) { node.removeAttribute('data-motion'); node.removeAttribute('inert'); }
    for (const panel of copy.querySelectorAll('[data-settings-panel]')) panel.removeAttribute('aria-hidden');
    copy.querySelector('#page-select').replaceChildren();
    // Rebuilt on startup. Do not serialize transient editor/list state or duplicate page bytes.
    copy.querySelector('#annotation-list').replaceChildren();
    copy.querySelector('#review-progress').textContent = '意见与处理记录';
    copy.querySelector('#comment-input').textContent = '';
    copy.querySelector('#target-preview').hidden = true;
    for (const selector of ['#target-text', '#target-selector', '#target-kind']) copy.querySelector(selector).textContent = '';
    copy.querySelector('#data-preview').textContent = '';
    copy.querySelector('#agent-task-text').textContent = '';
    for (const selector of ['#handoff-source', '#handoff-summary', '#agent-task-help', '#copy-agent-status', '#document-outline', '#document-search-results', '#document-search-status']) copy.querySelector(selector).replaceChildren();
    copy.querySelector('#document-search').value = ''; copy.querySelector('#document-search').removeAttribute('value');
    copy.querySelector('#task-details').removeAttribute('open');
    copy.querySelector('#reload-review').hidden = true;
    for (const selector of ['#reload-review-summary','#reload-review-detail']) copy.querySelector(selector).textContent = '';
    copy.querySelector('#recovery-banner').hidden = true;
    copy.querySelector('#onboarding-card').hidden = true;
    copy.querySelector('#drop-overlay').hidden = true;
    copy.querySelector('#entry-select').replaceChildren();
    copy.querySelector('#entry-label').hidden = true;
    copy.querySelector('#status').hidden = true;
    copy.querySelector('#warnings').replaceChildren(); copy.querySelector('#warnings').hidden = true;
    copy.querySelector('#html-review-example').textContent = 'null';
    copy.querySelector('#pair-source').hidden=true;
    copy.querySelector('#cancel-conversion').hidden=true;
    copy.querySelector('#html-review-pending-annotations')?.remove();
    copy.querySelector('#example-button').hidden = true;
    const html = '<!doctype html>\n' + copy.outerHTML;
    let blob = new Blob([html], {type: 'text/html;charset=utf-8'});
    if (format === 'gzip') {
      if (typeof CompressionStream === 'undefined') throw new Error('当前浏览器不支持压缩副本，请选择 HTML 副本或轻量批注。');
      blob = new Blob([await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()], {type: 'application/gzip'});
    }
    downloadBlob(blob, basename + (format === 'gzip' ? '.html.gz' : '.html'));
    finishDownload(format, format === 'gzip' ? '已生成压缩副本。解压得到 .review.html 后可继续编辑；交给 agent 时请先用脚本提取批注。' : '已生成下载副本。请确认浏览器完成下载；以后直接打开该副本即可继续编辑。');
  }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function finishDownload(format, message) {
    dirty = false; lastExportFormat = format; updateSaveState(); note(message);
    delivered = true; updateGuide(); queueAutosave();
  }
  function updateExportFormat() {
    autosavePaused = false;
    const format = $('export-format').value;
    $('download-button').textContent = {html: '↓ 下载批注副本', gzip: '↓ 下载压缩副本', annotations: '↓ 导出轻量批注'}[format];
    window.HRUI.syncSelect('export-format');
    queueAutosave();
  }
  function applyWidth() {
    autosavePaused = false;
    const value = $('preview-width').value;
    window.HRUI.syncSelect('preview-width');
    frame.style.width = value === 'fluid' ? '100%' : `${Number(value)}px`;
    frame.style.minWidth = value === 'fluid' ? '0' : `${Number(value)}px`;
    if (pendingTarget?.kind === 'page') setTarget({...pendingTarget, viewport: view()});
    queueAutosave();
  }
  function setSidebarPosition(position, remember = true) {
    autosavePaused = false;
    const value = position === 'right' ? 'right' : 'left';
    workspace.dataset.sidebarPosition = value;
    $('sidebar-position').value = value;
    window.HRUI.syncSelect('sidebar-position');
    if (remember) {
      try { localStorage.setItem(sidebarPreferenceKey, value); } catch (_) { /* Layout still works when storage is unavailable. */ }
    }
    queueAutosave();
  }
  function preferredSidebarPosition(fallback) {
    try {
      const saved = localStorage.getItem(sidebarPreferenceKey);
      if (saved === 'left' || saved === 'right') return saved;
    } catch (_) { /* Exported copies retain their layout without browser storage. */ }
    return fallback;
  }
  function restoreSidebarPosition() {
    setSidebarPosition(preferredSidebarPosition(workspace.dataset.sidebarPosition), false);
  }

  function updateGuide() {
    $('onboarding-card').hidden = guideDismissed;
    const complete = {open: Boolean(data), annotate: Boolean(data?.annotations.length) && (!exampleWorkspace || guideAnnotated), deliver: delivered};
    for (const item of document.querySelectorAll('[data-guide-step]')) item.dataset.complete = String(complete[item.dataset.guideStep]);
  }
  function autosaveStatus(message, error = false) {
    $('autosave-state').textContent = message;
    $('autosave-state').classList.toggle('error', error);
    $('clear-recovery').disabled = !persistenceReady || busy || (!data && !cachedSession);
    $('retry-recovery').hidden = !error;
  }
  function sessionSnapshot() {
    return structuredClone({version: 1, data, localAccess, exampleWorkspace, guideAnnotated, draft: {comment: $('comment-input').value, pendingTarget, editingId, baseline: draftBaseline, targetChanged: draftTargetChanged, mode}, dirty, lastExportFormat,
      preferences: {width: $('preview-width').value, sidebar: $('sidebar-position').value, exportFormat: $('export-format').value}});
  }
  function queueAutosave() {
    if (!data || !persistenceReady || restoringSession || autosavePaused || !$('recovery-banner').hidden) return;
    ++autosaveRevision;
    autosavePhase = 'saving';
    autosaveStatus('正在保存到本机…');
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(saveSessionNow, 250);
  }
  async function saveSessionNow() {
    clearTimeout(autosaveTimer); autosaveTimer = null;
    if (!data || !persistenceReady || restoringSession || autosavePaused || !$('recovery-banner').hidden) return;
    const revision = autosaveRevision;
    const snapshot = sessionSnapshot();
    try {
      if (needsEpochRefresh) {
        await window.HRSession.load(recoveryKey);
        if (revision !== autosaveRevision || autosavePaused) return;
        needsEpochRefresh = false;
      }
      const saved = await window.HRSession.save(recoveryKey, snapshot);
      if (revision !== autosaveRevision) return;
      cachedSession = saved; autosavePhase = 'saved';
      try { sessionStorage.setItem(resumeKey, saved.data.source.sha256); } catch (_) {}
      autosaveStatus('本机已保存 · 刷新可恢复');
      const signal = {key:recoveryKey, action:'saved', at:Date.now()};
      try { recoveryChannel?.postMessage(signal); } catch (_) {}
      try { localStorage.setItem(recoverySignalKey, JSON.stringify(signal)); } catch (_) {}
    } catch (error) {
      if (revision !== autosaveRevision) return;
      if (error.name === 'StaleSessionError') needsEpochRefresh = true;
      autosavePhase = 'error';
      autosaveStatus('本机自动保存失败，请下载副本保留修改', true);
    }
  }
  async function validateSession(record) {
    if (!record || record.version !== 1 || !record.draft || !record.preferences || !Number.isFinite(Date.parse(record.savedAt))) throw new Error('恢复记录格式无效。');
    await core.validateData(record.data);
    const draft = record.draft;
    if (typeof draft.comment !== 'string' || draft.comment.length > 20000 || typeof draft.baseline !== 'string' || draft.baseline.length > 20000 || !['browse', 'text', 'element', 'page', 'whole'].includes(draft.mode)) throw new Error('恢复草稿无效。');
    if (draft.pendingTarget) core.validateTarget(draft.pendingTarget, draft.pendingTarget.kind);
    if (draft.editingId && !record.data.annotations.some(item => item.id === draft.editingId)) throw new Error('恢复批注不存在。');
    if (!['fluid', '390', '768', '1280'].includes(record.preferences.width) || !['left', 'right'].includes(record.preferences.sidebar) || !['html', 'gzip', 'annotations'].includes(record.preferences.exportFormat) || !['html', 'gzip', 'annotations'].includes(record.lastExportFormat)) throw new Error('恢复偏好无效。');
    return record;
  }
  async function restoreSession(record) {
    await validateSession(record);
    restoringSession = true;
    try {
      await activate(structuredClone(record.data)); resetFolder();
      localAccess = local.valid(record.localAccess);
      exampleWorkspace = Boolean(record.exampleWorkspace);
      guideAnnotated = Boolean(record.guideAnnotated);
      if (localAccess?.directoryHandle) {
        const entries = Array.isArray(localAccess.entries) ? localAccess.entries.filter(path => typeof path === 'string' && /\.(html?|xhtml|docx)$/i.test(path)) : [];
        if (!entries.includes(localAccess.entryPath)) entries.push(localAccess.entryPath);
        showFolderEntries(entries, localAccess.entryPath);
      }
      const draft = record.draft;
      mode = draft.mode === 'page' && draft.pendingTarget?.scope === 'whole-document' ? 'whole' : draft.mode; editingId = draft.editingId || null;
      pendingTarget = draft.pendingTarget ? structuredClone(draft.pendingTarget) : null;
      $('comment-input').value = draft.comment; draftBaseline = draft.baseline;
      // An older async session snapshot must not overwrite the latest layout choice.
      setSidebarPosition(preferredSidebarPosition(record.preferences.sidebar), false);
      $('preview-width').value = record.preferences.width; applyWidth();
      $('export-format').value = record.preferences.exportFormat; updateExportFormat();
      if (pendingTarget) setTarget(pendingTarget); else $('target-preview').hidden = true;
      draftTargetChanged = Boolean(draft.targetChanged); dirty = Boolean(record.dirty); lastExportFormat = record.lastExportFormat;
      for (const button of document.querySelectorAll('[data-mode]')) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
      document.querySelector('.mode-tabs').style.setProperty('--mode-index', (isDocx(data) ? ['browse','text','element','whole'] : ['browse','text','element','page','whole']).indexOf(mode));
      renderPageControls(); updateEditor(); updateSaveState(); renderAnnotations();
      cachedSession = record; autosavePhase = 'saved'; autosaveStatus('本机已保存 · 已恢复工作区与草稿');
      try { sessionStorage.setItem(resumeKey, record.data.source.sha256); } catch (_) {}
      note('已恢复上次的文件、批注和未保存的草稿。');
    } finally { restoringSession = false; }
  }
  async function initialize() {
    setBusy(true);
    let initial = null;
    let recovered = null;
    let recoveryError = '';
    try { initial = JSON.parse($('html-review-data').textContent); }
    catch (_) { note('批注数据不是有效 JSON，无法恢复。', true); }
    try { guideDismissed = Boolean(initial) || localStorage.getItem(guideKey) === 'true'; } catch (_) { guideDismissed = Boolean(initial); }
    try {
      recovered = await window.HRSession.load(recoveryKey);
      persistenceReady = true;
      if (recovered) {
        try { await validateSession(recovered); }
        catch (_) { recovered = null; recoveryError = '本机恢复记录损坏，未载入。请重新打开原文件或下载副本；之后可重新自动保存。'; autosaveStatus(recoveryError, true); }
      }
    } catch (_) { autosavePhase = 'error'; autosaveStatus('本机恢复不可用，请下载副本保留修改', true); }
    let resume = null;
    try { resume = sessionStorage.getItem(resumeKey); } catch (_) {}
    try {
      const sameSource = !initial || initial.source?.sha256 === recovered?.data.source.sha256;
      const currentCopy = !initial || Date.parse(initial.updatedAt) <= Date.parse(recovered?.savedAt || '');
      if (recovered && resume === recovered.data.source.sha256 && sameSource && currentCopy) await restoreSession(recovered);
      else {
        restoringSession = true;
        if (initial) await activate(initial);
        else { $('welcome').hidden = false; frame.hidden = true; }
        restoringSession = false;
        if (recovered && sameSource && currentCopy) {
          cachedSession = recovered;
          $('recovery-description').textContent = `本机有 ${recovered.data.source.name} 的恢复记录（${new Date(recovered.savedAt).toLocaleString()}）。`;
          $('recovery-banner').hidden = false;
          autosaveStatus('发现本机恢复记录，可选择继续');
        } else if (persistenceReady) autosaveStatus(data ? '自动恢复已就绪' : '自动恢复：等待打开文件');
      }
    } catch (error) { note(error.message || '无法恢复工作区。', true); }
    finally { restoringSession = false; setBusy(false); updateGuide(); }
    if (recoveryError) note(recoveryError, true);
    // A pending recovery choice must remain intact until the user acts or imports a file.
    if (data && !cachedSession) queueAutosave();
  }
  async function clearRecovery() {
    pauseRecovery();
    recoveryChannel?.postMessage({key: recoveryKey, action: 'clear'});
    try { localStorage.setItem(recoverySignalKey, JSON.stringify({key: recoveryKey, action: 'clear', nonce: id()})); } catch (_) {}
    restoringSession = true;
    try {
      await window.HRSession.remove(recoveryKey); cachedSession = null; autosavePaused = true;
      recoveryChannel?.postMessage({key: recoveryKey, action: 'cleared'});
      try { localStorage.setItem(recoverySignalKey, JSON.stringify({key: recoveryKey, action: 'cleared', nonce: id()})); } catch (_) {}
      try { sessionStorage.removeItem(resumeKey); } catch (_) {}
      $('recovery-banner').hidden = true; autosavePhase = 'idle';
      autosaveStatus('本机恢复记录已清除；下次修改会重新保存');
    } catch (_) { autosaveStatus('无法清除本机恢复记录，请重试', true); }
    finally { restoringSession = false; }
  }
  async function retryRecovery() {
    try {
      const recovered = await window.HRSession.load(recoveryKey);
      persistenceReady = true; needsEpochRefresh = false;
      if (data) { autosavePaused = false; queueAutosave(); }
      else if (recovered) {
        await validateSession(recovered); cachedSession = recovered;
        $('recovery-description').textContent = `本机有 ${recovered.data.source.name} 的恢复记录（${new Date(recovered.savedAt).toLocaleString()}）。`;
        $('recovery-banner').hidden = false; autosaveStatus('发现本机恢复记录，可选择继续');
      } else autosaveStatus('自动恢复：等待打开文件');
    } catch (_) { autosaveStatus('本机恢复仍不可用，请下载副本保留修改', true); }
  }
  function prepareHandoff() {
    const counts = {new:0, updated:0, pending:0, completed:0};
    for (const annotation of data.annotations) ++counts[core.taskState(annotation)];
    const categories = [['new','新增'], ['updated','已更新'], ['pending','已回报仍待处理']].filter(([key]) => counts[key]).map(([key,label]) => `${label} ${counts[key]}`);
    $('handoff-summary').textContent = `待完成 ${data.annotations.length-counts.completed} · 已完成 ${counts.completed}\n` + (categories.join(' · ') || '所有意见已完成，新想法可以继续添加批注。');
    $('handoff-source').textContent = data.source.name;
    $('agent-task-help').textContent = isDocx(data) ? '附上这份原始 DOCX（Word 文件），不需要另存 HTML。工具只做预览和批注。' : '附上原始 HTML；若有本地图片、样式或脚本，请一起提供。';
    $('agent-task-text').value = core.createAgentTask(data);
    $('task-details').open = false;
    $('copy-agent-status').textContent = '复制后，粘贴到你使用的 agent 对话中。';
    $('handoff-reload').disabled = busy || !data;
  }
  function openHandoff() {
    if (busy || !data?.annotations.length || draftDirty()) return;
    prepareHandoff(); window.HRUI.openDialog($('agent-task-dialog'));
  }
  function renderDocumentNavigation(results, total = 0) {
    const query = $('document-search').value.trim();
    $('document-outline').hidden = Boolean(query);
    $('document-search-results').hidden = !query;
    const list = query ? $('document-search-results') : $('document-outline'); list.replaceChildren();
    const items = query ? results || [] : documentOutline;
    $('document-search-status').textContent = query ? (results ? `找到 ${total} 处${total > items.length ? '，显示前 ' + items.length + ' 处' : ''}` : '正在查找…') : '选择标题，直接跳到对应内容。';
    for (const item of items) {
      const button = textNode('button', 'document-nav-item', item.text); button.type = 'button';
      if (!query) button.style.paddingLeft = (12 + Math.min(item.level - 1, 4) * 12) + 'px';
      button.addEventListener('click', () => { send('navigate-document', {kind:query ? 'search' : 'outline', index:item.index, query}); window.HRUI.closeDialog($('document-nav-dialog')); });
      list.append(button);
    }
    if (!items.length && (!query || results)) list.append(textNode('p', 'navigation-empty', query ? '没有找到匹配内容，请换一个关键词。' : '这份文档没有标题，可以使用上方查找。'));
  }
  async function copyAgentTask() {
    if (!data || !data.annotations.length || busy) return;
    if (draftDirty()) { note('编辑框中有未保存的意见，请先保存或取消编辑，再复制任务。', true); return; }
    prepareHandoff();
    try {
      await navigator.clipboard.writeText($('agent-task-text').value); note(isDocx(data) ? '修改任务已复制，请连同原始 DOCX 交给 agent。' : '修改任务已复制，请连同原 HTML 和资源交给 agent。');
      const help = textNode('button', 'text-button', '查看交接步骤'); help.type = 'button'; help.addEventListener('click', openHandoff); $('status').append(' ', help);
    }
    catch (_) { $('task-details').open = true; $('copy-agent-status').textContent = '请选中下方任务，按 Ctrl / ⌘ + C 复制。'; window.HRUI.openDialog($('agent-task-dialog')); $('agent-task-text').focus(); $('agent-task-text').select(); }
    delivered = true; updateGuide();
  }
  function cancelEditor() {
    if (!draftDirty() || confirm('确定放弃编辑框中尚未保存的修改吗？')) { clearEditor(); setMode('browse'); renderAnnotations(); }
  }
  function shortcut(action) {
    if (action === 'escape' && busy) { window.HRDocx.cancel(); return; }
    if (action === 'escape' && window.HRUI.closeMenu(true)) return;
    const dialog = document.querySelector('dialog[open]');
    if (dialog) { if (action === 'escape') window.HRUI.closeDialog(dialog); return; }
    if (busy) return;
    if (action === 'help') { window.HRUI.openSettings('shortcuts'); return; }
    if (action === 'open') { openHTML(); return; }
    if (action === 'download') { if (data) run(download); return; }
    if (action === 'undo' || action === 'redo') { reverseChange(action === 'redo'); return; }
    if (!data) return;
    if (action === 'save') { saveAnnotation(); return; }
    if (action === 'escape') {
      if (pendingTarget && pendingTarget.scope !== 'whole-document') clearTarget();
      else if (editingId || $('comment-input').value) cancelEditor();
      else setMode('browse');
    } else if (['browse', 'text', 'element', 'page', 'whole'].includes(action)) setMode(action);
  }
  async function droppedFiles(files) {
    $('drop-overlay').hidden = true;
    await bootPromise;
    if (busy) return;
    if (files.length !== 1 || !/\.(html?|xhtml|docx|json)$/i.test(files[0]?.name || '')) { note('请一次拖入一个 HTML、DOCX 或轻量批注 JSON；HTML 资源请使用「导入文件夹」。', true); return; }
    if (!confirmDiscard()) return;
    await run(() => importSelectedFile(files[0]));
  }
  function seedExample(nextData) {
    const parsed = new DOMParser().parseFromString(core.getSourceText(nextData), 'text/html');
    const element = parsed.querySelector('#card-collaborate');
    const textElement = parsed.querySelector('#cross-node-text');
    const textPath = [];
    for (let node = textElement; node !== parsed.documentElement; node = node.parentNode) {
      textPath.unshift(Array.from(node.parentNode.childNodes).indexOf(node));
    }
    const now = new Date().toISOString();
    const viewport = {width: 1280, height: 800, devicePixelRatio: 1};
    const targets = [
      {kind: 'text', selector: '#cross-node-text', quote: {exact: textElement.textContent, prefix: '', suffix: ''},
        range: {start: {path: textPath, offset: 0}, end: {path: textPath.slice(), offset: textElement.childNodes.length}}},
      {kind: 'element', selector: '#card-collaborate', tag: 'article', id: element.id, classes: ['card'], text: element.textContent.replace(/\s+/g, ' ').trim()},
      {kind: 'page', text: nextData.source.name, scope: 'whole-document', context: {sourcePath: nextData.source.path}, viewport}
    ];
    nextData.annotations = targets.map((target, index) => ({id: 'seeded-demo-' + target.kind, kind: target.kind, target, comment: ['这里演示跨标签文字批注：请把这句话改得更简洁。', '这里演示卡片批注：请增加协作流程的例子。', '这里演示整体批注：请统一全页的标题层级与留白。'][index], createdAt: now, updatedAt: now, view: viewport}));
    return nextData;
  }

  window.addEventListener('message', event => {
    const message = event.data;
    if (event.source !== frame.contentWindow || !message || message.hr !== true || message.channel !== channel || !data) return;
    if (message.event === 'external-link' && isDocx(data)) {
      if(typeof message.url==='string' && /^(https?:|mailto:)/i.test(message.url)) window.open(message.url,'_blank','noopener,noreferrer');
    } else if (message.event === 'shortcut') { if (typeof message.action === 'string') shortcut(message.action); }
    else if (message.event === 'file-drag') $('drop-overlay').hidden = false;
    else if (message.event === 'dropped-files') { if (Array.isArray(message.files) && message.files.every(file => file instanceof File)) droppedFiles(message.files); }
    else if (message.event === 'ready') { previewReady = true; send('set-mode', {mode: mode === 'whole' ? 'browse' : mode}); updateEditor(); startLocationReview(); }
    else if (message.event === 'targets-checked') {
      if (!locationRequest || message.requestId !== locationRequest.id || !Array.isArray(message.items) || message.items.length !== locationRequest.items.length) return;
      const expected = new Map(locationRequest.items.map(item => [item.id,item]));
      const seen = new Set();
      if (!message.items.every(item => expected.has(item.id) && !seen.has(item.id) && (seen.add(item.id),true) && item.revision === expected.get(item.id).revision && ['exact','fallback','ambiguous','missing'].includes(item.status) && typeof item.reason === 'string' && item.reason.length <= 1000)) return;
      clearTimeout(locationTimer);
      for (const item of message.items) {
        const annotation = data.annotations.find(annotation => annotation.id === item.id);
        if (!annotation || core.annotationStatus(annotation) !== 'open' || core.annotationRevision(annotation) !== item.revision || JSON.stringify(annotation.target) !== JSON.stringify(expected.get(item.id).target)) continue;
        locations.set(item.id, {status:item.status,message:locationDescription(item.status,item.reason)});
      }
      locationRequest = null;
      renderLocationReview(); locationTimer = setTimeout(nextLocationBatch,0);
    }
    else if (message.event === 'document-outline' && isDocx(data)) {
      if (!Array.isArray(message.items) || message.items.length > 1000 || !message.items.every(item => Number.isInteger(item.index) && item.index >= 0 && typeof item.text === 'string' && item.text.length <= 160 && item.level >= 1 && item.level <= 6)) return;
      documentOutline = message.items; renderDocumentNavigation();
    } else if (message.event === 'document-search' && isDocx(data)) {
      if (message.query !== $('document-search').value.trim() || !Array.isArray(message.items) || message.items.length > 50 || !Number.isInteger(message.total) || message.total < 0 || !message.items.every(item => Number.isInteger(item.index) && item.index >= 0 && typeof item.text === 'string' && item.text.length <= 220)) return;
      renderDocumentNavigation(message.items, message.total);
    }
    else if (message.event === 'pages') {
      if (!Array.isArray(message.pages) || message.pages.length > 1000 || !message.pages.every((item, index) => item.index === index + 1 && typeof item.title === 'string' && item.title.length <= 100)) return;
      pageInventory = message.pages;
      const selected = pendingTarget?.scope === 'page' ? String(pendingTarget.pageIndex) : '';
      $('page-select').replaceChildren(new Option('点击预览或选择页面', ''), ...pageInventory.map(item => new Option(`${String(item.index).padStart(2, '0')} · ${item.title}`, String(item.index))));
      $('page-select').value = selected; window.HRUI.syncSelect('page-select'); renderPageControls();
    }
    else if (message.event === 'target-cleared' && message.kind === 'text' && mode === 'text' && pendingTarget?.kind === 'text') clearTarget();
    else if (message.event === 'target') {
      if (!['text', 'element', 'page'].includes(mode)) return;
      try {
        const serialized = JSON.stringify(message.target);
        if (!serialized || serialized.length > 250000) throw new Error('选中范围过大，请缩小范围。');
        const target = JSON.parse(serialized);
        if (!target || target.kind !== mode || typeof target.selector !== 'string' || target.selector.length > 4096) return;
        core.validateTarget(target, target.kind);
        setTarget(target); note(editingId ? '新位置已选中，点击「更新批注」保存；原位置会保留作记录。' : '目标已选中，请填写修改意见。');
      } catch (error) { note(error.message, true); }
    } else if (message.event === 'located') {
      const request = manualLocationRequests.get(message.requestId);
      const annotation = data.annotations.find(annotation => annotation.id === message.requestId);
      if (!request || request.token !== message.locationToken || !annotation || core.annotationStatus(annotation) !== 'open' || core.annotationRevision(annotation) !== request.revision || JSON.stringify(annotation.target) !== request.target || !['exact', 'fallback', 'ambiguous', 'missing'].includes(message.status)) return;
      manualLocationRequests.delete(message.requestId);
      const description = locationDescription(message.status);
      const reason = typeof message.reason === 'string' ? message.reason.slice(0, 500) : '';
      locations.set(message.requestId, {status: message.status, message: description + (reason ? ' · ' + reason : '')});
      renderAnnotations(); note(description, ['missing', 'ambiguous'].includes(message.status));
    } else if (message.event === 'warning' && typeof message.message === 'string') note(message.message.slice(0, 1500), true);
  });
  $('cancel-conversion').addEventListener('click',()=>{ if (!cancelPicker()) window.HRDocx.cancel(); });
  $('pair-source-button').addEventListener('click',()=>openHTML());
  $('pair-compatible').addEventListener('click',()=>openCompatible());
  $('cancel-pair').addEventListener('click',()=>{pendingLight=null;$('pair-source').hidden=true;note('已取消恢复，当前工作区已保留。');});
  $('open-button').addEventListener('click', () => openHTML());
  $('welcome-open').addEventListener('click', () => openHTML());
  $('handoff-button').addEventListener('click', openHandoff);
  $('document-nav-button').addEventListener('click', () => { renderDocumentNavigation(); window.HRUI.openDialog($('document-nav-dialog')); $('document-search').focus(); });
  $('document-search').addEventListener('input', () => {
    clearTimeout(searchTimer); renderDocumentNavigation();
    const query = $('document-search').value.trim();
    if (query) searchTimer = setTimeout(() => send('search-document', {query}), 150);
  });
  $('handoff-import-results').addEventListener('click', () => { window.HRUI.closeDialog($('agent-task-dialog')); $('results-input').click(); });
  $('handoff-reload').addEventListener('click', () => { window.HRUI.closeDialog($('agent-task-dialog')); reloadSource(); });
  $('handoff-export-json').addEventListener('click', () => run(() => download('annotations')));
  $('review-attention').addEventListener('click', () => { $('annotation-filter').value = 'attention'; window.HRUI.syncSelect('annotation-filter'); renderAnnotations(); $('annotation-list').scrollIntoView({block:'nearest',behavior:'smooth'}); });
  $('review-retry').addEventListener('click', startLocationReview);
  $('review-dismiss').addEventListener('click', () => { if (locationReview) locationReview.dismissed = true; renderLocationReview(); });
  $('compatible-open').addEventListener('click', () => { window.HRUI.closeDialog($('settings-dialog')); openCompatible(); });
  $('compatible-folder').addEventListener('click', () => { window.HRUI.closeDialog($('settings-dialog')); openCompatible(false, true); });
  $('compatible-reload').addEventListener('click', () => {
    if (!data || busy || exampleWorkspace) return;
    window.HRUI.closeDialog($('settings-dialog'));
    openCompatible(true, Boolean(folderFiles || data.resources.length || localAccess?.directoryHandle));
  });
  $('folder-button').addEventListener('click', () => openDirectory());
  $('file-input').addEventListener('change', async event => {
    const file = event.target.files[0]; event.target.value = '';
    const reloading = reloadSelection === 'file'; reloadSelection = null;
    await bootPromise;
    if (!file || (!reloading && !confirmDiscard())) return;
    await run(() => importSelectedFile(file, null, reloading));
  });
  $('folder-input').addEventListener('change', async event => {
    const files = Array.from(event.target.files); event.target.value = '';
    const reloading = reloadSelection === 'directory'; reloadSelection = null;
    await bootPromise;
    if (!files.length) return;
    await run(() => importDirectory(files, null, reloading));
  });
  $('entry-select').addEventListener('change', async event => {
    const path = event.target.value;
    if (!confirmDiscard()) { event.target.value = currentEntryPath; return; }
    await run(async () => { try { await openFolderEntry(path); } catch (error) { $('entry-select').value = currentEntryPath; throw error; } });
  });
  async function openExample() {
    if (!confirmDiscard()) return;
    const example = JSON.parse($('html-review-example').textContent);
    const nextData = await core.importSource({bytes: core.base64ToBytes(example.base64), name: example.name});
    await activate(seedExample(nextData)); resetFolder(); exampleWorkspace = true; queueAutosave();
  }
  $('example-button').addEventListener('click', () => run(openExample));
  for (const button of document.querySelectorAll('[data-mode]')) button.addEventListener('click', () => { if (data) setMode(button.dataset.mode); });
  $('comment-input').addEventListener('input', () => { autosavePaused = false; updateEditor(); });
  $('save-button').addEventListener('click', saveAnnotation);
  $('cancel-edit').addEventListener('click', cancelEditor);
  $('parent-target').addEventListener('click', () => send('parent-target'));
  $('clear-target').addEventListener('click', clearTarget);
  $('export-format').addEventListener('change', () => {
    updateExportFormat();
    if ($('export-format').value === 'annotations') note(isDocx(data) ? '轻量批注不含原文件快照，请将 JSON 与原始 DOCX 一起保留、交给 agent；原文件匹配后可恢复批注。' : '轻量批注不包含原文件快照或编辑界面，请与原始 HTML 和相关资源一起保留、交给 agent。');
    else if ($('export-format').value === 'gzip') note('压缩副本保留完整快照和批注，解压后可继续编辑。');
  });
  $('download-button').addEventListener('click', () => run(download));
  $('reload-preview').addEventListener('click', reloadSource);
  $('page-select').addEventListener('change', event => { if (mode === 'page' && event.target.value) send('select-page', {index: Number(event.target.value)}); });
  $('preview-width').addEventListener('change', applyWidth);
  $('sidebar-position').addEventListener('change', event => setSidebarPosition(event.target.value));
  $('annotation-list').addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button || !data) return;
    const annotation = data.annotations.find(item => item.id === button.dataset.id);
    if (!annotation) return;
    if (button.dataset.action === 'locate') locate(annotation);
    else if (button.dataset.action === 'edit') edit(annotation);
    else if (button.dataset.action === 'reselect') reselect(annotation);
    else if (button.dataset.action === 'status') { try { toggleStatus(annotation); } catch (error) { note(error.message, true); } }
    else if (button.dataset.action === 'delete') {
      if (draftDirty()) { note('编辑框中有未保存的意见，请先保存或取消编辑，再删除批注。', true); return; }
      if (!confirm('确定删除这条批注吗？可使用撤销恢复。')) return;
      recordChange(annotation, null, data.annotations.indexOf(annotation));
      data.annotations = data.annotations.filter(item => item.id !== annotation.id);
      if (editingId === annotation.id) clearEditor();
      locations.delete(annotation.id); markDirty(); renderAnnotations(); updateEditor(); note('批注已删除，可撤销恢复；下载新副本即可保存。');
      startLocationReview();
    }
  });
  $('data-button').addEventListener('click', () => {
    const summary = { ...data, source: {...data.source, base64: `[已省略 ${data.source.byteLength} 个原始字节]`}, resources: data.resources.map(resource => ({...resource, base64: '[已省略资源字节]'})) };
    $('data-preview').textContent = JSON.stringify(summary, null, 2); window.HRUI.openDialog($('data-dialog'));
  });
  $('undo-button').addEventListener('click', () => reverseChange());
  $('redo-button').addEventListener('click', () => reverseChange(true));
  $('copy-agent-task').addEventListener('click', copyAgentTask);
  $('annotation-filter').addEventListener('change', renderAnnotations);
  $('import-results').addEventListener('click', () => $('results-input').click());
  $('results-input').addEventListener('change', async event => {
    const file = event.target.files[0]; event.target.value = '';
    if (file && data) await run(() => importResults(file));
  });
  $('copy-agent-text').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('agent-task-text').value); $('copy-agent-status').textContent = '已复制。请附上原文档，再粘贴到 agent 对话中。'; delivered = true; updateGuide(); queueAutosave(); }
    catch (_) { $('task-details').open = true; $('agent-task-text').focus(); $('agent-task-text').select(); $('copy-agent-status').textContent = '已选中，请按 Ctrl / ⌘ + C 复制。'; }
  });
  $('onboarding-dismiss').addEventListener('click', () => { guideDismissed = true; try { localStorage.setItem(guideKey, 'true'); } catch (_) {} updateGuide(); });
  $('restart-guide').addEventListener('click', () => { guideDismissed = false; try { localStorage.removeItem(guideKey); } catch (_) {} window.HRUI.closeDialog($('settings-dialog')); updateGuide(); });
  $('recover-session').addEventListener('click', () => run(async () => { const record = cachedSession; if (record && (!data || confirmDiscard())) await restoreSession(record); }));
  $('discard-session').addEventListener('click', () => run(clearRecovery));
  $('clear-recovery').addEventListener('click', () => run(clearRecovery));
  $('retry-recovery').addEventListener('click', () => run(retryRecovery));
  window.addEventListener('keydown', event => {
    const editable = event.composedPath().some(node => node instanceof Element && (node.matches('input,textarea,select') || node.isContentEditable));
    if (event.key !== 'Escape' && event.composedPath().some(node => node instanceof Element && node.matches('[role=combobox],[role=option]'))) return;
    const action = window.HRShortcut(event, editable);
    if (action) { event.preventDefault(); shortcut(action); }
  }, true);
  const hasFiles = event => Array.from(event.dataTransfer?.types || []).includes('Files');
  document.addEventListener('dragenter', event => { if (hasFiles(event)) { event.preventDefault(); $('drop-overlay').hidden = false; } });
  document.addEventListener('dragover', event => { if (hasFiles(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; $('drop-overlay').hidden = false; } });
  document.addEventListener('dragleave', event => { if (!event.relatedTarget || (event.clientX <= 0 || event.clientY <= 0)) $('drop-overlay').hidden = true; });
  document.addEventListener('drop', event => { if (hasFiles(event)) { event.preventDefault(); droppedFiles(Array.from(event.dataTransfer.files)); } });
  window.addEventListener('blur', () => { $('drop-overlay').hidden = true; });
  window.addEventListener('beforeunload', event => { if ((dirty || draftDirty()) && autosavePhase !== 'saved') { saveSessionNow(); event.preventDefault(); event.returnValue = ''; } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && autosavePhase === 'saving') saveSessionNow(); });
  // Exports carry the runtime, not transient DOM. Rehydrate only validated data.
  restoreSidebarPosition(); updateExportFormat(); resetFolder(); clearEditor(); setMode('browse'); applyWidth();
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.removeAttribute('open');
  bootPromise = initialize();
  // A trial link opens the example once; existing work and pending recovery take priority.
  bootPromise.then(async () => {
    const pending=document.getElementById('html-review-pending-annotations');
    if(pending?.textContent && pending.textContent.trim()!=='null') {
      try {const imported=JSON.parse(pending.textContent);await core.validateAnnotationExport(imported);pendingLight=imported;$('pair-source').hidden=false;note('请选配套原始 DOCX 恢复轻量批注。');}catch(error){note(error.message,true);}
    }
    if (new URL(location.href).searchParams.get('demo') === '1' && !data && !cachedSession) return run(openExample);
  });
})();
