(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const core = window.HRCore;
  const frame = $('preview-frame');
  const labels = {text: '文字', element: '元素', page: '整页'};
  const hints = {
    browse: '可以正常阅读和点击页面。切换到文字或元素模式开始批注。',
    text: '在右侧拖选文字，再填写修改意见。可跨越相邻的行内标签。',
    element: '点击右侧元素；使用「选父级容器」可指定卡片、区块等布局区域。',
    page: '描述页面整体布局、间距或视觉风格。批注会记录当前视口宽度。'
  };
  let data = null;
  let mode = 'browse';
  let channel = '';
  let previewReady = false;
  let pendingTarget = null;
  let editingId = null;
  let draftBaseline = '';
  let draftTargetChanged = false;
  let dirty = false;
  let busy = false;
  let folderFiles = null;
  let folderEntries = [];
  let currentEntryPath = '';
  let renderGeneration = 0;
  const locations = new Map();

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
    const title = document.createElement('strong');
    title.textContent = '预览提示';
    box.append(title);
    const list = document.createElement('ul');
    const unique = Array.from(new Set(warnings));
    for (const warning of unique.slice(0, 8)) { const item = document.createElement('li'); item.textContent = warning; list.append(item); }
    if (unique.length > 8) { const item = document.createElement('li'); item.textContent = `还有 ${unique.length - 8} 项类似资源提示。`; list.append(item); }
    box.append(list);
  }
  function setBusy(value) {
    busy = value;
    $('open-button').disabled = value;
    $('folder-button').disabled = value;
    $('example-button').disabled = value;
    $('entry-select').disabled = value;
    $('download-button').disabled = value || !data;
    $('reload-preview').disabled = value || !data;
    $('data-button').disabled = value || !data;
    updateEditor();
  }
  function draftDirty() { return $('comment-input').value !== draftBaseline || (draftTargetChanged && Boolean($('comment-input').value.trim())); }
  function confirmDiscard() {
    return !(dirty || draftDirty()) || confirm('当前修改还未下载保存。确定打开其他页面并放弃这些修改吗？');
  }
  function markDirty() { dirty = true; data.updatedAt = new Date().toISOString(); updateSaveState(); }
  function updateSaveState() { $('save-state').textContent = dirty ? '● 有未下载的修改，请下载副本保存' : (data ? '副本可直接重新打开并继续编辑' : '批注保存在下载的副本中'); }
  function view() {
    return {width: Math.round(frame.clientWidth), height: Math.round(frame.clientHeight), devicePixelRatio: window.devicePixelRatio || 1};
  }
  function pageTarget() {
    let title = data.source.name;
    try { title = new DOMParser().parseFromString(core.getSourceText(data), 'text/html').title || title; } catch (_) { /* Filename remains a useful fallback. */ }
    return {kind: 'page', text: title, scope: 'whole-document', context: {sourcePath: data.source.path}, viewport: view()};
  }
  function send(command, extra = {}) {
    if (frame.contentWindow && channel) frame.contentWindow.postMessage({hr: true, channel, command, ...extra}, '*');
  }
  function setMode(next) {
    if (!['browse', 'text', 'element', 'page'].includes(next)) return;
    mode = next;
    for (const button of document.querySelectorAll('[data-mode]')) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    $('mode-hint').textContent = data ? hints[mode] : '先打开 HTML，或体验下方示例。';
    send('set-mode', {mode: mode === 'page' ? 'browse' : mode});
    if (mode === 'page' && data) setTarget(pageTarget());
  }
  function targetText(target) {
    if (target.kind === 'page') return `整页 · ${target.text || data.source.name}`;
    return target.quote?.exact || target.text || target.attributes?.alt || `<${target.tag || '元素'}> ${target.selector || ''}`;
  }
  function setTarget(target) {
    pendingTarget = target;
    draftTargetChanged = true;
    $('target-preview').hidden = false;
    $('target-kind').textContent = labels[target.kind] || '目标';
    const text = targetText(target);
    $('target-text').textContent = text.length > 600 ? text.slice(0, 600) + '…' : text;
    $('target-selector').textContent = target.selector || `视口 ${target.viewport?.width || view().width} × ${target.viewport?.height || view().height}px`;
    $('parent-target').hidden = target.kind !== 'element';
    updateEditor();
  }
  function updateEditor() {
    $('comment-input').disabled = !data || busy;
    $('save-button').disabled = !data || busy || !pendingTarget || !$('comment-input').value.trim();
    $('draft-status').textContent = draftDirty() ? '尚未保存' : '';
    $('save-button').textContent = editingId ? '更新批注' : '保存批注';
    $('editor-title').textContent = editingId ? '编辑批注' : '添加批注';
    $('cancel-edit').hidden = !editingId && !pendingTarget && !$('comment-input').value;
  }
  function clearEditor() {
    pendingTarget = null;
    editingId = null;
    draftBaseline = '';
    draftTargetChanged = false;
    $('comment-input').value = '';
    $('target-preview').hidden = true;
    send('clear-focus');
    updateEditor();
  }
  function resetFolder() {
    folderFiles = null;
    folderEntries = [];
    currentEntryPath = '';
    $('entry-label').hidden = true;
    $('entry-select').replaceChildren();
  }
  function renderSource() {
    $('source-name').textContent = data.source.name;
    $('source-meta').textContent = `${(data.source.byteLength / 1024).toFixed(1)} KiB · ${data.source.encoding} · ${data.resources.length} 个内嵌资源`;
    $('source-version').hidden = false;
    $('source-version').textContent = `SHA-256 ${data.source.sha256.slice(0, 16)}…`;
    $('source-version').title = data.source.sha256;
    $('preview-label').textContent = data.source.path;
    document.title = `${data.source.name} · HTML 批注`;
    $('welcome').hidden = true;
    frame.hidden = false;
    $('mode-hint').textContent = hints[mode];
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
    list.replaceChildren();
    const annotations = data?.annotations || [];
    $('annotation-count').textContent = annotations.length;
    if (!annotations.length) { list.append(textNode('p', 'empty-list', '还没有批注。选择内容后，说明希望怎么修改。')); return; }
    annotations.forEach((annotation, index) => {
      const card = document.createElement('article');
      card.className = 'annotation-card' + (editingId === annotation.id ? ' active' : '');
      card.dataset.annotationId = annotation.id;
      const top = document.createElement('div'); top.className = 'annotation-top';
      top.append(textNode('span', 'tag', labels[annotation.kind]), textNode('span', 'annotation-number', String(index + 1).padStart(2, '0')));
      card.append(top, textNode('p', 'annotation-comment', annotation.comment));
      card.append(textNode('div', 'annotation-quote', targetText(annotation.target).slice(0, 180)));
      const location = locations.get(annotation.id);
      if (location) { const line = textNode('div', 'location-status ' + location.status, location.message); card.append(line); }
      const actions = document.createElement('div'); actions.className = 'annotation-actions';
      for (const [action, label] of [['locate', '定位'], ['edit', '编辑'], ['delete', '删除']]) {
        const button = textNode('button', 'text-button' + (action === 'delete' ? ' delete-button' : ''), label);
        button.type = 'button'; button.dataset.action = action; button.dataset.id = annotation.id;
        actions.append(button);
      }
      card.append(actions); list.append(card);
    });
  }
  async function preparePreview(nextData) {
    const nextChannel = id();
    const bridge = `(${window.HRBridge.toString()})(${JSON.stringify(nextChannel)});`;
    const result = await core.createPreview(nextData, bridge);
    return {...result, channel: nextChannel};
  }
  function installPreview(result) {
    previewReady = false;
    channel = result.channel;
    const localChannel = result.channel;
    locations.clear();
    showWarnings(result.warnings);
    frame.srcdoc = result.html;
    renderAnnotations();
    setTimeout(() => {
      if (channel === localChannel && !previewReady) note('页面已载入，但批注定位脚本未响应。原页面可能存在脚本错误、跳转或不支持的结构；可重载或改用普通静态 HTML。', true);
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
    await core.validateData(nextData);
    const prepared = await preparePreview(nextData);
    data = nextData;
    dirty = false;
    clearEditor();
    setMode('browse');
    renderSource();
    renderAnnotations();
    ++renderGeneration;
    installPreview(prepared);
    note(`已打开 ${data.source.name}，载入 ${data.annotations.length} 条批注。`);
  }
  async function readFile(file, path = file.name, resources = []) {
    if (file.size > 100 * 1024 * 1024) throw new Error('待导入文件超过 100 MiB。');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const decoded = core.decodeBytes(bytes);
    const parsed = new DOMParser().parseFromString(decoded.text, 'text/html');
    const nodes = parsed.querySelectorAll('script#html-review-data[type="application/json"]');
    if (nodes.length) {
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
    if (busy) return;
    setBusy(true);
    note('正在处理本地文件…');
    try { await task(); } catch (error) { note(error.message || String(error), true); }
    finally { setBusy(false); }
  }
  function folderPath(file) {
    const path = (file.webkitRelativePath || file.name).replace(/\\/g, '/');
    return file.webkitRelativePath ? path.split('/').slice(1).join('/') : path;
  }
  async function readFolderEntry(path, files) {
    const entry = files.find(file => folderPath(file) === path);
    if (!entry) throw new Error('找不到所选 HTML 文件。');
    const resources = [];
    for (const file of files) {
      if (file === entry) continue;
      resources.push({path: folderPath(file), bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type});
    }
    return readFile(entry, path, resources);
  }
  async function openFolderEntry(path) {
    const nextData = await readFolderEntry(path, folderFiles);
    await activate(nextData);
    currentEntryPath = path;
    $('entry-select').value = path;
    $('entry-label').hidden = false;
  }
  function saveAnnotation() {
    const comment = $('comment-input').value.trim();
    if (!data || !pendingTarget || !comment) { note('请先选择批注目标并填写修改意见。', true); return; }
    if (data.annotations.length >= 10000 && !editingId) { note('单个副本最多支持 10000 条批注。', true); return; }
    const now = new Date().toISOString();
    const existing = editingId && data.annotations.find(annotation => annotation.id === editingId);
    if (pendingTarget.kind === 'page') pendingTarget.viewport = view();
    const annotation = {id: existing?.id || id(), kind: pendingTarget.kind, comment, createdAt: existing?.createdAt || now, updatedAt: now, target: structuredClone(pendingTarget), view: view()};
    if (existing) data.annotations[data.annotations.indexOf(existing)] = annotation;
    else data.annotations.push(annotation);
    markDirty(); clearEditor(); renderAnnotations();
    note(existing ? '批注已更新，下载副本即可保存到磁盘。' : '批注已添加，下载副本即可保存到磁盘。');
  }
  function locate(annotation) {
    if (annotation.kind === 'page') {
      const width = annotation.view?.width || annotation.target.viewport?.width;
      const available = ['390', '768', '1280'];
      note(`整页批注：${annotation.target.text || data.source.name}。记录视口 ${width || '未知'} × ${annotation.view?.height || annotation.target.viewport?.height || '未知'}px；请结合当前布局查看。`);
      if (available.includes(String(width))) { $('preview-width').value = String(width); applyWidth(); }
      locations.set(annotation.id, {status: 'exact', message: '整页反馈 · 结合记录视口查看'});
      renderAnnotations(); return;
    }
    if (!previewReady) { note('页面还在载入，请稍后定位。', true); return; }
    send('locate', {target: annotation.target, requestId: annotation.id});
  }
  function edit(annotation) {
    if (draftDirty() && !confirm('编辑框中有未保存的修改。确定切换到这条批注吗？')) return;
    editingId = annotation.id;
    $('comment-input').value = annotation.comment;
    draftBaseline = annotation.comment;
    setMode(annotation.kind);
    setTarget(structuredClone(annotation.target));
    draftTargetChanged = false;
    updateEditor(); renderAnnotations(); locate(annotation);
    $('comment-input').focus();
  }
  async function download() {
    if (draftDirty()) { note('编辑框中还有未保存的修改，请先点击「保存批注」或「更新批注」，再下载副本。', true); return; }
    await core.validateData(data);
    const copy = document.documentElement.cloneNode(true);
    copy.querySelector('#html-review-data').textContent = core.serialize(data);
    const copiedFrame = copy.querySelector('#preview-frame');
    copiedFrame.removeAttribute('srcdoc'); copiedFrame.removeAttribute('src'); copiedFrame.hidden = true;
    for (const dialog of copy.querySelectorAll('dialog[open]')) dialog.removeAttribute('open');
    // Rebuilt on startup. Do not serialize transient editor/list state or duplicate page bytes.
    copy.querySelector('#annotation-list').replaceChildren();
    copy.querySelector('#comment-input').textContent = '';
    copy.querySelector('#target-preview').hidden = true;
    copy.querySelector('#data-preview').textContent = '';
    copy.querySelector('#entry-select').replaceChildren();
    copy.querySelector('#entry-label').hidden = true;
    copy.querySelector('#status').hidden = true;
    copy.querySelector('#warnings').replaceChildren(); copy.querySelector('#warnings').hidden = true;
    const html = '<!doctype html>\n' + copy.outerHTML;
    const blob = new Blob([html], {type: 'text/html;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = data.source.name.replace(/\.(html?|xhtml)$/i, '').replace(/[\\/:*?"<>|]/g, '_') + '.review.html';
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    dirty = false; updateSaveState();
    note('已生成下载副本。请确认浏览器完成下载；以后直接打开该副本即可继续编辑。');
  }
  function applyWidth() {
    const value = $('preview-width').value;
    frame.style.width = value === 'fluid' ? '100%' : `${Number(value)}px`;
    frame.style.minWidth = value === 'fluid' ? '0' : `${Number(value)}px`;
    if (pendingTarget?.kind === 'page') setTarget({...pendingTarget, viewport: view()});
  }

  window.addEventListener('message', event => {
    const message = event.data;
    if (event.source !== frame.contentWindow || !message || message.hr !== true || message.channel !== channel || !data) return;
    if (message.event === 'ready') { previewReady = true; send('set-mode', {mode: mode === 'page' ? 'browse' : mode}); }
    else if (message.event === 'target') {
      if (!['text', 'element'].includes(mode)) return;
      try {
        const serialized = JSON.stringify(message.target);
        if (!serialized || serialized.length > 250000) throw new Error('选中范围过大，请缩小范围。');
        const target = JSON.parse(serialized);
        if (!target || target.kind !== mode || typeof target.selector !== 'string' || target.selector.length > 4096) return;
        core.validateTarget(target, target.kind);
        setTarget(target); note('目标已选中，请填写修改意见。');
      } catch (error) { note(error.message, true); }
    } else if (message.event === 'located') {
      if (!data.annotations.some(annotation => annotation.id === message.requestId) || !['exact', 'fallback', 'ambiguous', 'missing'].includes(message.status)) return;
      const description = {exact: '已定位并核对内容', fallback: '通过上下文重新定位', ambiguous: '存在多个候选，需人工确认', missing: '目标无法确认，原页面可能已变化'}[message.status];
      const reason = typeof message.reason === 'string' ? message.reason.slice(0, 500) : '';
      locations.set(message.requestId, {status: message.status, message: description + (reason ? ' · ' + reason : '')});
      renderAnnotations(); note(description, ['missing', 'ambiguous'].includes(message.status));
    } else if (message.event === 'warning' && typeof message.message === 'string') note(message.message.slice(0, 1500), true);
  });
  $('open-button').addEventListener('click', () => $('file-input').click());
  $('folder-button').addEventListener('click', () => $('folder-input').click());
  $('file-input').addEventListener('change', async event => {
    const file = event.target.files[0]; event.target.value = '';
    if (!file || !confirmDiscard()) return;
    await run(async () => { const nextData = await readFile(file); await activate(nextData); resetFolder(); });
  });
  $('folder-input').addEventListener('change', async event => {
    const files = Array.from(event.target.files); event.target.value = '';
    if (!files.length || !confirmDiscard()) return;
    await run(async () => {
      if (files.length > 500 || files.reduce((size, file) => size + file.size, 0) > 50 * 1024 * 1024) throw new Error('文件夹最多 500 个文件、合计最多 50 MiB。请选择只包含页面所需资源的目录。');
      const entries = files.filter(file => /\.html?$/i.test(file.name)).sort((a, b) => folderPath(a).localeCompare(folderPath(b)));
      if (!entries.length) throw new Error('所选文件夹没有 HTML 文件。');
      const preferred = entries.find(file => /^index\.html?$/i.test(folderPath(file))) || entries[0];
      const preferredPath = folderPath(preferred);
      const nextData = await readFolderEntry(preferredPath, files);
      await activate(nextData);
      folderFiles = files; folderEntries = entries; currentEntryPath = preferredPath;
      $('entry-select').replaceChildren();
      for (const file of entries) { const option = document.createElement('option'); option.value = folderPath(file); option.textContent = folderPath(file); $('entry-select').append(option); }
      $('entry-select').value = preferredPath;
      $('entry-label').hidden = false;
    });
  });
  $('entry-select').addEventListener('change', async event => {
    const path = event.target.value;
    if (!confirmDiscard()) { event.target.value = currentEntryPath; return; }
    await run(async () => { try { await openFolderEntry(path); } catch (error) { $('entry-select').value = currentEntryPath; throw error; } });
  });
  $('example-button').addEventListener('click', () => run(async () => {
    if (!confirmDiscard()) return;
    const example = JSON.parse($('html-review-example').textContent);
    const nextData = await core.importSource({bytes: core.base64ToBytes(example.base64), name: example.name});
    await activate(nextData); resetFolder();
  }));
  for (const button of document.querySelectorAll('[data-mode]')) button.addEventListener('click', () => { if (data) setMode(button.dataset.mode); });
  $('comment-input').addEventListener('input', updateEditor);
  $('comment-input').addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); saveAnnotation(); } });
  $('save-button').addEventListener('click', saveAnnotation);
  $('cancel-edit').addEventListener('click', () => { if (!draftDirty() || confirm('确定放弃编辑框中尚未保存的修改吗？')) { clearEditor(); setMode('browse'); renderAnnotations(); } });
  $('parent-target').addEventListener('click', () => send('parent-target'));
  $('download-button').addEventListener('click', () => run(download));
  $('reload-preview').addEventListener('click', () => run(async () => { await renderPreview(); note('预览已重新载入。页面脚本运行状态已重置，已有批注保留。'); }));
  $('preview-width').addEventListener('change', applyWidth);
  $('annotation-list').addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button || !data) return;
    const annotation = data.annotations.find(item => item.id === button.dataset.id);
    if (!annotation) return;
    if (button.dataset.action === 'locate') locate(annotation);
    else if (button.dataset.action === 'edit') edit(annotation);
    else if (button.dataset.action === 'delete' && confirm('确定删除这条批注吗？')) {
      data.annotations = data.annotations.filter(item => item.id !== annotation.id);
      if (editingId === annotation.id) clearEditor();
      locations.delete(annotation.id); markDirty(); renderAnnotations(); note('批注已删除，下载新副本即可保存。');
    }
  });
  $('help-button').addEventListener('click', () => $('help-dialog').showModal());
  $('data-button').addEventListener('click', () => {
    const summary = { ...data, source: {...data.source, base64: `[已省略 ${data.source.byteLength} 个原始字节]`}, resources: data.resources.map(resource => ({...resource, base64: '[已省略资源字节]'})) };
    $('data-preview').textContent = JSON.stringify(summary, null, 2); $('data-dialog').showModal();
  });
  for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => $(button.dataset.close).close());
  window.addEventListener('beforeunload', event => { if (dirty || draftDirty()) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('keydown', event => { if (event.key === 'Escape' && !document.querySelector('dialog[open]')) setMode('browse'); });
  // Exports carry the runtime, not a session snapshot. Always rehydrate from verified JSON.
  resetFolder(); clearEditor(); setMode('browse'); applyWidth();
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.removeAttribute('open');
  let initial;
  try { initial = JSON.parse($('html-review-data').textContent); }
  catch (_) { note('批注数据不是有效 JSON，无法恢复。', true); }
  if (initial) run(() => activate(initial));
  else { setBusy(false); $('welcome').hidden = false; frame.hidden = true; }
})();
