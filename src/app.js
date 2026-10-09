(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const core = window.HRCore;
  const local = window.HRLocalFiles;
  const adapters = window.HRAdapters;
  const pdfPreview = $('pdf-preview');
  const frame = $('preview-frame');
  const workspace = document.querySelector('.workspace');
  const sidebarPreferenceKey = 'html-review.sidebar-position';
  const recoveryKey = 'workspace:' + location.href.split('#')[0];
  const resumeKey = 'html-review.resume:' + recoveryKey;
  const guideKey = 'html-review.guide-dismissed';
  const labels = {text: '文字', element: '元素', region: '区域', page: '单页'};
  const wholeTarget = target => target.scope === 'whole-document' || (!target.pdf && target.kind === 'page' && !target.selector);
  const targetLabel = target => target.kind === 'page' && wholeTarget(target) ? '整体' : labels[target.kind];
  let pageInventory = [];
  let renderedIds = new Set();
  const expandedAnnotations = new Set();
  let activeAnnotationId = null;
  let layout = null;
  const hints = {
    browse: '自由阅读。直接填写意见，默认针对整份文档；局部意见请先选择批注范围。',
    text: '在预览中拖选文字，再填写修改意见。可跨越相邻的行内标签。',
    element: '点击预览中的元素；使用「选父级容器」可指定卡片、区块等布局区域。',
    page: '选择 HTML 中已有的幻灯片或打印页：点击页面，或从下方列表选择。'
  };
  let data = null;
  let pendingLight = null;
  const isDocx = value => value?.source?.type === 'docx';
  const isPdf = value => value?.source?.type === 'pdf';
  const hasSearch = value => isDocx(value) || isPdf(value);
  let mode = 'browse';
  let channel = '';
  let previewReady = false;
  let latestSelectionSerial = 0;
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
  let locationInspection = null;
  let resultReviewQueue = null;
  let workflowDetailsOpen = null;
  let workflowDisclosureAlert = '';
  let lastScopeKey = '';
  let workflow = {handoffStamp:'',documentRead:false,documentChanged:false,resultsRead:false,needsDocument:false};
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
    $('cancel-conversion').textContent = pendingPicker ? '取消选择' : '取消读取 / 转换';
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
    updateEditor(false);
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
    return {width: Math.round((isPdf(data) ? pdfPreview : frame).clientWidth), height: Math.round((isPdf(data) ? pdfPreview : frame).clientHeight), devicePixelRatio: window.devicePixelRatio || 1};
  }
  function pageTarget() {
    return {kind: 'page', text: data.source.name, scope: 'whole-document', context: {sourcePath: data.source.path}, viewport: view(), ...(isPdf(data) ? {pdf:{adapterVersion:'1',sourceSha256:data.source.sha256,pages:[]}} : {}), ...(isDocx(data) ? {docx:{adapterVersion:'1',sourceSha256:data.source.sha256,blocks:[]}} : {})};
  }
  function send(command, extra = {}) {
    if (channel) adapters.command(command, extra, frame, channel);
  }
  function setMode(next) {
    // Keep older callers and saved workspaces compatible with the merged mode.
    if (next === 'whole') next = 'browse';
    if (!['browse', 'text', 'element', 'page'].includes(next)) return;
    if (next === 'page' && isDocx(data)) return;
    autosavePaused = false;
    mode = next;
    if(next!=='text')$('pdf-scan-guide').hidden=true;
    for (const button of document.querySelectorAll('[data-mode]')) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    send('set-mode', {mode});
    if (data && mode === 'browse' && !editingId) {
      send('clear-focus');
      setTarget(pageTarget());
    } else if (mode !== 'browse' && pendingTarget && (pendingTarget.kind !== (isPdf(data) && mode === 'element' ? 'region' : mode) || (mode === 'page' && pendingTarget.scope === 'whole-document'))) {
      pendingTarget = null;
      draftTargetChanged = true;
      $('target-preview').hidden = true;
      send('clear-focus');
    }
    document.querySelector('.mode-tabs').style.setProperty('--mode-index', Array.from(document.querySelectorAll('.mode-tabs [data-mode]')).filter(button => !button.hidden).findIndex(button => button.dataset.mode === mode));
    renderPageControls();
    updateEditor();
  }
  function renderPageControls() {
    $('page-controls').hidden = mode !== 'page';
    $('page-select').disabled = busy || !pageInventory.length;
    $('page-description').textContent = isPdf(data) ? `PDF 共 ${pageInventory.length} 页。可点击预览或选择页码。` : pageInventory.length ? `识别到 ${pageInventory.length} 个分页区块，也可直接点击预览选择。` : '未发现明确的分页区块。连续页面可使用整体或元素批注。';
  }
  function targetText(target) {
    if (target.kind === 'page') return wholeTarget(target) ? `整个文件 · ${data.source.name}` : `第 ${target.pageIndex || '?'} 页 · ${target.pageTitle || target.text || '分页区块'}`;
    return target.quote?.exact || target.text || target.attributes?.alt || `<${target.tag || '元素'}> ${target.selector || ''}`;
  }
  function setTarget(target) {
    if(isDocx(data) || isPdf(data)) {try {(isPdf(data) ? core.validatePdfTarget : core.validateDocxTarget)(target);} catch(error) {pendingTarget=null;$('target-preview').hidden=true;send('clear-focus');updateEditor();note(error.message,true);return;} }
    autosavePaused = false;
    pendingTarget = target;
    draftTargetChanged = true;
    $('target-preview').hidden = wholeTarget(target);
    $('target-preview').dataset.expanded = 'false';
    $('target-summary-toggle').setAttribute('aria-expanded', 'false');
    $('target-summary-toggle').textContent = '展开摘要';
    $('target-kind').textContent = targetLabel(target) || '目标';
    const text = targetText(target);
    $('target-text').textContent = text.length > 600 ? text.slice(0, 600) + '…' : text;
    $('target-summary-toggle').hidden = wholeTarget(target) || text.length <= 80;
    const docxBlock=target.docx?.blocks[0];
    $('target-selector').textContent = isDocx(data) ? (target.scope==='whole-document' ? '整个 DOCX 文档' : docxBlock?.table ? `表格 · 第 ${docxBlock.table.row} 行 / 第 ${docxBlock.table.column} 列` : docxBlock?.image ? '文档图片' : docxBlock?.part==='word/footnotes.xml' ? '脚注内容' : docxBlock?.part==='word/endnotes.xml' ? '尾注内容' : '正文内容') : target.selector || `视口 ${target.viewport?.width || view().width} × ${target.viewport?.height || view().height}px`;
    $('parent-target').hidden = target.kind !== 'element';
    if (target.kind === 'page' && ['page','single-page'].includes(target.scope)) { $('page-select').value = String(target.pageIndex); window.HRUI.syncSelect('page-select'); }
    updateEditor();
  }
  function updateEditor(persistDraft = true) {
    $('handoff-button').hidden = !data?.annotations.length;
    $('handoff-button').disabled = busy || !data?.annotations.length || draftDirty();
    renderResultReview();
    $('handoff-button').title = draftDirty() ? '先保存或取消编辑框中的意见' : '查看需要交给 agent 的文件与任务';
    $('document-nav-button').hidden = !hasSearch(data);
    $('document-nav-button').disabled = busy || !previewReady;
    $('compatible-reload').disabled = busy || !data || exampleWorkspace;
    $('undo-button').disabled = busy || !undoStack.length;
    $('redo-button').disabled = busy || !redoStack.length;

    $('retry-recovery').disabled = busy;
    $('import-results').disabled = busy || !data;
    $('clear-target').hidden = !pendingTarget || pendingTarget.scope === 'whole-document';
    $('clear-target').disabled = busy;
    updateScopeSummary();
    $('mode-hint').hidden = Boolean(data && pendingTarget && !(mode === 'browse' && editingId && !wholeTarget(pendingTarget)));
    $('mode-hint').textContent = data ? (mode === 'browse' && editingId ? '可以正常阅读和点击页面。正在编辑已有批注，修改意见仍对应下方目标。' : isPdf(data) && mode === 'element' ? '在页面上拖出矩形区域，再填写修改意见。' : isDocx(data) && mode === 'element' ? '点击段落、表格或图片，再写意见。需要更大范围时，可继续扩大选择。' : isPdf(data) && mode === 'page' ? '点击 PDF 页面，或从列表选择实际页码。' : hints[mode]) : '先打开 HTML、DOCX 或 PDF，或体验下方示例。';
    $('comment-input').disabled = !data || busy;
    $('save-button').disabled = !data || busy || !pendingTarget || !$('comment-input').value.trim();
    $('draft-status').textContent = draftDirty() ? '尚未保存' : '';
    $('save-button').textContent = editingId ? '更新批注' : '保存批注';
    $('editor-title').textContent = editingId ? '编辑批注' : '添加批注';
    $('cancel-edit').hidden = !editingId && (!pendingTarget || pendingTarget.kind === 'page') && !$('comment-input').value;
    renderPageControls();
    updateGuide();
    if (persistDraft) queueAutosave();
  }
  function updateScopeSummary() {
    const target = pendingTarget;
    const label = !data ? '等待打开文档' : !target ? ({text:'请先选择文字',element:isPdf(data) ? '请先框选区域' : '请先选择元素',page:'请先选择页面'}[mode] || '请先选择范围') : wholeTarget(target) ? '整份文档' : target.kind === 'page' ? `第 ${target.pageIndex || '?'} 页` : {text:'所选文字',region:'所选区域',element:'所选元素'}[target.kind] || '所选范围';
    const badge = $('comment-scope');
    if (badge.textContent !== label) badge.textContent = label;
    badge.dataset.state = !data ? 'idle' : target ? 'ready' : 'waiting';
    const key = JSON.stringify([label, editingId, target && targetText(target).slice(0,600)]);
    if (key !== lastScopeKey) { lastScopeKey = key; if (data && previewReady) window.HRUI.scopeChanged(badge, target && !wholeTarget(target) ? $('target-preview') : null); }
  }
  function clearEditor(afterSave = false) {
    pendingTarget = null;
    $('page-select').value = ''; window.HRUI.syncSelect('page-select');
    editingId = null;
    draftBaseline = '';
    draftTargetChanged = false;
    $('comment-input').value = '';
    $('target-preview').hidden = true;
    send('clear-selection',afterSave && !isPdf(data) ? {throughSelectionSerial:latestSelectionSerial} : {});
    if (data && mode === 'browse') setTarget(pageTarget());
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
    note('已取消选择，修改意见已保留。请重新选择目标，或回到「浏览」填写整份文档的意见。');
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
    const docx = isDocx(data), pdf = isPdf(data);
    workspace.classList.add('has-document');
    layout?.refresh();
    $('format-note').hidden = !docx && !pdf;
    $('format-note').textContent = pdf ? 'PDF 按实际页面预览，可选择文字、区域、单页或整体。扫描页可使用区域批注。' : docx ? 'Word 内容预览：可以批注文字、表格和图片；排版可能与 Word 不同。' : '';
    frame.title = docx ? 'DOCX 文档内容预览' : '原始 HTML 页面';
    document.querySelector('.preview-section').setAttribute('aria-label', pdf ? 'PDF 文档预览' : docx ? 'Word 文档预览' : 'HTML 页面预览');
    document.querySelector('[data-mode=page]').hidden = docx;
    document.querySelector('.mode-tabs').classList.toggle('is-docx',docx);
    document.querySelectorAll('[data-docx-hide]').forEach(node=>node.hidden=docx);
    $('source-name').textContent = data.source.name;
    $('preview-label').textContent = data.source.name;
    document.title = `${data.source.name} · HTML 批注`;
    $('welcome').hidden = true;
    frame.hidden = pdf;
    pdfPreview.hidden = !pdf; $('pdf-controls').hidden = !pdf;
    document.querySelector('[data-mode=element]').textContent = pdf ? '区域' : '元素';
    $('preview-width').closest('.select-field')?.toggleAttribute('hidden',pdf);
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
    const focusedButton = document.activeElement?.closest('#annotation-list button[data-action]');
    const focused = focusedButton ? {id:focusedButton.dataset.id,action:focusedButton.dataset.action} : null;
    list.replaceChildren();
    const annotations = data?.annotations || [];
    $('annotation-count').textContent = annotations.length;
    $('sidebar-rail-count').textContent = annotations.length;
    if (!annotations.some(item=>item.id===activeAnnotationId)) activeAnnotationId=null;
    for (const id of expandedAnnotations) if (!annotations.some(item=>item.id===id)) expandedAnnotations.delete(id);
    const pendingCount = annotations.filter(annotation => core.annotationStatus(annotation) === 'open').length;
    $('review-progress').textContent = `待处理 ${pendingCount} · 已完成 ${annotations.length - pendingCount}`;
    renderLocationReview();
    const filter = $('annotation-filter').value;
    if (!annotations.length) { list.append(textNode('p', 'empty-list', '还没有批注。直接填写整体意见，或选择具体内容后批注。')); updateAnnotationNavigation(); return; }
    annotations.forEach((annotation, index) => {
      const resolved = core.annotationStatus(annotation) === 'resolved';
      if (filter === 'attention' ? !needsLocationReview(annotation) : filter === 'new' ? !['new','updated'].includes(core.taskState(annotation)) : filter !== 'all' && (resolved ? 'resolved' : 'open') !== filter) return;
      const state = core.taskState(annotation);
      const stateLabels = {new: '新增意见', updated: '已更新', pending: '待处理', completed: '已完成'};
      const card = document.createElement('article');
      card.className = 'annotation-card' + (resolved ? ' is-resolved' : '') + (!previousIds.has(annotation.id) ? ' is-new' : '') + (editingId === annotation.id ? ' active' : '');
      card.dataset.annotationId = annotation.id; card.dataset.reviewState = state;
      const expanded = expandedAnnotations.has(annotation.id) || editingId===annotation.id;
      card.dataset.expanded = String(expanded);
      const body = document.createElement('div'); body.className='annotation-body'; body.id='annotation-body-'+index;
      const toggle = textNode('button','text-button annotation-details-toggle',expanded ? '收起' : '展开');
      toggle.type='button';toggle.dataset.action='details';toggle.dataset.id=annotation.id;
      toggle.setAttribute('aria-expanded',String(expanded));toggle.setAttribute('aria-controls',body.id);
      toggle.setAttribute('aria-label',`${expanded ? '收起' : '展开'}第 ${index+1} 条批注详情`);
      const top = document.createElement('div'); top.className = 'annotation-top';
      const meta = document.createElement('div'); meta.className = 'annotation-top-meta';
      meta.append(textNode('span', 'annotation-state ' + state, stateLabels[state]), textNode('span', 'annotation-number', String(index + 1).padStart(2, '0')));
      top.append(textNode('span', 'tag', targetLabel(annotation.target)), meta, toggle);
      const comment = textNode('button','annotation-comment annotation-select',annotation.comment);
      comment.type='button';comment.dataset.action='select';comment.dataset.id=annotation.id;
      comment.setAttribute('aria-label',`查看第 ${index+1} 条批注：${annotation.comment}`);
      body.append(comment, textNode('div', 'annotation-quote', targetText(annotation.target).slice(0, 180)));
      card.append(top,body);
      const location = locations.get(annotation.id);
      if (location && !resolved) { const line = textNode('div', 'location-status ' + location.status, location.message); body.append(line); }
      const latest = annotation.history?.[annotation.history.length - 1];
      if (['pending','completed'].includes(state) && latest?.summary) {
        const feedback = textNode('div', 'annotation-feedback', '');
        feedback.append(textNode('strong', '', resolved ? '完成说明' : '未完成说明'), textNode('p', '', latest.summary));
        body.append(feedback);
      }
      const actions = document.createElement('div'); actions.className = 'annotation-actions';
      for (const [action, label] of [['locate', '定位'], ['edit', '编辑'], ['status', resolved ? '重新待处理' : '标记完成'], ['delete', '删除']]) {
        const button = textNode('button', 'text-button' + (action === 'delete' ? ' delete-button' : ''), label);
        button.type = 'button'; button.dataset.action = action; button.dataset.id = annotation.id;
        if (action === 'locate' && resolved) { button.disabled = true; button.title = '已完成批注保留为记录，无需再次定位'; }
        actions.append(button);
      }
      if(resolved) { const review=textNode('button','text-button','复核处理结果');review.type='button';review.dataset.action='review-result';review.dataset.id=annotation.id;actions.prepend(review); }
      if (needsLocationReview(annotation)) {
        const review = textNode('button','text-button','查看对照'); review.type='button'; review.dataset.action='review-location'; review.dataset.id=annotation.id; actions.prepend(review);
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
    if (!list.childElementCount) list.append(textNode('p', 'empty-list', filter === 'attention' ? '目前没有需要确认位置的批注。' : filter === 'new' ? '目前没有新增或更新的意见。' : filter === 'open' ? '目前没有待处理意见。' : '还没有已完成的处理记录。'));
    renderLocationReview();
    renderResultReview();
    updateAnnotationNavigation();
    if (focused && document.activeElement===document.body) Array.from(list.querySelectorAll('button[data-action]')).find(button=>button.dataset.id===focused.id && button.dataset.action===focused.action)?.focus({preventScroll:true});
    window.HRUI.enterCards(list);
  }
  function updateAnnotationNavigation() {
    const cards = Array.from($('annotation-list').querySelectorAll('.annotation-card'));
    const index = cards.findIndex(card=>card.dataset.annotationId===activeAnnotationId);
    for (const card of cards) {
      const current=card.dataset.annotationId===activeAnnotationId;card.classList.toggle('is-current',current);
      if(current)card.setAttribute('aria-current','true');else card.removeAttribute('aria-current');
    }
    const position = `${index<0 ? '—' : index+1} / ${cards.length}`;
    if($('annotation-position').textContent!==position)$('annotation-position').textContent=position;
    $('annotation-previous').disabled=!cards.length || index<=0;
    $('annotation-next').disabled=!cards.length || index===cards.length-1;
  }
  function toggleAnnotationDetails(annotation, card) {
    const expanded = card.dataset.expanded!=='true';
    if(expanded)expandedAnnotations.add(annotation.id);else expandedAnnotations.delete(annotation.id);
    window.HRUI.reflow(card,()=>{
      card.dataset.expanded=String(expanded);
      const toggle=card.querySelector('[data-action=details]');toggle.textContent=expanded ? '收起' : '展开';
      toggle.setAttribute('aria-expanded',String(expanded));
      const index=data.annotations.indexOf(annotation)+1;toggle.setAttribute('aria-label',`${expanded ? '收起' : '展开'}第 ${index} 条批注详情`);
    });
  }
  function selectAnnotation(annotation) {
    activeAnnotationId=annotation.id;updateAnnotationNavigation();
    if(core.annotationStatus(annotation)==='resolved') startResultReview(annotation.id);
    else if(needsLocationReview(annotation)) {resultReviewQueue=null;inspectLocation(annotation);}
    else locate(annotation);
  }
  function moveAnnotation(direction) {
    const cards=Array.from($('annotation-list').querySelectorAll('.annotation-card'));
    const index=cards.findIndex(card=>card.dataset.annotationId===activeAnnotationId);
    const next=cards[index<0 ? 0 : index+direction];
    const annotation=next && data?.annotations.find(item=>item.id===next.dataset.annotationId);
    if(annotation){selectAnnotation(annotation);Array.from($('annotation-list').querySelectorAll('.annotation-card')).find(card=>card.dataset.annotationId===annotation.id)?.scrollIntoView({block:'nearest',behavior:'instant'});}
  }
  function locationDescription(status, reason = '') {
    const description = {exact:'位置与原文已匹配',fallback:'原定位已变化，通过原文找到候选，请核对',ambiguous:'有多个候选，不能自动确认原位置',missing:'原文或元素已变化，无法确认原位置'}[status];
    return description + (reason ? ' · ' + reason.slice(0,500) : '');
  }
  function renderLocationReview() {
    renderResultReview();
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
  function workflowStamp() {return data ? data.source.sha256+':'+data.updatedAt : '';}
  function rememberHandoff(stamp=workflowStamp()) {
    if(stamp!==workflowStamp())return;
    workflow={handoffStamp:workflowStamp(),documentRead:false,documentChanged:false,resultsRead:false,needsDocument:false,documentReadAt:''};
    note('');
    renderResultReview();queueAutosave();
  }
  function renderResultReview() {
    const annotations=data?.annotations || [],hasFeedback=annotations.some(item=>item.history?.length);
    const done=annotations.filter(item=>core.annotationStatus(item)==='resolved').length;
    const fresh=annotations.filter(item=>['new','updated'].includes(core.taskState(item))).length;
    const attention=annotations.filter(needsLocationReview).length;
    const prepared=Boolean(workflow.handoffStamp && workflow.handoffStamp===workflowStamp());
    const newAfterReading=annotations.some(item=>['new','updated'].includes(core.taskState(item)) && item.updatedAt>(workflow.documentReadAt || ''));
    let stage='annotate',title='先读文档，再写下你的意见。',help='选中文字、图片或表格，也可以直接填写整体意见。',action='write',label='写第一条意见';
    if(workflow.needsDocument) {
      stage='read-return';title='处理记录已导入，正文还没有重新读取。';help='完成状态由处理者回报，仍需检查实际效果。请先读取修改后的文档；批注和草稿会保留。';
    } else if(draftDirty()) {
      stage='draft';title='先保存这条意见，再继续下一步。';help=pendingTarget ? '保存后，这条意见才会进入交接材料。' : '先在预览中选择目标，或回到浏览填写整体意见；已填写的意见会保留。';label=pendingTarget && $('comment-input').value.trim() ? '保存这条意见' : '继续填写意见';action=pendingTarget && $('comment-input').value.trim() ? 'save' : 'write';
    } else if(prepared) {
      stage='prepared';title='交接材料已准备好。';help='请把材料交给你使用的 agent。工具不会自动发送或修改文档；拿到返回文件后，从这里继续。';action='handoff';label='再查看交接材料';
    } else if(annotations.length && workflow.documentRead && !newAfterReading) {
      stage='review';title=workflow.documentChanged ? '已读取新版本，逐条看看修改。' : '读取完成，文件内容没有变化。';help=workflow.resultsRead ? '正文与处理记录已读入。完成状态由处理者回报，仍需检查实际效果；复核不改变状态或原定位。' : '尚未导入处理记录，意见仍保留原有状态。可先检查文档，或导入 agent 返回的 JSON。';
    } else if(annotations.length && fresh) {
      stage='handoff';title=hasFeedback ? '新意见已保存，可以准备下一轮修改。' : '意见已保存，可以交给 agent。';help='复制任务并附上原文档，或一次下载含原文档、批注和说明的交接包。';action='handoff';label='交给 agent';
    } else if(annotations.length && (hasFeedback || locationReview)) {
      stage='review';title='处理记录已保留，可以继续审阅。';help='当前显示这份工作区中的文档。agent 修改了文件时，请先读取返回的新文档。';
    } else if(annotations.length) {
      stage='handoff';title='意见已保存，可以交给 agent。';help='原文档和批注一起交付，agent 才能确认要修改哪里。';action='handoff';label='交给 agent';
    }
    if(locationReview?.checking && !workflow.needsDocument)help+=' 正在检查待处理意见的位置…';
    $('result-review').hidden=!data;
    $('result-review').dataset.stage=stage;
    $('result-review-title').textContent=title;
    $('workflow-stage').textContent=stage==='review'||stage==='read-return' ? '03 / 读取与复核' : stage==='handoff'||stage==='prepared' ? '02 / 交给 agent' : '01 / 阅读与批注';
    $('result-review-summary').hidden=!annotations.length;
    const summary = `完成记录 ${done} · 待处理 ${annotations.length-done} · 新增 / 已更新 ${fresh} · 需确认位置 ${attention}`;
    if ($('result-review-summary').textContent !== summary) $('result-review-summary').textContent = summary;
    $('result-review-help').textContent=help;
    $('workflow-primary').hidden=stage==='read-return' || stage==='review';
    $('workflow-primary').textContent=label;$('workflow-primary').dataset.action=action;$('workflow-primary').disabled=busy || !previewReady;
    $('result-review-reload').hidden=stage!=='read-return';$('result-review-reload').disabled=busy || !data;
    $('result-review-start').hidden=stage!=='review';$('result-review-start').disabled=busy || !previewReady || !annotations.length;
    $('workflow-return').hidden=!annotations.length;$('workflow-return').disabled=busy;
    $('handoff-button').classList.remove('primary');
    updateGuide();renderReturnSteps();
  }
  function renderReturnSteps() {
    if(!data)return;
    $('return-document-name').textContent=data.source.name;
    $('return-results-name').textContent=core.resultPath(data.source.path).split('/').at(-1);
    $('return-document-state').textContent=workflow.needsDocument ? '请读取本轮返回的文档' : workflow.documentRead ? workflow.documentChanged ? '已读取 · 正文已更新' : '已读取 · 文件内容没有变化' : '尚未从这里读取返回文档';
    $('return-results-state').textContent=workflow.resultsRead ? '已导入 · 处理记录已更新' : '尚未在本轮导入处理记录';
    $('handoff-reload').disabled=busy;
    $('handoff-import-results').disabled=busy;
    $('return-review').disabled=busy || !previewReady || !data.annotations.length || workflow.needsDocument || !workflow.documentRead;
    $('return-help').textContent=workflow.needsDocument ? '处理记录已导入，请继续读取修改后的文档。' : workflow.documentRead && !workflow.resultsRead ? '文档已读取；没有处理记录也能继续审阅，但完成状态不会自动更新。' : workflow.documentRead ? '可以开始复核，也可以返回工作区添加新意见。' : '两份文件可以分开读入。取消或读取失败时，当前文档、批注和草稿会保留。';
  }
  function openReturnSteps() {
    if(busy || !data)return;
    window.HRUI.closeDialog($('agent-task-dialog'));renderReturnSteps();window.HRUI.openDialog($('return-dialog'));
  }
  function startResultReview(annotationId) {
    if(busy || !previewReady || !data)return;
    const annotations=data.annotations.slice().sort((a,b)=>Number(needsLocationReview(b))-Number(needsLocationReview(a)));
    resultReviewQueue=annotations.map(item=>item.id);
    const annotation=data.annotations.find(item=>item.id===annotationId) || annotations[0];
    if(annotation)inspectLocation(annotation,{review:true});
  }
  function moveResultReview(step) {
    const annotation=inspectionAnnotation();if(!annotation || !resultReviewQueue)return;
    const index=resultReviewQueue.indexOf(annotation.id),next=data.annotations.find(item=>item.id===resultReviewQueue[index+step]);
    if(next)inspectLocation(next,{review:true});
    else if(step>0){resultReviewQueue=null;locationInspection=null;$('location-preview-bar').hidden=true;window.HRUI.closeDialog($('location-dialog'));note('已结束本轮复核。意见与处理状态未被更改；新想法可以继续添加批注。');}
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
    },isPdf(data) ? 30000 : 8000);
  }
  async function preparePreview(nextData) {
    if(isPdf(nextData)) note('正在读取 PDF，可随时取消…');
    if(isDocx(nextData)) note('正在生成 DOCX 内容预览，可随时取消…');
    const nextChannel = id();
    const bridge = `(${window.HRBridge.toString()})(${JSON.stringify(nextChannel)}, ${window.HRShortcut.toString()}, ${JSON.stringify(isDocx(nextData) ? {sourceSha256:nextData.source.sha256} : null)});`;
    const result = await adapters.preview(nextData, bridge);
    return {...result, channel: nextChannel};
  }
  function installPreview(result) {
    previewReady = false;latestSelectionSerial=0;
    locationInspection=null;resultReviewQueue=null; window.HRUI.closeDialog($('location-dialog')); $('location-preview-bar').hidden=true;
    $('pdf-thumbnails').hidden=true; $('pdf-thumbnails').replaceChildren(); $('pdf-thumbnail-toggle').setAttribute('aria-expanded','false');
    $('pdf-search-bar').hidden=true; $('pdf-scan-guide').hidden=true;
    frame.setAttribute('aria-busy',String(!result.pdf));pdfPreview.setAttribute('aria-busy',String(Boolean(result.pdf)));
    documentOutline = []; clearTimeout(searchTimer);
    $('document-search').value = ''; renderDocumentNavigation();
    pageInventory = []; $('page-select').replaceChildren(new Option('点击预览或选择页面', '')); renderPageControls();
    channel = result.channel;
    clearTimeout(locationTimer); locationRequest = null; manualLocationRequests.clear();
    const localChannel = result.channel;
    locations.clear();
    showWarnings(result.warnings);
    const sourceHash = data.source.sha256;
    $('pdf-cancel-operation').hidden=true; $('pdf-operation-status').textContent=''; $('pdf-page-number').value='1'; $('pdf-page-count').textContent='/ —'; $('pdf-zoom').value='fit'; window.HRUI.syncSelect('pdf-zoom');
    adapters.mount(result, pdfPreview, message => { if(channel===localChannel && data?.source.sha256===sourceHash && isPdf(data)) handlePreviewMessage(message); }).catch(error=>{ if(channel===localChannel) note(error.message || 'PDF 预览失败。',true); });
    frame.srcdoc = result.pdf ? '' : result.html;
    renderAnnotations();
    setTimeout(() => {
      if (channel === localChannel && !previewReady) {
        if (locationReview) { locationReview.checking = false; renderLocationReview(); }
        note('页面已载入，但批注定位脚本未响应。原页面可能存在脚本错误、跳转或不支持的结构；可重载或改用普通静态 HTML。', true);
      }
    }, result.pdf ? 30000 : 8000);
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
    activeAnnotationId=null;expandedAnnotations.clear();
    workflowDetailsOpen = null; workflowDisclosureAlert = '';
    locationReview = null; $('reload-review').hidden = true;
    if ($('annotation-filter').value === 'attention') { $('annotation-filter').value = 'all'; window.HRUI.syncSelect('annotation-filter'); }
    data.annotations = data.annotations.map(core.normalizeAnnotation);
    undoStack.length = 0; redoStack.length = 0;
    cachedSession = null; $('recovery-banner').hidden = true;
    workflow={handoffStamp:'',documentRead:false,documentChanged:false,resultsRead:false,needsDocument:false,documentReadAt:''};
    guideAnnotated = false;
    dirty = false;
    lastExportFormat = hasSearch(nextData) ? 'annotations' : 'html';
    if(hasSearch(nextData)) $('export-format').value = lastExportFormat;
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
    if (/\.(docx|pdf)$/i.test(file.name) && file.size > core.limits.source) throw new Error('文档超过 20 MiB 限制。');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (/\.(docx|pdf)$/i.test(file.name)) return core.importSource({bytes,name:file.name,path,lastModified:file.lastModified,type:/\.pdf$/i.test(file.name) ? 'pdf' : 'docx'});
    if (/\.json$/i.test(file.name)) {
      const imported = JSON.parse(new TextDecoder().decode(bytes));
      if(imported.format !== 'html-review-annotations' || ![1,2,3].includes(imported.schemaVersion)) throw new Error('请选择轻量批注 JSON；agent 结果请使用导入处理结果。');
      if(imported.schemaVersion===1) throw new Error('HTML 轻量批注恢复暂不支持，请打开完整批注副本。');
      await core.validateAnnotationExport(imported);
      pendingLight=imported; $('pair-source').hidden=false; note('已读取轻量批注，请选择配套原始 DOCX 或 PDF；当前工作区已保留。');
      return null;
    }
    if (!/\.(html?|xhtml)$/i.test(file.name)) throw new Error('支持 HTML、DOCX、PDF、完整副本和轻量批注 JSON。');
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
      if (/\.(docx|pdf)$/i.test(entry.name)) break;
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
    folderEntries = files.filter(file => /\.(html?|xhtml|docx|pdf)$/i.test(file.name)).sort((a, b) => folderPath(a).localeCompare(folderPath(b)));
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
    if(adapters.sourceType(nextData)!==adapters.sourceType(data)) throw new Error('重载文件格式发生变化，当前工作区已保留。');
    const prepared = await preparePreview(nextData);
    const completedNow = nextData.annotations.filter(annotation => core.annotationStatus(annotation) === 'resolved' && core.annotationStatus(data.annotations.find(item => item.id === annotation.id)) !== 'resolved').map(annotation => annotation.id);
    if (resultCount) recordResultsChange(data, nextData);
    data = nextData;
    locationReview = {changed, completedNow, queue:[], checking:true, dismissed:false};
    workflow.handoffStamp='';workflow.documentRead=true;workflow.documentChanged=changed;workflow.documentReadAt=new Date().toISOString();workflow.needsDocument=false;if(resultCount)workflow.resultsRead=true;
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
    else note('');
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
      if(nextData.source.type !== pendingLight.source.type || nextData.source.sha256 !== pendingLight.source.sha256 || nextData.source.byteLength !== pendingLight.source.byteLength) throw new Error('版本不一致：请选择批注时对应的原始文档。当前工作区和待恢复批注已保留。');
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
    const entries = files.filter(file => /\.(html?|xhtml|docx|pdf)$/i.test(file.name)).sort((a, b) => folderPath(a).localeCompare(folderPath(b)));
    if (!entries.length) throw new Error('所选文件夹没有 HTML、DOCX 或 PDF 文件。');
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
        const nextAccess = {...access, entries: files.filter(file => /\.(html?|xhtml|docx|pdf)$/i.test(file.name)).map(folderPath).sort()};
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
  function recordResultsChange(before, after, needsDocument=!workflow.documentRead) {
    const items = [];
    before.annotations.forEach((annotation, index) => {
      const updated = after.annotations[index];
      if (core.annotationStatus(annotation) !== core.annotationStatus(updated) || (annotation.history?.length || 0) !== (updated.history?.length || 0)) items.push({before: structuredClone(annotation), after: structuredClone(updated), index});
    });
    if (!items.length) return;
    undoStack.push({items,resultsReadBefore:workflow.resultsRead,needsDocumentBefore:workflow.needsDocument,needsDocumentAfter:needsDocument,documentReadAt:workflow.documentReadAt || ''}); if (undoStack.length > 50) undoStack.shift(); redoStack.length = 0;
  }
  async function importResults(file) {
    const patch=await readResultFile(file);
    const merged = core.applyAgentResults(data, patch);
    await core.validateData(merged.data);
    if (merged.applied) {
      const needsDocument=!workflow.documentRead || merged.data.annotations.some(item=>item.history?.at(-1)?.batchId===patch.batchId && item.updatedAt>(workflow.documentReadAt || ''));
      recordResultsChange(data, merged.data, needsDocument); data = merged.data;
      workflow.handoffStamp='';workflow.resultsRead=true;workflow.needsDocument=needsDocument;
      markDirty(); renderAnnotations(); updateEditor(); queueAutosave();
      startLocationReview();
    }
    if(merged.applied)note('');
    else note('该批处理记录已导入，无需重复更新。');
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
    markDirty(); clearEditor(true); renderAnnotations(); window.HRUI.saved($('save-button'));
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
    workflow.handoffStamp='';
    if(typeof change.resultsReadBefore==='boolean') {
      workflow.resultsRead=redo || change.resultsReadBefore;
      workflow.needsDocument=(workflow.documentReadAt || '')===change.documentReadAt ? (redo ? change.needsDocumentAfter : change.needsDocumentBefore) : workflow.resultsRead && !workflow.documentRead;
    }
    to.push(change);
    markDirty(); clearEditor(); setMode('browse'); renderAnnotations();
    startLocationReview();
    note(redo ? '已重做批注操作，下载可保存最新结果。' : '已撤销上次批注操作，原批注内容和位置已恢复。');
  }
  function locate(annotation) {
    activeAnnotationId=annotation.id;updateAnnotationNavigation();
    if (core.annotationStatus(annotation) === 'resolved') { note('这条批注已完成，原文与位置保留作处理记录。需要继续修改时可编辑意见或重新待处理。'); return; }
    if (annotation.kind === 'page' && wholeTarget(annotation.target)) {
      send('clear-focus');
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
  function inspectLocation(annotation,options={}) {
    if(busy || !previewReady)return;
    const readOnly=core.annotationStatus(annotation)==='resolved';
    if(readOnly && !options.review)return;
    locationInspection={id:annotation.id,revision:core.annotationRevision(annotation),target:JSON.stringify(annotation.target),sourceHash:data.source.sha256,status:core.annotationStatus(annotation),history:JSON.stringify(annotation.history || []),readOnly,review:Boolean(options.review),token:id(),originalText:targetText(annotation.target),candidates:[],selected:-1,viewed:false};
    $('location-preview-bar').hidden=true;
    $('location-dialog-title').textContent=options.review ? '复核处理结果' : '确认批注位置';
    $('location-current-title').textContent=readOnly ? '当前内容对照' : '选择并核对当前位置';
    const feedback=annotation.history?.at(-1);
    $('location-feedback').hidden=!feedback;
    $('location-feedback').textContent=feedback ? `${feedback.revision<core.annotationRevision(annotation)?'上一版处理说明':readOnly?'完成说明':'未完成说明'} · 第 ${feedback.revision} 版 · ${feedback.by==='user'?'你':feedback.by}：${feedback.summary || '未附说明'}` : '';
    $('confirm-location').hidden=readOnly || wholeTarget(annotation.target);$('reselect-location').hidden=readOnly || wholeTarget(annotation.target);
    $('review-current-document').hidden=!options.review;
    const inQueue=Boolean(options.review && resultReviewQueue),queueIndex=resultReviewQueue?.indexOf(annotation.id) ?? -1;
    $('result-review-position').hidden=!inQueue;$('result-review-position').textContent=inQueue ? `第 ${queueIndex+1} / ${resultReviewQueue.length} 条 · ${readOnly?'完成记录，核对不会改变状态':core.taskState(annotation)==='new'?'新增意见':'待处理意见'}` : '';
    $('review-previous').hidden=!inQueue;$('review-previous').disabled=queueIndex<=0;
    $('review-next').hidden=!inQueue;$('review-next').textContent=queueIndex===resultReviewQueue?.length-1 ? '结束复核' : '下一条';
    $('location-opinion').textContent=annotation.comment;
    $('location-confirm-help').textContent=readOnly ? '完成记录仅供复核，不自动匹配相似原文，也不更换旧定位。' : '确认位置会保留原定位记录；修改意见仍是待处理。';
    $('location-original').textContent=targetText(annotation.target);
    const quote=annotation.target.quote || {};
    $('location-original-context').textContent=[quote.prefix,quote.suffix].filter(Boolean).join(' … ');
    $('location-review-status').textContent='正在读取当前文档中的候选位置…';
    $('location-candidates').replaceChildren();$('confirm-location').disabled=true;
    window.HRUI.openDialog($('location-dialog'));
    if(wholeTarget(annotation.target))receiveLocationCandidates({requestId:annotation.id,locationToken:locationInspection.token,candidates:[]});
    else send('review-candidates',{target:annotation.target,requestId:annotation.id,locationToken:locationInspection.token});
  }
  function inspectionAnnotation() {
    const state=locationInspection,annotation=data?.annotations.find(item=>item.id===state?.id);
    return annotation && core.annotationRevision(annotation)===state.revision && JSON.stringify(annotation.target)===state.target && core.annotationStatus(annotation)===state.status && JSON.stringify(annotation.history || [])===state.history && data.source.sha256===state.sourceHash ? annotation : null;
  }
  function candidateNeedsViewing(candidate) {return candidate.target.kind==='region' || (candidate.target.kind==='page' && !wholeTarget(candidate.target)) || candidate.target.tag==='img';}
  function showTextDifference(node,oldText,newText,previous) {
    const a=Array.from(oldText.slice(0,1600)),b=Array.from(newText.slice(0,1600));let start=0,end=0;
    while(start<Math.min(a.length,b.length) && a[start]===b[start])start++;
    while(end<Math.min(a.length,b.length)-start && a[a.length-1-end]===b[b.length-1-end])end++;
    const value=previous?a:b;node.replaceChildren(document.createTextNode(value.slice(0,start).join('')));
    const changed=value.slice(start,value.length-end).join('');
    if(changed)node.append(textNode(previous?'del':'ins','',changed));
    node.append(document.createTextNode(end?value.slice(-end).join(''):''));
  }
  function chooseLocation(index) {
    if(!inspectionAnnotation() || !locationInspection.candidates[index])return;
    locationInspection.selected=index;locationInspection.viewed=false;
    for(const node of $('location-candidates').querySelectorAll('input'))node.checked=Number(node.value)===index;
    const selected=locationInspection.candidates[index];
    showTextDifference($('location-original'),locationInspection.originalText,selected.text,true);
    const copy=$('location-candidates').querySelector(`[data-candidate-copy="${index}"]`);if(copy)showTextDifference(copy,locationInspection.originalText,selected.text,false);
    const needsView=candidateNeedsViewing(selected);
    $('confirm-location').disabled=needsView || locationInspection.readOnly;
    $('location-confirm-help').textContent=locationInspection.readOnly ? '完成记录仅供复核。原定位和完成说明保留，不更换目标或重新要求 agent 处理。' : needsView ? '先在文档中查看区域或页面，再确认。原定位记录会保留，意见仍待处理。' : '确认位置会保留原定位记录；修改意见仍是待处理。';
  }
  function previewLocation(index) {
    chooseLocation(index);const candidate=locationInspection?.candidates[index];if(!candidate)return;
    locationInspection.viewed=true;
    $('location-preview-label').textContent=candidate.label;
    $('location-preview-bar').hidden=false;$('confirm-preview-location').hidden=locationInspection.readOnly;$('confirm-preview-location').disabled=locationInspection.readOnly;
    $('confirm-location').disabled=locationInspection.readOnly;
    window.HRUI.closeDialog($('location-dialog'));send('preview-candidate',{target:candidate.target});
  }
  function receiveLocationCandidates(message) {
    if(!inspectionAnnotation() || message.requestId!==locationInspection.id || message.locationToken!==locationInspection.token)return;
    const candidates=[];
    // A deleted completed target is a historical record, not a suggestion to inspect
    // whatever now occupies its old structural path.
    for(const candidate of locationInspection.readOnly && message.status==='missing' ? [] : Array.isArray(message.candidates)?message.candidates.slice(0,6):[]) {
      try {
        if(JSON.stringify(candidate.target).length>250000)continue;
        core.validateTarget(candidate.target,candidate.target.kind);
        if(candidate.target.kind!==inspectionAnnotation().kind)continue;
        if(isPdf(data) && candidate.target.pdf?.sourceSha256!==data.source.sha256)continue;
        if(isDocx(data) && candidate.target.docx?.sourceSha256!==data.source.sha256)continue;
        candidates.push({target:structuredClone(candidate.target),label:String(candidate.label || '候选位置').slice(0,160),text:String(candidate.text || targetText(candidate.target)).slice(0,1600),prefix:String(candidate.prefix || '').slice(0,160),suffix:String(candidate.suffix || '').slice(0,160)});
      }catch(_) { /* Invalid or stale evidence never becomes a confirmation target. */ }
    }
    locationInspection.candidates=candidates;
    const whole=wholeTarget(inspectionAnnotation().target);
    $('location-review-status').textContent=whole ? '这条意见覆盖整个文件。请结合处理说明阅读当前版本。' : locationInspection.readOnly && !candidates.length ? '原定位内容已变化或删除。结合完成说明阅读当前文档，完成记录仍保留。' : candidates.length ? (candidates.length===1 ? '找到一个可核对的位置，请检查原文与当前位置。' : '找到多个候选，请根据上下文选择，不会自动绑定。') : '没有找到可靠的候选；原文可能已删除。请在文档中重新选择，或保留批注记录。';
    const list=$('location-candidates');list.replaceChildren();
    candidates.forEach((candidate,index)=>{
      const card=textNode('section','location-candidate','');
      const label=document.createElement('label');const radio=document.createElement('input');radio.type='radio';radio.name='review-location';radio.value=String(index);radio.hidden=locationInspection.readOnly;radio.addEventListener('change',()=>chooseLocation(index));
      label.append(radio,textNode('strong','',candidate.label));
      const copy=textNode('p','',candidate.text);copy.dataset.candidateCopy=String(index);card.append(label,copy);
      if(candidate.prefix || candidate.suffix)card.append(textNode('p','location-context',[candidate.prefix,candidate.suffix].filter(Boolean).join(' … ')));
      const viewButton=textNode('button','text-button','在文档中查看');viewButton.type='button';viewButton.addEventListener('click',()=>previewLocation(index));card.append(viewButton);list.append(card);
    });
    if(!candidates.length)list.append(textNode('p','navigation-empty',whole ? '整体意见没有单独的位置。当前文件：'+data.source.name : locationInspection.readOnly ? '当前文档中没有可靠的原目标。可查看当前文档，或继续下一条复核。' : '无可靠候选。不猜测新原文，也不自动更换目标。'));
    if(locationInspection.readOnly)$('location-confirm-help').textContent='完成记录仅供复核，不自动匹配相似原文，也不更换旧定位。';
    if(candidates.length===1)chooseLocation(0);
  }
  function confirmLocation() {
    const annotation=inspectionAnnotation(),state=locationInspection,candidate=state?.candidates[state.selected];
    if(!annotation || !candidate || busy || state.readOnly)return;
    if(candidateNeedsViewing(candidate) && !state.viewed)return;
    if(draftDirty()){note('先保存或取消编辑框中的意见，再确认位置；草稿仍保留。',true);return;}
    if((annotation.targetHistory?.length || 0)>=100){note('此批注已保存 100 次定位记录，请新建批注。',true);return;}
    const now=new Date().toISOString(),next=structuredClone(annotation);
    next.revision=core.annotationRevision(annotation)+1;next.updatedAt=now;next.status='open';next.target=structuredClone(candidate.target);next.view=view();
    next.targetHistory=[...(next.targetHistory || []),{revision:core.annotationRevision(annotation),target:structuredClone(annotation.target),...(annotation.view?{view:structuredClone(annotation.view)}:{}),at:now}];
    core.normalizeAnnotation(next);core.validateTarget(next.target,next.kind);
    const index=data.annotations.indexOf(annotation);recordChange(annotation,next,index);data.annotations[index]=next;
    locations.set(next.id,{status:'exact',message:'你已确认当前位置；原定位保留在历史记录中。'});manualLocationRequests.delete(next.id);
    if(editingId===next.id){pendingTarget=structuredClone(next.target);draftTargetChanged=false;setTarget(pendingTarget);}
    locationInspection=null;$('location-preview-bar').hidden=true;window.HRUI.closeDialog($('location-dialog'));
    markDirty();renderAnnotations();updateEditor();note('已确认新位置，原定位保留为记录。修改意见仍待处理，可撤销。');
  }
  function edit(annotation) {
    if (draftDirty() && !confirm('编辑框中有未保存的修改。确定切换到这条批注吗？')) return;
    layout.reveal();activeAnnotationId=annotation.id;expandedAnnotations.add(annotation.id);
    editingId = annotation.id;
    $('comment-input').value = annotation.comment;
    draftBaseline = annotation.comment;
    setMode(annotation.kind === 'page' && wholeTarget(annotation.target) ? 'browse' : annotation.kind === 'region' ? 'element' : annotation.kind);
    const restoredTarget = structuredClone(annotation.target);
    if (annotation.kind === 'page' && wholeTarget(restoredTarget)) restoredTarget.scope = 'whole-document';
    setTarget(restoredTarget);
    locate(annotation);
    draftTargetChanged = false;
    updateEditor(); renderAnnotations();
    layout?.reveal(); $('comment-input').focus();
  }
  function reselect(annotation) {
    if (busy || !previewReady) { note('文档还在载入，请稍后重新选择位置。',true); return; }
    if (draftDirty() && !confirm('编辑框中有未保存的修改。确定切换到这条批注并重新选择位置吗？')) return;
    layout.reveal();activeAnnotationId=annotation.id;expandedAnnotations.add(annotation.id);
    editingId = annotation.id; draftBaseline = annotation.comment;
    $('comment-input').value = annotation.comment;
    pendingTarget = null; draftTargetChanged = false;
    $('target-preview').hidden = true; send('clear-selection'); send('clear-focus');
    setMode(annotation.kind === 'page' ? 'page' : annotation.kind === 'region' ? 'element' : annotation.kind);
    updateEditor(); renderAnnotations();
    note('在预览中重新选择位置，再点击「更新批注」。意见会保留，保存后原位置也会留作记录。');
  }
  async function download(requestedFormat) {
    if (draftDirty()) { note('编辑框中还有未保存的修改，请先点击「保存批注」或「更新批注」，再下载副本。', true); return; }
    await core.validateData(data);
    const format = requestedFormat || $('export-format').value;
    const basename = data.source.name.replace(/\.(html?|xhtml|docx|pdf)$/i, '').replace(/[\\/:*?"<>|]/g, '_') + '.review';
    if (format === 'annotations') {
      const blob = new Blob([core.serialize(core.createAnnotationExport(data), true)], {type: 'application/json;charset=utf-8'});
      downloadBlob(blob, basename + '.json');
      finishDownload(format, '已导出轻量批注，不含原文件快照和编辑界面。请将 JSON 与原文件一起交给 agent；DOCX / PDF JSON 可选择配套原文件恢复批注。');
      return;
    }
    const copy = document.documentElement.cloneNode(true);
    layout.cleanCopy(copy);
    copy.querySelector('#html-review-data').textContent = core.serialize(data);
    const copiedFrame = copy.querySelector('#preview-frame');
    copiedFrame.removeAttribute('srcdoc'); copiedFrame.removeAttribute('src'); copiedFrame.hidden = true;
    for (const dialog of copy.querySelectorAll('dialog')) { dialog.removeAttribute('open'); dialog.removeAttribute('data-closing'); }
    for (const node of copy.querySelectorAll('[data-ui-transient],[data-site-only],.select-popover')) node.remove();
    for (const node of copy.querySelectorAll('[data-motion],[inert]')) { node.removeAttribute('data-motion'); node.removeAttribute('inert'); }
    for (const panel of copy.querySelectorAll('[data-settings-panel]')) panel.removeAttribute('aria-hidden');
    copy.querySelector('#pdf-preview').replaceChildren(); copy.querySelector('#pdf-preview').hidden=true;
    copy.querySelector('#pdf-thumbnails').replaceChildren(); copy.querySelector('#pdf-thumbnails').hidden=true; copy.querySelector('#pdf-thumbnail-toggle').setAttribute('aria-expanded','false');
    for(const selector of ['#pdf-search-bar','#pdf-scan-guide','#location-preview-bar','#result-review'])copy.querySelector(selector).hidden=true;
    for(const selector of ['#location-candidates','#location-original','#location-original-context','#location-opinion','#location-review-status','#location-preview-label','#location-feedback','#result-review-position','#result-review-summary'])copy.querySelector(selector).replaceChildren();
    copy.querySelector('#backup-menu').removeAttribute('open');
    copy.querySelector('.backup-panel').removeAttribute('aria-hidden');
    copy.querySelector('#pdf-controls').hidden=true; copy.querySelector('#pdf-cancel-search').hidden=true;
    copy.querySelector('#preview-width').closest('.select-field')?.removeAttribute('hidden');
    copy.querySelector('#pdf-page-number').value='1'; copy.querySelector('#pdf-page-number').setAttribute('value','1'); copy.querySelector('#pdf-page-number').removeAttribute('max');
    copy.querySelector('#pdf-page-count').textContent='/ —'; copy.querySelector('#pdf-operation-status').textContent=''; copy.querySelector('#pdf-cancel-operation').hidden=true;
    copy.querySelector('#pdf-password-input').value=''; copy.querySelector('#pdf-password-input').removeAttribute('value');
    copy.querySelector('#pdf-password-error').textContent='';
    copy.querySelector('#page-select').replaceChildren();
    // Rebuilt on startup. Do not serialize transient editor/list state or duplicate page bytes.
    copy.querySelector('#annotation-list').replaceChildren();
    copy.querySelector('#review-progress').textContent = '意见与处理记录';
    copy.querySelector('#annotation-position').textContent='— / 0';
    copy.querySelector('#annotation-previous').disabled=true;copy.querySelector('#annotation-next').disabled=true;
    copy.querySelector('#comment-input').textContent = '';
    copy.querySelector('#target-preview').hidden = true;
    copy.querySelector('#target-preview').dataset.expanded = 'false';
    copy.querySelector('#target-summary-toggle').setAttribute('aria-expanded','false');
    copy.querySelector('#target-summary-toggle').textContent='展开摘要';
    copy.querySelector('#comment-scope').textContent='等待打开文档';
    copy.querySelector('#workflow-details').hidden=true;
    copy.querySelector('#workflow-details-toggle').setAttribute('aria-expanded','false');
    copy.querySelector('#workflow-details-toggle').querySelector('span').textContent='流程详情';
    for (const selector of ['#target-text', '#target-selector', '#target-kind']) copy.querySelector(selector).textContent = '';
    copy.querySelector('#data-preview').textContent = '';
    copy.querySelector('#agent-task-text').textContent = '';
    for (const selector of ['#handoff-source', '#handoff-summary', '#agent-task-help', '#copy-agent-status', '#document-outline', '#document-search-results', '#document-search-status']) copy.querySelector(selector).replaceChildren();
    copy.querySelector('#document-search').value = ''; copy.querySelector('#document-search').removeAttribute('value');
    copy.querySelector('#task-details').removeAttribute('open');
    copy.querySelector('#workflow-check-details').removeAttribute('open');
    for(const selector of ['#return-document-name','#return-document-state','#return-results-name','#return-results-state','#return-help'])copy.querySelector(selector).replaceChildren();
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
    window.HRUI.closeBackup();
    dirty = false; lastExportFormat = format; updateSaveState(); note(message);
    renderResultReview(); queueAutosave();
  }
  function updateExportFormat() {
    autosavePaused = false;
    const format = $('export-format').value;
    $('download-button').textContent = {html: '保存完整工作区', gzip: '保存压缩工作区', annotations: '导出单独批注 JSON'}[format];
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
    layout?.refresh();
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
    $('onboarding-card').hidden = guideDismissed || !data;
    const stage=$('result-review').dataset.stage;
    const current=['read-return','review'].includes(stage) ? 2 : ['handoff','prepared'].includes(stage) ? 1 : 0;
    Array.from(document.querySelectorAll('[data-guide-step]')).forEach((item,index)=>{item.dataset.complete=String(index<current);item.toggleAttribute('aria-current',index===current);if(index===current)item.setAttribute('aria-current','step');});
    const attention = data?.annotations.filter(needsLocationReview).length || 0;
    const incomplete = locationReview && !locationReview.checking && !locationReview.dismissed && data?.annotations.some(annotation => core.annotationStatus(annotation) === 'open' && !locations.has(annotation.id));
    const alert = workflow.needsDocument ? 'needs-document' : attention ? 'location-attention' : incomplete ? 'check-incomplete' : '';
    // A newly discovered issue opens its explanation, but ordinary stage changes
    // and typing do not reset the user's disclosure choice.
    if (alert && alert !== workflowDisclosureAlert) {
      workflowDetailsOpen = null;
      if (alert !== 'needs-document') $('workflow-check-details').open = true;
    }
    workflowDisclosureAlert = alert;
    const expanded = Boolean(data && (workflowDetailsOpen ?? (!guideDismissed || Boolean(alert))));
    $('result-review').dataset.expanded = String(expanded);
    $('result-review').dataset.attention = String(Boolean(alert));
    $('workflow-details-toggle').setAttribute('aria-expanded', String(expanded));
    $('workflow-details-toggle').querySelector('span').textContent = expanded ? '收起详情' : '流程详情';
    if (!expanded && $('workflow-details').contains(document.activeElement)) $('workflow-details-toggle').focus({preventScroll:true});
    window.HRUI.disclose($('workflow-details'), expanded, previewReady);
  }
  function autosaveStatus(message, error = false) {
    $('autosave-state').textContent = message;
    $('autosave-state').classList.toggle('error', error);
    $('clear-recovery').disabled = !persistenceReady || busy || (!data && !cachedSession);
    $('retry-recovery').hidden = !error;
  }
  function sessionSnapshot() {
    return structuredClone({version: 1, data, localAccess, exampleWorkspace, guideAnnotated, workflow:{...workflow,sourceHash:data.source.sha256}, draft: {comment: $('comment-input').value, pendingTarget, editingId, baseline: draftBaseline, targetChanged: draftTargetChanged, mode}, dirty, lastExportFormat,
      preferences: {...layout.preferences(), width: $('preview-width').value, sidebar: $('sidebar-position').value, exportFormat: $('export-format').value}});
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
        const entries = Array.isArray(localAccess.entries) ? localAccess.entries.filter(path => typeof path === 'string' && /\.(html?|xhtml|docx|pdf)$/i.test(path)) : [];
        if (!entries.includes(localAccess.entryPath)) entries.push(localAccess.entryPath);
        showFolderEntries(entries, localAccess.entryPath);
      }
      const savedFlow=record.workflow;
      if(savedFlow?.sourceHash===data.source.sha256)workflow={handoffStamp:typeof savedFlow.handoffStamp==='string'?savedFlow.handoffStamp.slice(0,120):'',documentRead:savedFlow.documentRead===true,documentChanged:savedFlow.documentChanged===true,resultsRead:savedFlow.resultsRead===true,needsDocument:savedFlow.needsDocument===true,documentReadAt:typeof savedFlow.documentReadAt==='string' && Number.isFinite(Date.parse(savedFlow.documentReadAt))?savedFlow.documentReadAt:''};
      const draft = record.draft;
      mode = draft.mode === 'whole' || (draft.mode === 'page' && draft.pendingTarget && wholeTarget(draft.pendingTarget)) ? 'browse' : draft.mode; editingId = draft.editingId || null;
      pendingTarget = draft.pendingTarget ? structuredClone(draft.pendingTarget) : null;
      $('comment-input').value = draft.comment; draftBaseline = draft.baseline;
      // An older async session snapshot must not overwrite the latest layout choice.
      setSidebarPosition(preferredSidebarPosition(record.preferences.sidebar), false);
      layout.restore(record.preferences);
      $('preview-width').value = record.preferences.width; applyWidth();
      $('export-format').value = record.preferences.exportFormat; updateExportFormat();
      if (pendingTarget) setTarget(pendingTarget); else $('target-preview').hidden = true;
      draftTargetChanged = Boolean(draft.targetChanged); dirty = Boolean(record.dirty); lastExportFormat = record.lastExportFormat;
      for (const button of document.querySelectorAll('[data-mode]')) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
      document.querySelector('.mode-tabs').style.setProperty('--mode-index', Array.from(document.querySelectorAll('.mode-tabs [data-mode]')).filter(button => !button.hidden).findIndex(button => button.dataset.mode === mode));
      // Activation starts in browse mode. The iframe may become ready before
      // the saved draft is restored, so synchronize both sides once more.
      send('set-mode', {mode});
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
    const attention=data.annotations.filter(needsLocationReview).length;
    if(attention)$('handoff-summary').textContent+='\n'+attention+' 条位置需确认，可先返回批注列表查看对照。';
    $('handoff-source').textContent = data.source.name;
    $('agent-task-help').textContent = isPdf(data) ? '附上这份原始 PDF 和批注 JSON。工具只做预览和批注，保留页面位置与原文。' : isDocx(data) ? '附上这份原始 DOCX（Word 文件），不需要另存 HTML。工具只做预览和批注。' : '附上原始 HTML；若有本地图片、样式或脚本，请一起提供。';
    $('agent-task-text').value = core.createAgentTask(data);
    $('task-details').open = false;
    $('copy-agent-status').textContent = '复制后，粘贴到你使用的 agent 对话中。';
    $('handoff-reload').disabled = busy || !data; $('handoff-export-package').disabled=busy || draftDirty();
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
      button.addEventListener('click', () => { send('navigate-document', {kind:query ? 'search' : 'outline', index:item.index, query, id:item.id, start:item.start,end:item.end}); window.HRUI.closeDialog($('document-nav-dialog')); });
      list.append(button);
    }
    if (!items.length && (!query || results)) list.append(textNode('p', 'navigation-empty', query ? '没有找到匹配内容，请换一个关键词。' : '这份文档没有标题，可以使用上方查找。'));
  }
  async function copyAgentTask() {
    if (!data || !data.annotations.length || busy) return;
    if (draftDirty()) { note('编辑框中有未保存的意见，请先保存或取消编辑，再复制任务。', true); return; }
    prepareHandoff();
    const stamp=workflowStamp();
    try {
      await navigator.clipboard.writeText($('agent-task-text').value); note(isPdf(data) ? '修改任务已复制，请连同原始 PDF 交给 agent。' : isDocx(data) ? '修改任务已复制，请连同原始 DOCX 交给 agent。' : '修改任务已复制，请连同原 HTML 和资源交给 agent。');
      const help = textNode('button', 'text-button', '查看交接步骤'); help.type = 'button'; help.addEventListener('click', openHandoff); $('status').append(' ', help);
      rememberHandoff(stamp);
    }
    catch (_) { $('task-details').open = true; $('copy-agent-status').textContent = '请选中下方任务，按 Ctrl / ⌘ + C 复制。'; window.HRUI.openDialog($('agent-task-dialog')); $('agent-task-text').focus(); $('agent-task-text').select(); }
  }
  function cancelEditor() {
    if (!draftDirty() || confirm('确定放弃编辑框中尚未保存的修改吗？')) { clearEditor(); setMode('browse'); renderAnnotations(); }
  }
  function shortcut(action) {
    if (action === 'escape' && busy) { if (!cancelPicker()) adapters.cancel(); return; }
    if (action === 'escape' && window.HRUI.closeMenu(true)) return;
    const dialog = document.querySelector('dialog[open]');
    if (dialog) { if (action === 'escape') window.HRUI.closeDialog(dialog); return; }
    if(action==='escape' && $('backup-menu').open){window.HRUI.closeBackup();return;}
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
    } else if (['browse', 'text', 'element', 'page', 'whole'].includes(action)) { if(['text','element','page'].includes(action) && !(action==='page' && isDocx(data)))layout.reveal();setMode(action); }
  }
  async function droppedFiles(files) {
    $('drop-overlay').hidden = true;
    await bootPromise;
    if (busy) return;
    if (files.length !== 1 || !/\.(html?|xhtml|docx|pdf|json)$/i.test(files[0]?.name || '')) { note('请一次拖入一个 HTML、DOCX、PDF 或轻量批注 JSON；HTML 资源请使用「导入文件夹」。', true); return; }
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

  function handlePreviewMessage(message) {
    if(!message || !data) return;
    if(message.event==='review-candidates'){receiveLocationCandidates(message);return;}
    if(isPdf(data) && message.event==='pdf-search-position'){const total=Number(message.total)||0;$('pdf-search-bar').hidden=!total;$('pdf-search-position').textContent=`“${$('document-search').value}” · ${Number(message.current)||0} / ${total}`;return;}
    if(isPdf(data) && message.event==='scan-text-guidance'){$('pdf-scan-guide').hidden=false;$('pdf-scan-message').textContent=String(message.message || '此页没有可选文字，使用区域框选。').slice(0,250);return;}

    if(isPdf(data) && message.event==='operation-complete') { $('pdf-cancel-operation').hidden=true; $('pdf-operation-status').textContent=''; return; }
    if (isPdf(data) && message.event === 'pdf-view') {
      if(Number.isInteger(message.pageNumber) && message.pageNumber > 0) $('pdf-page-number').value=String(message.pageNumber);
      if(Number.isInteger(message.pageCount) && message.pageCount > 0) { $('pdf-page-count').textContent='/ '+message.pageCount; $('pdf-page-number').max=String(message.pageCount); }
      if(message.zoom==='fit' || (Number.isFinite(message.zoom) && message.zoom>0)) { const value=String(message.zoom); if(Array.from($('pdf-zoom').options).some(option=>option.value===value)) { $('pdf-zoom').value=value; window.HRUI.syncSelect('pdf-zoom'); } }
      $('pdf-prev-page').disabled=Number($('pdf-page-number').value)<=1; $('pdf-next-page').disabled=Number($('pdf-page-number').value)>=Number($('pdf-page-number').max);
      return;
    }
    if(isPdf(data) && ['search-progress','check-progress'].includes(message.event)) { $('pdf-cancel-operation').hidden=false; $('pdf-operation-status').textContent=typeof message.message==='string' ? message.message.slice(0,200) : '正在处理…'; return; }
    if(isPdf(data) && ['document-search','targets-checked'].includes(message.event)) { $('pdf-cancel-operation').hidden=true; $('pdf-operation-status').textContent=''; }
    if (message.event === 'external-link' && isDocx(data)) {
      if(typeof message.url==='string' && /^(https?:|mailto:)/i.test(message.url)) window.open(message.url,'_blank','noopener,noreferrer');
    } else if (message.event === 'shortcut') { if (typeof message.action === 'string') shortcut(message.action); }
    else if (message.event === 'file-drag') $('drop-overlay').hidden = false;
    else if (message.event === 'dropped-files') { if (Array.isArray(message.files) && message.files.every(file => file instanceof File)) droppedFiles(message.files); }
    else if (message.event === 'ready') { previewReady = true; (isPdf(data) ? pdfPreview : frame).setAttribute('aria-busy','false'); send('set-mode', {mode}); updateEditor(false); startLocationReview(); }
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
    else if (message.event === 'document-outline' && hasSearch(data)) {
      if (!Array.isArray(message.items) || message.items.length > 1000 || !message.items.every(item => Number.isInteger(item.index) && item.index >= 0 && typeof item.text === 'string' && item.text.length <= 160 && item.level >= 1 && item.level <= 6)) return;
      documentOutline = message.items; renderDocumentNavigation();
    } else if (message.event === 'document-search' && hasSearch(data)) {
      if (message.query !== $('document-search').value.trim() || !Array.isArray(message.items) || message.items.length > 50 || !Number.isInteger(message.total) || message.total < 0 || !message.items.every(item => Number.isInteger(item.index) && item.index >= 0 && typeof item.text === 'string' && item.text.length <= 220)) return;
      renderDocumentNavigation(message.items, message.total);
    }
    else if (message.event === 'pages') {
      if (!Array.isArray(message.pages) || message.pages.length > 1000 || !message.pages.every((item, index) => item.index === index + 1 && typeof item.title === 'string' && item.title.length <= 100)) return;
      pageInventory = message.pages;
      const selected = ['page','single-page'].includes(pendingTarget?.scope) ? String(pendingTarget.pageIndex) : '';
      $('page-select').replaceChildren(new Option('点击预览或选择页面', ''), ...pageInventory.map(item => new Option(`${String(item.index).padStart(2, '0')} · ${item.title}`, String(item.index))));
      $('page-select').value = selected; window.HRUI.syncSelect('page-select'); renderPageControls();
    }
    else if (message.event === 'target-cleared' && ((message.kind === 'text' && mode === 'text' && pendingTarget?.kind === 'text') || (isPdf(data) && message.kind==='region' && mode==='element' && pendingTarget?.kind==='region'))) clearTarget();
    else if (message.event === 'target') {
      if (!['text', 'element', 'page'].includes(mode)) return;
      try {
        const serialized = JSON.stringify(message.target);
        if (!serialized || serialized.length > 250000) throw new Error('选中范围过大，请缩小范围。');
        const target = JSON.parse(serialized);
        if (!target || target.kind !== (isPdf(data) && mode === 'element' ? 'region' : mode) || typeof target.selector !== 'string' || target.selector.length > 4096) return;
        core.validateTarget(target, target.kind);
        if(Number.isSafeInteger(message.selectionSerial) && message.selectionSerial>=0)latestSelectionSerial=message.selectionSerial;
        layout.reveal();setTarget(target); note(editingId ? '新位置已选中，点击「更新批注」保存；原位置会保留作记录。' : '目标已选中，请填写修改意见。');
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
  }
  window.addEventListener('message', event => { const message=event.data; if(!isPdf(data) && event.source===frame.contentWindow && message?.hr===true && message.channel===channel) handlePreviewMessage(message); });
  $('cancel-conversion').addEventListener('click',()=>{ if (!cancelPicker()) adapters.cancel(); });
  $('pdf-thumbnail-toggle').addEventListener('click',()=>{const visible=$('pdf-thumbnail-toggle').getAttribute('aria-expanded')!=='true';$('pdf-thumbnail-toggle').setAttribute('aria-expanded',String(visible));send('set-thumbnails',{visible});});
  $('pdf-search-edit').addEventListener('click',()=>{renderDocumentNavigation();window.HRUI.openDialog($('document-nav-dialog'));$('document-search').focus();$('document-search').select();});
  $('pdf-search-prev').addEventListener('click',()=>send('search-step',{direction:-1}));
  $('pdf-search-next').addEventListener('click',()=>send('search-step',{direction:1}));
  $('pdf-search-close').addEventListener('click',()=>{$('document-search').value='';clearTimeout(searchTimer);send('cancel-search');$('pdf-search-bar').hidden=true;renderDocumentNavigation();});
  $('pdf-use-region').addEventListener('click',()=>{setMode('element');$('pdf-scan-guide').hidden=true;});
  $('confirm-location').addEventListener('click',confirmLocation);$('confirm-preview-location').addEventListener('click',confirmLocation);
  $('result-review-start').addEventListener('click',()=>startResultReview());
  $('result-review-reload').addEventListener('click',reloadSource);
  $('workflow-primary').addEventListener('click',()=>{if(busy || !data)return;const action=$('workflow-primary').dataset.action;if(action==='handoff')openHandoff();else if(action==='save')saveAnnotation();else {layout?.reveal(); $('comment-input').focus();$('comment-input').scrollIntoView({block:'nearest',behavior:'smooth'});}});
  $('workflow-return').addEventListener('click',openReturnSteps);
  $('handoff-show-return').addEventListener('click',openReturnSteps);
  $('return-review').addEventListener('click',()=>{if($('return-review').disabled)return;window.HRUI.closeDialog($('return-dialog'));startResultReview();});
  $('review-previous').addEventListener('click',()=>moveResultReview(-1));
  $('review-next').addEventListener('click',()=>moveResultReview(1));
  $('review-current-document').addEventListener('click',()=>{if(inspectionAnnotation()){window.HRUI.closeDialog($('location-dialog'));$('location-preview-bar').hidden=false;$('location-preview-label').textContent='正在核对当前文档。返回对照后可以继续下一条。';$('confirm-preview-location').hidden=true;}});
  $('return-location-comparison').addEventListener('click',()=>{if(inspectionAnnotation())window.HRUI.openDialog($('location-dialog'));});
  $('reselect-location').addEventListener('click',()=>{const annotation=inspectionAnnotation();window.HRUI.closeDialog($('location-dialog'));$('location-preview-bar').hidden=true;locationInspection=null;if(annotation)reselect(annotation);});
  $('handoff-export-package').addEventListener('click',()=>run(async()=>{if(!data || draftDirty())return;const result=await window.HRHandoff.create(data);downloadBlob(result.blob,result.filename);rememberHandoff();$('copy-agent-status').textContent='交接包已下载。将 ZIP 附给 agent，让它读取包内任务说明。';}));
  $('backup-menu').querySelector('summary').addEventListener('click',event=>{event.preventDefault();if(!$('backup-menu').open && $('export-format').value==='annotations'){$('export-format').value='html';updateExportFormat();}window.HRUI.toggleBackup();});
  document.addEventListener('click',event=>{if(!$('backup-menu').contains(event.target) && !event.target.closest('.select-popover'))window.HRUI.closeBackup();});
  $('pdf-prev-page').addEventListener('click',()=>window.HRPdf.goToPage(Math.max(1,Number($('pdf-page-number').value)-1)));
  $('pdf-next-page').addEventListener('click',()=>window.HRPdf.goToPage(Math.min(Number($('pdf-page-number').max)||1,Number($('pdf-page-number').value)+1)));
  $('pdf-page-number').addEventListener('change',()=>window.HRPdf.goToPage(Number($('pdf-page-number').value)));
  $('pdf-zoom').addEventListener('change',event=>window.HRPdf.setZoom(event.target.value==='fit' ? 'fit' : Number(event.target.value)));
  $('pdf-cancel-operation').addEventListener('click',()=>{ send('cancel-operations'); clearTimeout(locationTimer); locationRequest=null; if(locationReview) {locationReview.checking=false;locationReview.queue=[];renderLocationReview();} $('pdf-cancel-operation').hidden=true; $('pdf-operation-status').textContent='已取消查找 / 检查'; });
  $('pair-source-button').addEventListener('click',()=>openHTML());
  $('pair-compatible').addEventListener('click',()=>openCompatible());
  $('cancel-pair').addEventListener('click',()=>{pendingLight=null;$('pair-source').hidden=true;note('已取消恢复，当前工作区已保留。');});
  $('open-button').addEventListener('click', () => openHTML());
  $('welcome-open').addEventListener('click', () => openHTML());
  $('handoff-button').addEventListener('click', openHandoff);
  $('document-nav-button').addEventListener('click', () => { $('pdf-cancel-search').hidden=!isPdf(data); renderDocumentNavigation(); window.HRUI.openDialog($('document-nav-dialog')); $('document-search').focus(); });
  $('pdf-cancel-search').addEventListener('click',()=>{ clearTimeout(searchTimer); send('cancel-search'); $('document-search-status').textContent='已取消查找'; });
  $('document-search').addEventListener('input', () => {
    clearTimeout(searchTimer); if(isPdf(data)) send('cancel-search'); renderDocumentNavigation();
    const query = $('document-search').value.trim();
    if (query) searchTimer = setTimeout(() => send('search-document', {query}), 150);
  });
  $('handoff-import-results').addEventListener('click', () => { window.HRUI.closeDialog($('return-dialog')); $('results-input').click(); });
  $('handoff-reload').addEventListener('click', () => { window.HRUI.closeDialog($('return-dialog')); reloadSource(); });
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
    if ($('export-format').value === 'annotations') note(isPdf(data) ? '轻量批注需与原始 PDF 一起保留、交给 agent；选择相同版本原文件可恢复批注。' : isDocx(data) ? '轻量批注不含原文件快照，请将 JSON 与原始 DOCX 一起保留、交给 agent；原文件匹配后可恢复批注。' : '轻量批注不包含原文件快照或编辑界面，请与原始 HTML 和相关资源一起保留、交给 agent。');
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
    if (button.dataset.action === 'details') toggleAnnotationDetails(annotation,button.closest('.annotation-card'));
    else if (button.dataset.action === 'select') selectAnnotation(annotation);
    else if (button.dataset.action === 'review-result') startResultReview(annotation.id);
    else if (button.dataset.action === 'review-location') {resultReviewQueue=null;inspectLocation(annotation);}
    else if (button.dataset.action === 'locate') locate(annotation);
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

  $('annotation-previous').addEventListener('click',()=>moveAnnotation(-1));
  $('annotation-next').addEventListener('click',()=>moveAnnotation(1));
  $('annotation-filter').addEventListener('change', renderAnnotations);
  $('import-results').addEventListener('click', () => $('results-input').click());
  $('results-input').addEventListener('change', async event => {
    const file = event.target.files[0]; event.target.value = '';
    if (file && data) await run(() => importResults(file));
  });
  $('copy-agent-text').addEventListener('click', async () => {
    const stamp=workflowStamp();
    try { await navigator.clipboard.writeText($('agent-task-text').value); $('copy-agent-status').textContent = '已复制。请附上原文档，再粘贴到 agent 对话中。'; rememberHandoff(stamp); }
    catch (_) { $('task-details').open = true; $('agent-task-text').focus(); $('agent-task-text').select(); $('copy-agent-status').textContent = '已选中，请按 Ctrl / ⌘ + C 复制。'; }
  });
  $('workflow-details-toggle').addEventListener('click', () => { workflowDetailsOpen = $('workflow-details-toggle').getAttribute('aria-expanded') !== 'true'; if (!workflowDetailsOpen && !guideDismissed) { guideDismissed = true; try { localStorage.setItem(guideKey,'true'); } catch (_) {} } updateGuide(); });
  $('target-summary-toggle').addEventListener('click', () => {
    const expanded = $('target-summary-toggle').getAttribute('aria-expanded') !== 'true';
    window.HRUI.reflow($('target-preview'), () => {
      $('target-preview').dataset.expanded = String(expanded);
      $('target-summary-toggle').setAttribute('aria-expanded', String(expanded));
      $('target-summary-toggle').textContent = expanded ? '收起摘要' : '展开摘要';
    });
  });
  $('onboarding-dismiss').addEventListener('click', () => { workflowDetailsOpen = null; guideDismissed = true; try { localStorage.setItem(guideKey, 'true'); } catch (_) {} updateGuide(); });
  $('restart-guide').addEventListener('click', () => { workflowDetailsOpen = null; guideDismissed = false; try { localStorage.removeItem(guideKey); } catch (_) {} window.HRUI.closeDialog($('settings-dialog')); updateGuide(); });
  $('recover-session').addEventListener('click', () => run(async () => { const record = cachedSession; if (record && (!data || confirmDiscard())) await restoreSession(record); }));
  $('discard-session').addEventListener('click', () => run(clearRecovery));
  $('clear-recovery').addEventListener('click', () => run(clearRecovery));
  $('retry-recovery').addEventListener('click', () => run(retryRecovery));
  window.addEventListener('keydown', event => {
    if(event.key==='Escape' && event.target===$('sidebar-resizer') && workspace.classList.contains('is-resizing')) return;
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
  layout=window.HRWorkspaceLayout.mount({workspace,sidebar:$('review-sidebar'),separator:$('sidebar-resizer'),toggles:[$('sidebar-toggle'),$('sidebar-rail-toggle')],onChange:queueAutosave});
  restoreSidebarPosition(); updateExportFormat(); resetFolder(); clearEditor(); setMode('browse'); applyWidth();
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.removeAttribute('open');
  bootPromise = initialize();
  // A trial link opens the example once; existing work and pending recovery take priority.
  bootPromise.then(async () => {
    const pending=document.getElementById('html-review-pending-annotations');
    if(pending?.textContent && pending.textContent.trim()!=='null') {
      try {const imported=JSON.parse(pending.textContent);await core.validateAnnotationExport(imported);pendingLight=imported;$('pair-source').hidden=false;note('请选配套原始 DOCX 或 PDF 恢复轻量批注。');}catch(error){note(error.message,true);}
    }
    if (new URL(location.href).searchParams.get('demo') === '1' && !data && !cachedSession) return run(openExample);
  });
})();
