/* Runs inside the opaque-origin preview iframe. Keep this function self-contained. */
window.HRBridge = function HRBridge(channel, shortcutFor, docxMeta) {
  'use strict';
  const OWNED = 'data-html-review-owned';
  const EXCLUDED = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD']);
  const CONTEXT_LENGTH = 72;
  let mode = 'browse';
  let overlay = null;
  let overlayRoot = null;
  let focused = null;
  let scheduled = false;
  let lastHover = null;
  let lastSelectedElement = null;
  let selectionSerial = 0;
  const docxHash = docxMeta?.sourceSha256 || '';
  let docxMap = {};
  try { docxMap = JSON.parse(document.querySelector('script[data-docx-map]')?.textContent || '{}'); } catch (_) {}
  function docxMapping(element, range) {
    if(!docxHash) return undefined;
    let mapped = element.closest('[data-docx-id]');
    let nodes = mapped ? [mapped] : Array.from(element.querySelectorAll('[data-docx-id]'));
    if(range) nodes = Array.from(document.querySelectorAll('span[data-docx-id]')).filter(node=>range.intersectsNode(node) && docxMap[node.getAttribute('data-docx-id')] && !docxMap[node.getAttribute('data-docx-id')].image);
    const blocks = nodes.map(node=>docxMap[node.getAttribute('data-docx-id')]).filter(Boolean);
    const mapping = {adapterVersion:'1',sourceSha256:docxHash,blocks};
    if(range) {
      function endpoint(container,offset) {
        const element = container.nodeType===1 ? container : container.parentElement;
        const block = element.closest('span[data-docx-id]');
        if(!block || !docxMap[block.getAttribute('data-docx-id')]) return null;
        const prefix = document.createRange();prefix.selectNodeContents(block);prefix.setEnd(container,offset);
        const clone=prefix.cloneContents();for(const auxiliary of clone.querySelectorAll('['+OWNED+']')) auxiliary.remove();
        return {id:block.getAttribute('data-docx-id'),offset:clone.textContent.length};
      }
      mapping.start=endpoint(range.startContainer,range.startOffset);
      mapping.end=endpoint(range.endContainer,range.endOffset);
    }
    return mapping;
  }

  function send(event, data) {
    parent.postMessage(Object.assign({ hr: true, channel: channel, event: event }, event === 'target' ? {selectionSerial} : {}, data || {}), '*');
  }
  function warn(error) {
    send('warning', { message: '无法读取此处的页面内容：' + (error && error.message || String(error)) });
  }
  function own(node) {
    const element = node && (node.nodeType === 1 ? node : node.parentElement);
    return !!(element && element.closest('[' + OWNED + ']'));
  }
  function children(node, elementsOnly) {
    return Array.from(elementsOnly ? node.children || [] : node.childNodes || []).filter(n => !own(n));
  }
  function nodePath(node, elementsOnly) {
    const result = [];
    while (node && node !== document.documentElement) {
      const p = node.parentNode;
      if (!p) return null;
      const index = children(p, elementsOnly).indexOf(node);
      if (index < 0) return null;
      result.unshift(index);
      node = p;
    }
    return node === document.documentElement ? result : null;
  }
  function fromPath(path, elementsOnly) {
    if (!Array.isArray(path) || path.length > 150) return null;
    let node = document.documentElement;
    for (const index of path) {
      if (!Number.isInteger(index) || index < 0 || !node) return null;
      node = children(node, elementsOnly)[index];
    }
    return node || null;
  }
  function eligible(node) {
    if (!node || own(node)) return false;
    for (let e = node.parentElement; e; e = e.parentElement) {
      if (EXCLUDED.has(e.tagName)) return false;
    }
    return true;
  }
  function textNodes(root) {
    const nodes = [];
    if (!root) return nodes;
    if (root.nodeType === 3) return eligible(root) ? [root] : [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) if (eligible(node)) nodes.push(node);
    return nodes;
  }
  function stream() {
    let text = '';
    const records = textNodes(document.body || document.documentElement).map(node => {
      const item = { node: node, start: text.length, end: text.length + node.length };
      text += node.data;
      return item;
    });
    return { text: text, records: records };
  }
  function clean(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }
  function elementText(element) { return clean(textNodes(element).map(n => n.data).join('')); }
  function fingerprint(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return (hash >>> 0).toString(16).padStart(8, '0');
  }
  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return Array.from(value).map(c => '\\' + c.codePointAt(0).toString(16) + ' ').join('');
  }
  function query(selector) {
    try { return Array.from(document.querySelectorAll(selector)).filter(e => !own(e)); }
    catch (_) { return []; }
  }
  function selector(element) {
    const parts = [];
    for (let e = element; e && e.nodeType === 1; e = e.parentElement) {
      if (e.id && query('#' + cssEscape(e.id)).length === 1) {
        parts.unshift('#' + cssEscape(e.id));
        break;
      }
      let part = e.localName;
      if (e.parentElement) {
        const siblings = children(e.parentElement, true).filter(n => n.localName === e.localName);
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(e) + 1) + ')';
      }
      parts.unshift(part);
      if (e === document.documentElement) break;
    }
    return parts.join(' > ');
  }
  function originalAttribute(element, key) {
    const current = element.getAttribute(key);
    const saved = element.getAttribute('data-html-review-original-attrs');
    if (saved) {
      try {
        const values = JSON.parse(saved);
        if (values && typeof values === 'object' && Object.prototype.hasOwnProperty.call(values, key)) {
          const entry = values[key];
          if (entry && typeof entry.value === 'string' && typeof current === 'string' && current.length === entry.renderedLength && fingerprint(current) === entry.renderedFingerprint) return entry.value;
        }
      } catch (_) { /* A malformed optional preview mapping is not a locator. */ }
    }
    return current;
  }
  function attributes(element) {
    const result = {};
    for (const key of ['alt', 'title', 'href', 'src', 'role', 'aria-label', 'name', 'type']) {
      if (element.hasAttribute(key)) {
        const value = originalAttribute(element, key);
        result[key] = value.length > 4000 ? value.slice(0, 4000) + '…' : value;
      }
    }
    return result;
  }
  function attributeFingerprints(element) {
    const result = {};
    for (const key of ['alt', 'title', 'href', 'src', 'role', 'aria-label', 'name', 'type']) {
      const value = originalAttribute(element, key);
      if (value && value.length > 4000) result[key] = { length: value.length, hash: fingerprint(value) };
    }
    return result;
  }
  function summary(element) {
    if (!element || own(element)) return null;
    return { tag: element.localName, id: element.id || '', text: elementText(element).slice(0, 240) };
  }
  function context(element) {
    return {
      ancestor: summary(element.parentElement),
      siblingBefore: summary(element.previousElementSibling),
      siblingAfter: summary(element.nextElementSibling)
    };
  }
  function box(rect) {
    return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height), scrollX: Math.round(window.scrollX), scrollY: Math.round(window.scrollY) };
  }
  function baseTarget(element) {
    const text = elementText(element);
    const target = {
      selector: selector(element), domPath: nodePath(element, true),
      tag: element.localName, id: element.id || '', classes: Array.from(element.classList),
      attributes: attributes(element), attributeFingerprints: attributeFingerprints(element), text: text.slice(0, 1600),
      textLength: text.length, textFingerprint: fingerprint(text),
      context: context(element), rect: box(element.getBoundingClientRect())
    };
    if(docxHash) {
      target.docx=docxMapping(element);
      // Source media hashes carry image evidence without putting Base64 in JSON.
      delete target.attributes.src;delete target.attributeFingerprints.src;
      target.docx.occurrences=Array.from(document.getElementsByTagName(element.localName)).filter(node=>matchesElement(node,target)).length;
    }
    return target;
  }
  let pages = [];
  let pageSignature = '';
  function discoverPages() {
    const explicit = query('[data-page],[data-page-number],[data-slide],[role="doc-page"],.print-page,.pdf-page,.slide,.slides > section');
    const generic = query('.page');
    const printBreaks = query('section,article,main,div').slice(0, 5000).filter(element => { const style = getComputedStyle(element); return ['page', 'always', 'left', 'right'].includes(style.breakAfter) || ['page', 'always', 'left', 'right'].includes(style.breakBefore); });
    const candidates = Array.from(new Set(explicit.concat(printBreaks, generic.length > 1 ? generic : []))).filter(element => !element.matches('button,a,input,select,option') && element !== document.body && element !== document.documentElement);
    // Nested slide decks use sections as groups. Only their actual leaf pages are targets.
    pages = candidates.filter(element => !candidates.some(other => other !== element && element.contains(other))).sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1).slice(0, 1000);
    const inventory = pages.map((element, index) => ({index: index + 1, title: clean(element.getAttribute('aria-label') || element.getAttribute('data-page-title') || element.querySelector('h1,h2,h3')?.textContent || '页面 ' + (index + 1)).slice(0, 100)}));
    const signature = JSON.stringify(inventory.map((item, index) => ({...item, selector: selector(pages[index])})));
    if (signature !== pageSignature) { pageSignature = signature; send('pages', {pages: inventory}); }
    return pages;
  }
  function pageTarget(element) {
    const index = pages.indexOf(element);
    if (index < 0) return null;
    const title = clean(element.getAttribute('aria-label') || element.getAttribute('data-page-title') || element.querySelector('h1,h2,h3')?.textContent || '页面 ' + (index + 1)).slice(0, 100);
    return Object.assign(baseTarget(element), {kind: 'page', scope: 'page', pageIndex: index + 1, pageCount: pages.length, pageTitle: title, viewport: {width: innerWidth, height: innerHeight, devicePixelRatio: devicePixelRatio || 1}});
  }
  function capturePage(element) {
    discoverPages();
    const target = pageTarget(element);
    if (!target) { send('warning', {message: '请选择 HTML 已有的幻灯片或打印页区块；连续页面可使用整体或元素批注。'}); return; }
    selectionSerial++;
    focus(element, true);
    send('target', {target});
    if (!element.getClientRects().length) send('warning', {message: '已选中该页，但它当前不可见。可先在浏览模式切换到对应幻灯片，再继续审阅。'});
  }
  function rangePosition(range, data) {
    let start = null;
    let end = null;
    let text = '';
    for (const item of data.records) {
      if (!range.intersectsNode(item.node)) continue;
      const a = range.startContainer === item.node ? range.startOffset : 0;
      const b = range.endContainer === item.node ? range.endOffset : item.node.length;
      if (b <= a) continue;
      if (start === null) start = item.start + a;
      end = item.start + b;
      text += item.node.data.slice(a, b);
    }
    return start === null ? null : { start: start, end: end, text: text };
  }
  function rangeAt(start, end, data) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > data.text.length) return null;
    const first = data.records.find(r => r.start <= start && r.end > start);
    const last = data.records.find(r => r.start < end && r.end >= end);
    if (!first || !last) return null;
    const range = document.createRange();
    range.setStart(first.node, start - first.start);
    range.setEnd(last.node, end - last.start);
    return range;
  }
  function quoteAt(position, data) {
    return {
      exact: position.text,
      prefix: data.text.slice(Math.max(0, position.start - CONTEXT_LENGTH), position.start),
      suffix: data.text.slice(position.end, position.end + CONTEXT_LENGTH)
    };
  }
  // Serialize without changing the browser selection or the pending annotation target.
  function textTarget(range, data, pos) {
    const element = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    const target = Object.assign(baseTarget(element), {
      kind: 'text', text: pos.text, quote: quoteAt(pos, data),
      position: { start: pos.start, end: pos.end },
      range: {
        start: { path: nodePath(range.startContainer, false), offset: range.startOffset },
        end: { path: nodePath(range.endContainer, false), offset: range.endOffset }
      }, rect: box(range.getBoundingClientRect())
    });
    if(docxHash) {
      // Browser selections can use paragraph/container boundaries (for example
      // selecting a whole paragraph). Resolve them to actual source text nodes.
      target.docx=docxMapping(element,rangeAt(pos.start,pos.end,data) || range);
      let count=0,offset=0;while((offset=data.text.indexOf(pos.text,offset))>=0 && count<=10000) {count++;offset++;}
      target.docx.occurrences=count;
      if(!target.docx.start || !target.docx.end) return null;
    }
    return target;
  }
  function captureText(selectedRange) {
    const selection = window.getSelection();
    if (!selectedRange && (!selection || selection.isCollapsed || !selection.rangeCount)) {
      clearFocus();
      send('target-cleared', {kind: 'text'});
      return;
    }
    const range = selectedRange || selection.getRangeAt(0).cloneRange();
    if (own(range.startContainer) || own(range.endContainer)) return;
    const data = stream();
    const pos = rangePosition(range, data);
    if (!pos || !pos.text.trim()) return;
    if (pos.text.length > 20000) {
      send('warning', { message: '选择文字过长，请缩小至 20,000 字符以内；整个文件的意见可使用“整体”模式。' });
      return;
    }
    const target = textTarget(range, data, pos);
    if (!target) { send('warning',{message:'此选区含无法对应源文档的辅助内容，请选择正文文字。'}); return; }
    focus(range, false);
    send('target', { target: target });
  }
  function createOverlay() {
    if (overlay && overlay.isConnected) return;
    overlay = document.createElement('div');
    overlay.setAttribute(OWNED, 'overlay');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;pointer-events:none!important;z-index:2147483647!important;display:block!important;contain:strict!important;';
    overlayRoot = overlay.attachShadow({ mode: 'closed' });
    document.documentElement.appendChild(overlay);
  }
  function renderFocus() {
    scheduled = false;
    if (!focused) {
      if (overlayRoot) overlayRoot.replaceChildren();
      return;
    }
    const element = focused.nodeType === 1 ? focused : focused.commonAncestorContainer;
    if (!element || !element.isConnected) { clearFocus(); return; }
    createOverlay();
    overlayRoot.replaceChildren();
    const rects = focused.nodeType === 1 ? [focused.getBoundingClientRect()] : Array.from(focused.getClientRects());
    for (const rect of rects.slice(0, 250)) {
      if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > innerHeight) continue;
      const marker = document.createElement('div');
      marker.style.cssText = 'position:absolute;box-sizing:border-box;border:2px solid #bd563d;background:rgba(189,86,61,.10);border-radius:3px;pointer-events:none;left:' + rect.x + 'px;top:' + rect.y + 'px;width:' + rect.width + 'px;height:' + rect.height + 'px;';
      overlayRoot.appendChild(marker);
    }
  }
  function scheduleFocus() {
    if (!scheduled) { scheduled = true; requestAnimationFrame(renderFocus); }
  }
  function clearFocus() {
    focused = null;
    if (overlayRoot) overlayRoot.replaceChildren();
  }
  function focus(value, scroll) {
    focused = value;
    if (scroll) {
      let element = value.nodeType === 1 ? value : value.startContainer;
      if (element.nodeType !== 1) element = element.parentElement;
      element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      const rect = value.getBoundingClientRect();
      if (rect.top < 0 || rect.bottom > innerHeight) window.scrollBy(0, rect.top - innerHeight / 3);
    }
    scheduleFocus();
  }
  function validQuote(range, quote, data, requireContext) {
    if (!range || !quote || !quote.exact) return false;
    const pos = rangePosition(range, data);
    if (!pos || pos.text !== quote.exact) return false;
    return !requireContext || contextMatches(pos.start, pos.end, quote, data.text);
  }
  function contextMatches(start, end, quote, text) {
    return (typeof quote.prefix !== 'string' || text.slice(Math.max(0, start - quote.prefix.length), start) === quote.prefix) &&
      (typeof quote.suffix !== 'string' || text.slice(end, end + quote.suffix.length) === quote.suffix);
  }
  function restoreRange(target) {
    if (!target.range || !target.range.start || !target.range.end) return null;
    const a = fromPath(target.range.start.path, false);
    const b = fromPath(target.range.end.path, false);
    if (!a || !b || own(a) || own(b)) return null;
    try {
      const range = document.createRange();
      range.setStart(a, target.range.start.offset);
      range.setEnd(b, target.range.end.offset);
      return range.collapsed ? null : range;
    } catch (_) { return null; }
  }
  function locateText(target) {
    const data = stream();
    const quote = target.quote || { exact: target.text };
    let range = restoreRange(target);
    const sameVersion=!target.docx || target.docx.sourceSha256===docxHash;
    if (sameVersion && validQuote(range, quote, data, true)) return { value: range, status: 'exact', reason: 'DOM 范围、原文及上下文均匹配。' };
    if (sameVersion && target.position) {
      range = rangeAt(target.position.start, target.position.end, data);
      if (validQuote(range, quote, data, true)) return { value: range, status: 'fallback', reason: 'DOM 路径已变化，使用原文和上下文验证了文字偏移位置。' };
    }
    if (!quote.exact) return { status: 'missing', reason: '批注缺少选中原文。' };
    const hits = [];
    let offset = 0;
    while (offset <= data.text.length) {
      const start = data.text.indexOf(quote.exact, offset);
      if (start < 0) break;
      hits.push({ start: start, end: start + quote.exact.length });
      offset = start + 1;
      if (hits.length > 10000) return { status: 'ambiguous', reason: '原文重复过多，无法可靠定位。' };
    }
    let candidates = hits;
    if(!sameVersion && target.docx?.occurrences>hits.length && target.docx.occurrences>1) return {status:'ambiguous',reason:'原文曾有多处重复且候选数量已变化，无法确认是否为被删除的原目标。'};
    if (hits.length > 1) candidates = hits.filter(p => contextMatches(p.start, p.end, quote, data.text));
    if (candidates.length === 1) {
      range = rangeAt(candidates[0].start, candidates[0].end, data);
      return { value: range, status: 'fallback', reason: '原定位已变化，按唯一匹配的原文' + (hits.length > 1 ? '及上下文' : '') + '找到位置；请核对。' };
    }
    if (hits.length > 1) return { status: 'ambiguous', reason: '存在多处相同原文，现有上下文不足以确定原位置。' };
    return { status: 'missing', reason: '页面中已找不到批注选中的原文。' };
  }
  function matchesElement(element, target) {
    if (!element || element.nodeType !== 1 || own(element) || element.localName !== target.tag) return false;
    if (!target.docx && (element.id || '') !== (target.id || '')) return false;
    if(target.docx && target.tag==='img') return element.getAttribute('data-docx-media-hash') === target.docx.blocks.find(block=>block.image)?.image.sha256 && ['alt','title'].every(key=>(element.getAttribute(key)||'')===(target.attributes?.[key]||''));
    const stableClasses = classes => classes.filter(value => target.scope !== 'page' || !['active', 'present', 'past', 'future', 'current', 'is-active'].includes(value)).sort().join(' ');
    if (Array.isArray(target.classes) && stableClasses(target.classes) !== stableClasses(Array.from(element.classList))) return false;
    for (const key of Object.keys(target.attributes || {})) {
      const value = originalAttribute(element, key);
      const evidence = target.attributeFingerprints && target.attributeFingerprints[key];
      if (evidence) {
        if (typeof value !== 'string' || value.length !== evidence.length || fingerprint(value) !== evidence.hash) return false;
      } else if (value !== target.attributes[key]) return false;
    }
    const text = elementText(element);
    if (target.textFingerprint) return fingerprint(text) === target.textFingerprint && text.length === target.textLength;
    return text === clean(target.text);
  }
  function contextEqual(element, target) {
    if (!target.context) return false;
    return JSON.stringify(context(element)) === JSON.stringify(target.context);
  }
  function locateElement(target) {
    const selected = target.selector ? query(target.selector) : [];
    const sameVersion=!target.docx || target.docx.sourceSha256===docxHash;
    if (sameVersion && selected.length === 1 && matchesElement(selected[0], target)) return { value: selected[0], status: 'exact', reason: '选择器、元素属性和原内容均匹配。' };
    const byPath = fromPath(target.domPath, true);
    if (sameVersion && matchesElement(byPath, target) && contextEqual(byPath, target)) return { value: byPath, status: 'fallback', reason: '选择器失效，DOM 路径、元素内容及相邻上下文匹配。' };
    if (!target.tag || !/^[a-zA-Z][\w:-]*$/.test(target.tag)) return { status: 'missing', reason: '批注缺少有效的元素类型。' };
    const hits = Array.from(document.getElementsByTagName(target.tag)).filter(e => matchesElement(e, target));
    let candidates = hits;
    if(!sameVersion && target.docx?.occurrences>hits.length && target.docx.occurrences>1) return {status:'ambiguous',reason:'原元素曾有多处相同内容且候选数量已变化，无法确认原目标。'};
    if (hits.length > 1) candidates = hits.filter(e => contextEqual(e, target));
    if (candidates.length === 1) return { value: candidates[0], status: 'fallback', reason: '原路径已变化，按唯一匹配的元素内容及属性定位；请核对。' };
    if (hits.length > 1) return { status: 'ambiguous', reason: '存在多个相同元素，无法可靠确定批注对应哪一个。' };
    return { status: 'missing', reason: '原元素内容或属性已变化，无法可靠定位；请根据记录的原文及上下文人工核对。' };
  }
  function resolveTarget(target) {
    return target.kind === 'page' ? ((target.scope === 'whole-document' || !target.selector) ? {status:'exact',reason:'这是针对整个文件的批注。'} : locateElement(target)) : target.kind === 'text' ? locateText(target) : target.kind === 'element' ? locateElement(target) : {status:'missing',reason:'未知的批注定位类型。'};
  }
  function reviewCandidates(target) {
    const result = resolveTarget(target);
    const candidates = [];
    if (target.kind === 'page' && (target.scope === 'whole-document' || !target.selector)) return {status: result.status, reason: result.reason, candidates};
    const seen = new Set();
    function add(value, label) {
      if (!value || candidates.length >= 6) return;
      let fresh;
      if (target.kind === 'text') {
        const data = stream();
        const pos = rangePosition(value, data);
        if (!pos || !pos.text.trim() || pos.text.length > 20000) return;
        // Use canonical text endpoints, including DOCX paragraph boundaries.
        fresh = textTarget(rangeAt(pos.start, pos.end, data), data, pos);
      } else {
        if (value.nodeType !== 1 || own(value) || !value.isConnected || EXCLUDED.has(value.tagName) || !eligible(value)) return;
        fresh = target.kind === 'page' ? pageTarget(value) : Object.assign(baseTarget(value), {kind: 'element'});
      }
      if (!fresh) return;
      const key = JSON.stringify(fresh.position || fresh.domPath);
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push({target: fresh, label, text: String(fresh.quote?.exact || fresh.text || '').slice(0, 1600),
        ...(fresh.quote ? {prefix: fresh.quote.prefix, suffix: fresh.quote.suffix} : {})});
    }
    if (target.kind === 'page') discoverPages();
    if (result.value) add(result.value, '当前可核对的位置');
    if (target.kind === 'text') {
      const exact = target.quote?.exact || target.text;
      if (typeof exact === 'string' && exact.length && exact.length <= 20000) {
        const data = stream();
        let offset = 0, count = 0;
        while (candidates.length < 6) {
          const start = data.text.indexOf(exact, offset);
          if (start < 0) break;
          count++;
          add(rangeAt(start, start + exact.length, data), '相同原文位置 ' + count + '，请核对上下文');
          offset = start + 1;
        }
      }
    } else if (['element', 'page'].includes(target.kind) && target.tag) {
      const hits = /^[a-zA-Z][\w:-]*$/.test(target.tag) ? Array.from(document.getElementsByTagName(target.tag)).filter(e => matchesElement(e, target)) : [];
      for (const element of hits) add(element, '相同内容元素，请核对上下文');
      const pathElements = (target.selector ? query(target.selector) : []).concat(fromPath(target.domPath, true) || []);
      for (const element of pathElements) {
        if (element.nodeType === 1 && !matchesElement(element, target)) add(element, '原路径对应位置，内容已变化，请核对');
      }
    }
    return {status: result.status, reason: result.reason, candidates};
  }
  window.addEventListener('message', function (event) {
    const message = event.data;
    if (event.source !== parent || !message || message.hr !== true || message.channel !== channel) return;
    try {
      if (message.command === 'set-mode' && ['browse', 'text', 'element', 'page'].includes(message.mode)) {
        mode = message.mode;
        if (mode !== 'text') selectionSerial++;
        discoverPages();
        lastHover = null;
        clearFocus();
      } else if (message.command === 'search-document' && docxHash && typeof message.query === 'string' && message.query.length <= 200) {
        const query = message.query.trim();
        const matches = documentMatches(query);
        send('document-search', {query, total:matches.length, items:matches.slice(0,50).map((element,index) => {
          const value = clean(element.textContent); const start = Math.max(0, value.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) - 45);
          return {index, text:(start ? '…' : '') + value.slice(start,start+215)};
        })});
      } else if (message.command === 'navigate-document' && docxHash && Number.isInteger(message.index) && message.index >= 0) {
        const items = message.kind === 'outline' ? documentHeadings() : message.kind === 'search' && typeof message.query === 'string' && message.query.length <= 200 ? documentMatches(message.query.trim()) : [];
        const element = items[message.index];
        if (element) element.scrollIntoView({block:'start', behavior:'instant'});
      } else if (message.command === 'select-page' && mode === 'page') {
        discoverPages();
        if (Number.isInteger(message.index) && pages[message.index - 1]) capturePage(pages[message.index - 1]);
      } else if (message.command === 'clear-focus') {
        clearFocus();
      } else if (message.command === 'clear-selection') {
        // A save clears only its acknowledged selection. Intentional cancellation
        // has no bound and also invalidates any queued selection snapshot.
        if (Number.isSafeInteger(message.throughSelectionSerial) && message.throughSelectionSerial >= 0 && message.throughSelectionSerial < selectionSerial) return;
        selectionSerial++;
        clearFocus();
        lastSelectedElement = null;
        lastHover = null;
        const selection = window.getSelection();
        if (selection) selection.removeAllRanges();
      } else if (message.command === 'parent-target') {
        const element = lastSelectedElement && lastSelectedElement.parentElement;
        if (!element || !element.isConnected || element === document.body || element === document.documentElement) {
          send('warning', { message: '已到达页面容器边界；针对整个文件的意见请使用“整体”模式。' });
        } else {
          selectionSerial++;
          lastSelectedElement = element;
          focus(element, false);
          send('target', { target: Object.assign(baseTarget(element), { kind: 'element' }) });
        }
      } else if (message.command === 'check-targets' && typeof message.requestId === 'string' && Array.isArray(message.items) && message.items.length <= 10) {
        // Verification must not move the viewport, focus a target or change selection.
        const items = message.items.map(item => {
          let result;
          try { result = resolveTarget(item.target || {}); }
          catch (_) { result = {status:'missing',reason:'定位无法核对，请手动检查原文。'}; }
          return {id:item.id,revision:item.revision,status:result.status,reason:result.reason};
        });
        send('targets-checked', {requestId:message.requestId,items});
      } else if (message.command === 'review-candidates' && typeof message.requestId === 'string') {
        const result = reviewCandidates(message.target || {});
        send('review-candidates', {requestId: message.requestId, locationToken: message.locationToken, ...result});
      } else if (message.command === 'preview-candidate') {
        const result = resolveTarget(message.target || {});
        if (result.value) focus(result.value, true);
      } else if (message.command === 'locate') {
        const target = message.target || {};
        clearFocus();
        const result = resolveTarget(target);
        if (result.value) focus(result.value, true);
        else if (target.kind === 'page') window.scrollTo({ top: 0, behavior: 'instant' });
        send('located', { requestId: message.requestId, locationToken:message.locationToken, status: result.status, reason: result.reason });
      }
    } catch (error) {
      if (message.command === 'locate') send('located', { requestId: message.requestId, locationToken:message.locationToken, status: 'missing', reason: '定位失败：' + error.message });
      else if (message.command === 'review-candidates') send('review-candidates', {requestId: message.requestId, locationToken: message.locationToken, status: 'missing', reason: '候选位置无法核对，请手动检查原文。', candidates: []});
      else warn(error);
    }
  });
  document.addEventListener('mouseup', function () {
    // Parent mode/clear messages can arrive after a synthetic mouseup. Preserve
    // this selection before a delayed clear from the previous save can erase it.
    const selection = window.getSelection();
    const range = selection && !selection.isCollapsed && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    const serial = ++selectionSerial;
    setTimeout(function () { if (mode === 'text' && serial === selectionSerial) { try { captureText(range); } catch (error) { warn(error); } } }, 0);
  }, true);
  document.addEventListener('keyup', function (event) {
    if (mode === 'text' && event.key === 'Shift') { selectionSerial++; try { captureText(); } catch (error) { warn(error); } }
  }, true);
  document.addEventListener('keydown', function (event) {
    if (typeof shortcutFor !== 'function') return;
    const editable = event.composedPath().some(node => node.nodeType === 1 && (node.matches('input,textarea,select') || node.isContentEditable));
    const action = shortcutFor(event, editable);
    if (!action) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    send('shortcut', {action: action});
  }, true);
  document.addEventListener('dragover', function (event) {
    if (!event.dataTransfer || !Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault();
    send('file-drag');
  }, true);
  document.addEventListener('drop', function (event) {
    if (!event.dataTransfer || !Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    send('dropped-files', {files: Array.from(event.dataTransfer.files)});
  }, true);
  document.addEventListener('click', function (event) {
    const element = event.target && (event.target.nodeType === 1 ? event.target : event.target.parentElement);
    if (!element) return;
    if (own(element)) {
      // Note references are excluded from text offsets, but their links must
      // still stay inside the isolated preview rather than navigate srcdoc.
      const link = docxHash && element.closest('a[href^="#"]');
      if (link) {
        event.preventDefault();
        if (mode === 'browse') {
          let id = link.getAttribute('href').slice(1);
          try { id = decodeURIComponent(id); } catch (_) { /* Keep a literal invalid fragment. */ }
          const anchor = document.getElementById(id) || document.getElementsByName(id)[0];
          if (anchor) anchor.scrollIntoView();
        }
      }
      return;
    }
    if(docxHash && mode==='browse') {
      const link=element.closest('a[href]');
      if(link && /^(https?:|mailto:)/i.test(link.getAttribute('href'))) {
        event.preventDefault();send('external-link',{url:link.getAttribute('href')});return;
      }
    }
    if (mode === 'page') {
      event.preventDefault(); event.stopImmediatePropagation();
      try { discoverPages(); capturePage(pages.find(page => page.contains(element))); } catch (error) { warn(error); }
      return;
    }
    if (mode !== 'element') {
      const link = element.closest('a[href],area[href]');
      if (link) {
        const href = (link.getAttribute('href') || '').trim();
        if (href.startsWith('#')) {
          // A base URL may otherwise make even fragment links leave srcdoc.
          event.preventDefault();
          let id = href.slice(1);
          try { id = decodeURIComponent(id); } catch (_) { /* Invalid percent encoding stays literal. */ }
          const anchor = document.getElementById(id) || document.getElementsByName(id)[0];
          if (anchor) anchor.scrollIntoView();
          else if (!id) window.scrollTo(0, 0);
        } else if (!/^javascript:/i.test(href)) {
          event.preventDefault();
          send('warning', { message: '预览中已阻止跳转链接，以保留当前批注环境。需要访问链接时，请在外部浏览器打开原 HTML。' });
        }
      }
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      const target = Object.assign(baseTarget(element), { kind: 'element' });
      selectionSerial++;
      lastSelectedElement = element;
      focus(element, false);
      send('target', { target: target });
    } catch (error) { warn(error); }
  }, true);
  document.addEventListener('pointermove', function (event) {
    if (!['element', 'page'].includes(mode) || !event.target || own(event.target) || event.target === lastHover) return;
    lastHover = event.target;
    focused = mode === 'page' ? pages.find(page => page.contains(event.target)) : event.target;
    scheduleFocus();
  }, true);
  window.addEventListener('scroll', scheduleFocus, true);
  window.addEventListener('resize', scheduleFocus);
  function watchPages() {
    discoverPages();
    if (docxHash) send('document-outline', {items:documentHeadings().slice(0,1000).map((element,index) => ({index, text:clean(element.textContent).slice(0,160), level:Number(element.tagName.slice(1))}))});
    let timer;
    new MutationObserver(records => {
      if (!records.some(record => !own(record.target) && (record.type === 'attributes' || Array.from(record.addedNodes).concat(Array.from(record.removedNodes)).some(node => !own(node))))) return;
      clearTimeout(timer); timer = setTimeout(discoverPages, 80);
    }).observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'data-page', 'data-page-number', 'data-slide', 'data-page-title', 'aria-label']});
  }
  function documentHeadings() {
    return Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter(element => !own(element));
  }
  function documentMatches(query) {
    if (!query) return [];
    const needle = query.toLocaleLowerCase();
    return Array.from(document.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li')).filter(element => !own(element) && !(element.localName === 'li' && element.querySelector('p')) && clean(element.textContent).toLocaleLowerCase().includes(needle));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchPages, {once: true}); else watchPages();
  send('ready', { version: 1 });
};
