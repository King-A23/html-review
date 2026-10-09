/* Offline UI primitives. Native form values remain the source of truth. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const paths = {
    mark: '<path d="m5 3 14 14-3 4-4-1L2 6zM5 3l3-1 14 14-3 1M3 7l14 14M12 20l4 1-1-4"/>',
    settings: '<path d="m10 3-.5 2-2 1-2-.6-2 3 1.5 1.6v2L3.5 14l2 3 2-.6 2 1 .5 2h4l.5-2 2-1 2 .6 2-3-1.5-1.5v-2L21 9l-2-3-2 .6-2-1-.5-2z"/><circle cx="12" cy="11.5" r="3"/>',
    folder: '<path d="M3 6h7l2 2h9v11H3zM3 6V4h7l2 2h8v2"/>',
    file: '<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6"/>',
    'file-plus': '<path d="M6 3h8l4 4v7M14 3v5h4M6 3v18h7M18 16v6M15 19h6"/>',
    'arrow-right': '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    'arrow-up-right': '<path d="M6 18 18 6M6 6h12v12"/>',
    'chevron-up': '<path d="m6 15 6-6 6 6"/>', 'chevron-down': '<path d="m6 9 6 6 6-6"/>', check: '<path d="m5 12 4 4L19 6"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
    crosshair: '<circle cx="12" cy="12" r="6"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>',
    layout: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6"/>',
    undo: '<path d="M8 5 3 10l5 5M3 10h10a6 6 0 0 1 0 12"/>', redo: '<path d="m16 5 5 5-5 5M21 10H11a6 6 0 0 0 0 12"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5M19 11a7 7 0 0 0-12-5L4 9m1 4a7 7 0 0 0 12 5l3-3"/>',
    history: '<path d="M3 4v5h5M4 8a9 9 0 1 1-1 8M12 7v5l3 2"/>',
    book: '<path d="M12 5v15M3 4h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v15h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3z"/>',
    command: '<path d="M9 9h6v6H9zM9 9H6a3 3 0 1 1 3-3v3m6 0V6a3 3 0 1 1 3 3h-3m0 6h3a3 3 0 1 1-3 3v-3m-6 0v3a3 3 0 1 1-3-3h3"/>',
    'panel-left': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M5.5 8h1m-1 4h1"/>',
    'panel-right': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16m2.5-12h1m-1 4h1"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5"/>',
    code: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-12-2 18"/>'
  };
  const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.file}</svg>`;
  for (const node of document.querySelectorAll('[data-icon]')) node.innerHTML = icon(node.dataset.icon);
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  for (const node of document.querySelectorAll('[data-mod-key]')) node.textContent = mac ? '⌘' : 'Ctrl';
  const openHint = document.querySelector('.welcome-shortcut kbd'); if (openHint) openHint.textContent = mac ? '⌘' : 'Ctrl';
  const saveHint = document.querySelector('.save-key-hint');
  if (saveHint) saveHint.textContent = mac ? '⌘ ↵' : 'Ctrl ↵';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const ease = 'cubic-bezier(.22, 1, .36, 1)';
  const activeAnimations = new Set();
  function track(animation) {
    activeAnimations.add(animation);
    animation.finished.then(() => activeAnimations.delete(animation), () => activeAnimations.delete(animation));
    return animation;
  }
  function animate(element, frames, options = {}) {
    if (reducedMotion.matches) return null;
    return track(element.animate(frames, {duration: 300, easing: ease, ...options}));
  }
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) for (const animation of activeAnimations) { try { animation.finish(); } catch (_) { animation.cancel(); } }
  });
  const disclosures = new WeakMap();
  function disclose(element, open, motion = true) {
    const previous = disclosures.get(element);
    if (previous?.open === open) return;
    const height = element.hidden ? 0 : element.getBoundingClientRect().height;
    const opacity = element.hidden ? 0 : Number(getComputedStyle(element).opacity);
    previous?.animation?.cancel();
    const record = {open, animation: null}; disclosures.set(element, record);
    element.inert = !open;
    element.setAttribute('aria-hidden', String(!open));
    if (!motion || reducedMotion.matches || (!open && element.hidden)) { element.hidden = !open; return; }
    element.hidden = false;
    record.animation = animate(element, [
      {height: height + 'px', opacity},
      {height: (open ? element.scrollHeight : 0) + 'px', opacity: open ? 1 : 0}
    ], {duration: open ? 300 : 190, fill: 'both'});
    record.animation.finished.then(() => {
      if (disclosures.get(element) !== record) return;
      element.hidden = !open; record.animation.cancel(); record.animation = null;
    }, () => {});
  }
  const reflows = new WeakMap();
  function reflow(element, change) {
    const height = element.getBoundingClientRect().height;
    reflows.get(element)?.cancel();
    change();
    const nextHeight = element.getBoundingClientRect().height;
    const animation = animate(element, [{height: height + 'px'}, {height: nextHeight + 'px'}], {duration: 280});
    if (animation) reflows.set(element, animation);
  }
  const scopeAnimations = new WeakMap();
  function scopeChanged(badge, preview) {
    if (preview) reflows.get(preview)?.cancel();
    for (const element of [badge, preview].filter(Boolean)) {
      scopeAnimations.get(element)?.cancel();
      const animation = animate(element, [{opacity: .5, transform: 'translateY(3px)'}, {opacity: 1, transform: 'translateY(0)'}], {duration: 220});
      if (animation) scopeAnimations.set(element, animation);
    }
  }
  // Each surface keeps one timeline. Reversing it preserves its current geometry.
  function drive(record, opening, finish) {
    const revision = ++record.revision;
    record.state = opening ? 'opening' : 'closing';
    record.element.dataset.motion = record.state;
    if (reducedMotion.matches || !record.animations.length) { finish(); return; }
    const time = record.animations[0].currentTime ?? 0;
    if ((!opening && time <= 0) || (opening && time >= record.duration)) { finish(); return; }
    for (const animation of record.animations) {
      animation.updatePlaybackRate(opening ? 1 : -1.5);
      animation.play(); track(animation);
    }
    record.animations[0].finished.then(() => { if (record.revision === revision) finish(); }, () => {});
  }
  function surface(element, frames, duration, extras = []) {
    const animations = reducedMotion.matches ? [] : [element.animate(frames, {duration, easing: ease, fill: 'both'}), ...extras];
    for (const animation of animations) { animation.pause(); animation.currentTime = 0; }
    return {element, animations, duration, revision: 0, state: 'closed'};
  }
  let menu = null;
  const fields = new Map();
  function disposeMenu(current) {
    ++current.motion.revision;
    current.popup.remove(); for (const animation of current.motion.animations) animation.cancel();
    if (menu === current) menu = null;
  }
  function closeMenu(restoreFocus = false, immediate = false) {
    if (!menu) return false;
    const current = menu;
    current.trigger.setAttribute('aria-expanded', 'false'); current.trigger.removeAttribute('aria-controls');
    current.popup.inert = true; current.popup.setAttribute('aria-hidden', 'true');
    if (restoreFocus) current.trigger.focus({preventScroll: true});
    if (immediate) disposeMenu(current);
    else if (current.motion.state !== 'closing') drive(current.motion, false, () => disposeMenu(current));
    return true;
  }
  function syncSelect(id) {
    const field = fields.get(id); if (!field) return;
    field.label.textContent = field.select.selectedOptions[0]?.textContent || '请选择';
    field.trigger.disabled = field.select.disabled;
    if (menu?.select === field.select) for (const button of menu.popup.querySelectorAll('.select-option')) button.setAttribute('aria-selected', String(button.dataset.value === field.select.value));
    if (menu?.select === field.select && field.select.disabled) closeMenu();
    if (id === 'sidebar-position') for (const choice of document.querySelectorAll('[data-sidebar-choice]')) choice.setAttribute('aria-pressed', String(choice.dataset.sidebarChoice === field.select.value));
  }
  const exportDetails = {html: ['file', '可继续编辑 · .review.html'], gzip: ['layers', '完整副本，更小体积 · .html.gz'], annotations: ['code', '仅批注数据，不含原文档 · .json']};
  function openMenu(field, last = false) {
    const {select, trigger} = field;
    if (select.disabled) return;
    if (menu?.select === select) {
      const current = menu; current.popup.inert = false; current.popup.removeAttribute('aria-hidden');
      trigger.setAttribute('aria-expanded', 'true'); trigger.setAttribute('aria-controls', current.popup.id);
      drive(current.motion, true, () => { current.motion.state = 'open'; current.popup.dataset.motion = 'open'; });
      (last ? current.buttons.at(-1) : current.buttons.find(button => button.getAttribute('aria-selected') === 'true') || current.buttons[0])?.focus({preventScroll: true});
      return;
    }
    closeMenu(false, true);
    const popup = document.createElement('div'); popup.className = 'select-popover'; popup.id = 'hr-select-popover'; popup.dataset.uiTransient = 'menu'; popup.setAttribute('role', 'listbox'); popup.setAttribute('aria-label', select.getAttribute('aria-label') || '选择选项');
    if (select.id === 'export-format') { const caption = document.createElement('div'); caption.className = 'popover-caption'; caption.textContent = '保存格式'; popup.append(caption); }
    const buttons = [];
    for (const option of select.options) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'select-option'; button.dataset.value = option.value; button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(option.selected)); button.disabled = option.disabled; button.tabIndex = -1;
      const details = select.id === 'export-format' && exportDetails[option.value];
      if (details) { const box = document.createElement('span'); box.className = 'option-icon'; box.innerHTML = icon(details[0]); button.append(box); }
      const copy = document.createElement('span'); copy.className = 'option-copy'; const label = document.createElement('strong'); label.textContent = option.textContent; copy.append(label);
      if (details) { const small = document.createElement('small'); small.textContent = details[1]; copy.append(small); }
      button.append(copy); const check = document.createElement('span'); check.className = 'select-check'; check.innerHTML = icon('check'); button.append(check);
      button.addEventListener('click', () => { select.value = option.value; select.dispatchEvent(new Event('change', {bubbles: true})); syncSelect(select.id); closeMenu(true); });
      popup.append(button); if (!option.disabled) buttons.push(button);
    }
    document.body.append(popup); const rect = trigger.getBoundingClientRect();
    popup.style.width = Math.min(innerWidth - 24, select.id === 'export-format' ? 290 : Math.max(190, rect.width)) + 'px';
    const bounds = popup.getBoundingClientRect(); popup.style.left = Math.max(12, Math.min(rect.left, innerWidth - bounds.width - 12)) + 'px';
    const above = rect.bottom + bounds.height + 8 > innerHeight;
    popup.style.top = Math.max(12, above ? rect.top - bounds.height - 8 : rect.bottom + 8) + 'px';
    popup.style.transformOrigin = Math.max(12, Math.min(bounds.width - 12, rect.left + rect.width / 2 - parseFloat(popup.style.left))) + 'px ' + (above ? 'bottom' : 'top');
    const shift = above ? 8 : -8;
    const rowAnimations = reducedMotion.matches ? [] : buttons.map((button, index) => button.animate([
      {opacity: 0, transform: 'translateY(' + shift / 2 + 'px)', offset: 0},
      {opacity: 0, transform: 'translateY(' + shift / 2 + 'px)', offset: .12 + Math.min(index, 5) * .06, easing: ease},
      {opacity: 1, transform: 'translateY(0)', offset: .87}, {opacity: 1, transform: 'translateY(0)', offset: 1}
    ], {duration: 300, easing: 'linear', fill: 'both'}));
    const motion = surface(popup, [
      {opacity: 0, transform: 'translateY(' + shift + 'px) scale(.985)', clipPath: 'inset(' + (above ? '18% 0 0' : '0 0 18%') + ' 0 round 14px)', boxShadow: '0 3px 12px #24382b00'},
      {opacity: 1, transform: 'translateY(0) scale(1)', clipPath: 'inset(0 round 14px)', boxShadow: '0 16px 48px #24382b1c, 0 3px 8px #24382b09'}
    ], 300, rowAnimations);
    trigger.setAttribute('aria-expanded', 'true'); trigger.setAttribute('aria-controls', popup.id); menu = {...field, popup, buttons, motion, anchor: {top: rect.top, left: rect.left}};
    const current = menu; drive(motion, true, () => { motion.state = 'open'; popup.dataset.motion = 'open'; });
    (last ? buttons.at(-1) : buttons.find(button => button.getAttribute('aria-selected') === 'true') || buttons[0])?.focus({preventScroll: true});
    popup.addEventListener('keydown', event => {
      const index = buttons.indexOf(document.activeElement); let next;
      if (event.key === 'ArrowDown') next = (index + 1) % buttons.length;
      if (event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = buttons.length - 1;
      if (next !== undefined) { event.preventDefault(); buttons[next]?.focus(); }
      if (event.key === 'Tab') closeMenu(true);
    });
  }
  for (const id of ['export-format', 'sidebar-position', 'preview-width', 'pdf-zoom', 'entry-select', 'page-select', 'annotation-filter']) {
    const select = $(id); if (!select) continue;
    let wrapper = select.parentElement.classList.contains('select-field') ? select.parentElement : null;
    if (!wrapper) { wrapper = document.createElement('span'); wrapper.className = 'select-field'; select.before(wrapper); wrapper.append(select); }
    // Exported copies contain the visual controls, but need fresh event bindings.
    let trigger = wrapper.querySelector('.select-trigger');
    if (!trigger) { trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'select-trigger'; trigger.innerHTML = '<span class="select-label"></span>' + icon('chevron-down').replace('class="icon"', 'class="icon select-chevron"'); wrapper.append(trigger); }
    trigger.id = id + '-trigger'; trigger.setAttribute('role', 'combobox'); trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false'); trigger.removeAttribute('aria-controls'); trigger.setAttribute('aria-label', select.getAttribute('aria-label') || (id === 'page-select' ? '选择页面' : '选择入口 HTML'));
    select.classList.add('native-select'); select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
    const field = {select, trigger, label: trigger.querySelector('.select-label')}; fields.set(id, field);
    trigger.addEventListener('click', () => { if (menu?.select === select && menu.motion.state !== 'closing') closeMenu(true); else openMenu(field); });
    trigger.addEventListener('keydown', event => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); openMenu(field, event.key === 'ArrowUp'); } });
    select.addEventListener('change', () => syncSelect(id)); new MutationObserver(() => syncSelect(id)).observe(select, {subtree: true, childList: true, attributes: true}); syncSelect(id);
  }
  document.addEventListener('pointerdown', event => { if (menu && !menu.popup.contains(event.target) && !menu.trigger.contains(event.target)) closeMenu(); }, true);
  window.addEventListener('resize', () => closeMenu()); window.addEventListener('scroll', event => { if (menu && !menu.popup.contains(event.target)) { const rect = menu.trigger.getBoundingClientRect(); if (Math.abs(rect.top - menu.anchor.top) > 1 || Math.abs(rect.left - menu.anchor.left) > 1) closeMenu(); } }, true);
  const backup = $('backup-menu');
  const backupPanel = backup.querySelector('.backup-panel');
  let backupMotion = null;
  function positionBackup() {
    const edge = backup.getBoundingClientRect().right;
    const right = Math.min(innerWidth - 12, Math.max(backupPanel.offsetWidth + 12, edge));
    backupPanel.style.right = (edge - right) + 'px';
  }
  window.addEventListener('resize', () => { if (backup.open) positionBackup(); });
  function toggleBackup() {
    if (backupMotion?.state === 'closing' || !backup.open) {
      backup.open = true; positionBackup();
      if (!backupMotion) {
        backupPanel.style.transformOrigin = 'top right';
        backupMotion = surface(backupPanel, [
          {opacity: 0, transform: 'translateY(-6px) scale(.985)', clipPath: 'inset(0 0 10% 0 round 16px)'},
          {opacity: 1, transform: 'translateY(0) scale(1)', clipPath: 'inset(0 round 16px)'}
        ], 300);
      }
      backupPanel.inert = false; backupPanel.removeAttribute('aria-hidden');
      const record = backupMotion;
      drive(record, true, () => { record.state = 'open'; backupPanel.dataset.motion = 'open'; });
    } else closeBackup();
  }
  function closeBackup(immediate = false) {
    if (!backup.open || (!immediate && backupMotion?.state === 'closing')) return;
    if (!backupMotion) { backup.open = false; return; }
    const record = backupMotion;
    const returnFocus = backupPanel.contains(document.activeElement);
    backupPanel.inert = true; backupPanel.setAttribute('aria-hidden', 'true');
    if (returnFocus) backup.querySelector('summary').focus({preventScroll: true});
    const finish = () => {
      backup.open = false;
      for (const animation of record.animations) animation.cancel();
      delete backupPanel.dataset.motion;
      backupPanel.inert = false; backupPanel.removeAttribute('aria-hidden');
      backupMotion = null;
    };
    if (immediate) { ++record.revision; finish(); }
    else drive(record, false, finish);
  }
  // Direct native closure (including a restored copy) must release old timelines.
  backup.addEventListener('toggle', () => {
    if (!backup.open && backupMotion) {
      ++backupMotion.revision;
      for (const animation of backupMotion.animations) animation.cancel();
      backupMotion = null; delete backupPanel.dataset.motion;
      backupPanel.inert = false; backupPanel.removeAttribute('aria-hidden');
    }
  });
  const dialogs = new WeakMap();
  const panelAnimations = new Map();
  const panels = Array.from(document.querySelectorAll('[data-settings-panel]'));
  let currentSettingsPage = panels.find(panel => !panel.hidden) || panels[0];
  const nav = document.querySelector('.settings-nav nav');
  let indicator = nav.querySelector('.settings-nav-indicator');
  if (!indicator) { indicator = document.createElement('span'); indicator.className = 'settings-nav-indicator'; indicator.setAttribute('aria-hidden', 'true'); nav.prepend(indicator); }
  function moveIndicator(instant = false) {
    const button = nav.querySelector('[aria-current=page]'); if (!button || !nav.offsetWidth) return;
    indicator.classList.toggle('instant', instant);
    indicator.style.width = button.offsetWidth + 'px'; indicator.style.height = button.offsetHeight + 'px';
    indicator.style.transform = 'translate(' + button.offsetLeft + 'px,' + button.offsetTop + 'px)';
    if (instant) { void indicator.offsetWidth; indicator.classList.remove('instant'); }
  }
  new ResizeObserver(() => moveIndicator(true)).observe(nav);
  function cancelPanel(panel) {
    panelAnimations.get(panel)?.cancel(); panelAnimations.delete(panel);
  }
  function showSettingsPage(name, transition) {
    const incoming = panels.find(panel => panel.dataset.settingsPanel === name);
    const outgoing = currentSettingsPage;
    currentSettingsPage = incoming;
    for (const panel of panels) {
      if (panel !== incoming && panel !== outgoing) { cancelPanel(panel); panel.hidden = true; panel.inert = false; panel.removeAttribute('aria-hidden'); }
    }
    if (incoming === outgoing && !incoming.hidden) return;
    const wasHidden = incoming.hidden;
    const start = wasHidden ? {opacity: 0, transform: 'translateX(10px)'} : {opacity: getComputedStyle(incoming).opacity, transform: getComputedStyle(incoming).transform};
    cancelPanel(incoming); incoming.hidden = false; incoming.inert = false; incoming.removeAttribute('aria-hidden');
    if (!transition || reducedMotion.matches || outgoing === incoming) {
      if (outgoing !== incoming) { cancelPanel(outgoing); outgoing.hidden = true; outgoing.inert = false; outgoing.removeAttribute('aria-hidden'); }
      return;
    }
    const oldStyle = getComputedStyle(outgoing); const oldFrame = {opacity: oldStyle.opacity, transform: oldStyle.transform};
    cancelPanel(outgoing); outgoing.inert = true; outgoing.setAttribute('aria-hidden', 'true');
    const exit = animate(outgoing, [oldFrame, {opacity: 0, transform: 'translateX(-8px)'}], {duration: 160, fill: 'both'});
    panelAnimations.set(outgoing, exit);
    exit.finished.then(() => {
      if (panelAnimations.get(outgoing) !== exit) return;
      outgoing.hidden = true; outgoing.inert = false; outgoing.removeAttribute('aria-hidden'); cancelPanel(outgoing);
    }, () => {});
    const enter = animate(incoming, [start, {opacity: 1, transform: 'translateX(0)'}], {duration: 260, delay: wasHidden ? 35 : 0, fill: 'both'});
    panelAnimations.set(incoming, enter);
    enter.finished.then(() => { if (panelAnimations.get(incoming) === enter) cancelPanel(incoming); }, () => {});
  }
  function destroyDialog(dialog, record) {
    if (dialogs.get(dialog) !== record) return;
    dialog.close(); record.scrim.remove(); ++record.revision;
    for (const animation of record.animations) animation.cancel();
    dialogs.delete(dialog); delete dialog.dataset.motion;
    for (const panel of panels) { cancelPanel(panel); panel.hidden = panel !== currentSettingsPage; panel.inert = false; panel.removeAttribute('aria-hidden'); }
  }
  function closeDialog(dialog) {
    const record = dialogs.get(dialog);
    if (!dialog?.open) return;
    closeMenu(false, true);
    if (!record) { dialog.close(); return; }
    if (record.state === 'closing') return;
    drive(record, false, () => destroyDialog(dialog, record));
  }
  function openDialog(dialog) {
    closeMenu(false, true); closeBackup(true);
    let record = dialogs.get(dialog);
    if (dialog.open && record?.state !== 'closing') return;
    if (!record) {
      const scrim = document.createElement('div'); scrim.className = 'modal-scrim'; scrim.dataset.uiTransient = 'scrim'; scrim.setAttribute('aria-hidden', 'true'); document.body.append(scrim);
      dialog.showModal();
      const backdrop = reducedMotion.matches ? [] : [scrim.animate([{opacity: 0}, {opacity: 1}], {duration: 380, easing: ease, fill: 'both'})];
      if (dialog.id === 'settings-dialog' && !reducedMotion.matches) backdrop.push(dialog.querySelector('.settings-content').animate([
        {opacity: 0, transform: 'translateY(5px)', offset: 0}, {opacity: 0, transform: 'translateY(5px)', offset: .16, easing: ease},
        {opacity: 1, transform: 'translateY(0)', offset: .88}, {opacity: 1, transform: 'translateY(0)', offset: 1}
      ], {duration: 380, easing: 'linear', fill: 'both'}));
      record = surface(dialog, [
        {opacity: 0, transform: 'translateY(16px) scale(.985)'},
        {opacity: 1, transform: 'translateY(0) scale(1)'}
      ], 380, backdrop);
      record.scrim = scrim; dialogs.set(dialog, record);

    }
    drive(record, true, () => { record.state = 'open'; dialog.dataset.motion = 'open'; });
  }
  function openSettings(page = 'workspace') {
    const name = ['workspace', 'help', 'shortcuts'].includes(page) ? page : 'workspace';
    const dialog = $('settings-dialog');
    const moveFocus = dialog.open && panels.some(panel => panel.contains(document.activeElement));
    showSettingsPage(name, dialog.open && dialogs.get(dialog)?.state !== 'closing');
    for (const item of nav.querySelectorAll('[data-settings-page]')) { if (item.dataset.settingsPage === name) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current'); }
    $('settings-breadcrumb').textContent = {workspace: '工作区', help: '使用说明', shortcuts: '快捷键'}[name];
    const firstOpen = !dialog.open; openDialog(dialog); moveIndicator(firstOpen);
    if (moveFocus) nav.querySelector('[aria-current=page]')?.focus({preventScroll: true});
  }
  function enterCards(list) {
    if (reducedMotion.matches) return;
    const visible = Array.from(list.querySelectorAll('.is-new')).filter(card => { const rect = card.getBoundingClientRect(); return rect.bottom > 0 && rect.top < innerHeight; }).slice(0, 8);
    for (const card of visible) {
      const style = getComputedStyle(card);
      animate(card, [
        {height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px', marginBottom: '0px', transform: 'translateY(-6px)', overflow: 'hidden'},
        {height: card.offsetHeight + 'px', opacity: 1, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, marginBottom: style.marginBottom, transform: 'translateY(0)', overflow: 'hidden'}
      ], {duration: 360});
    }
  }
  let saveFeedback = null;
  function saved(button) {
    if (reducedMotion.matches) return;
    if (saveFeedback) { saveFeedback.animation.cancel(); saveFeedback.node.remove(); }
    const node = document.createElement('span'); node.className = 'save-confirmation'; node.dataset.uiTransient = 'feedback'; node.setAttribute('aria-hidden', 'true'); node.innerHTML = icon('check') + '<span>已保存</span>'; button.append(node);
    const animation = animate(node, [
      {opacity: 0, transform: 'translateY(4px)', offset: 0},
      {opacity: 1, transform: 'translateY(0)', offset: .15},
      {opacity: 1, transform: 'translateY(0)', offset: .8},
      {opacity: 0, transform: 'translateY(-3px)', offset: 1}
    ], {duration: 1100, easing: 'ease'});
    saveFeedback = {node, animation};
    animation.finished.then(() => { node.remove(); if (saveFeedback?.node === node) saveFeedback = null; }, () => {});
  }
  for (const dialog of document.querySelectorAll('dialog')) {
    dialog.removeAttribute('data-closing'); dialog.removeAttribute('data-motion');
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(dialog); });
    dialog.addEventListener('click', event => { if (event.target !== dialog) return; const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog(dialog); });
  }
  for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => closeDialog($(button.dataset.close)));
  for (const button of document.querySelectorAll('[data-settings-page]')) button.addEventListener('click', () => openSettings(button.dataset.settingsPage));
  for (const choice of document.querySelectorAll('[data-sidebar-choice]')) choice.addEventListener('click', () => { $('sidebar-position').value = choice.dataset.sidebarChoice; $('sidebar-position').dispatchEvent(new Event('change', {bubbles: true})); });
  $('settings-button').addEventListener('click', () => openSettings());
  window.HRUI = {icon, syncSelect, closeMenu, toggleBackup, closeBackup, closeDialog, openDialog, openSettings, enterCards, saved, disclose, reflow, scopeChanged};
})();
