/* Local layout preferences never change document or annotation data. */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'html-review.workspace-layout';
  const DEFAULT_WIDTH = 352;
  function normalize(value, fallback = {sidebarWidth:DEFAULT_WIDTH, sidebarCollapsed:false}) {
    return {
      sidebarWidth: Number.isFinite(value?.sidebarWidth) && value.sidebarWidth >= 280 && value.sidebarWidth <= 560 ? Math.round(value.sidebarWidth) : fallback.sidebarWidth,
      sidebarCollapsed: typeof value?.sidebarCollapsed === 'boolean' ? value.sidebarCollapsed : fallback.sidebarCollapsed
    };
  }
  function bounds(width) {
    const max = Math.max(280, Math.min(560, Math.floor(width / 2), Math.floor(width - 368)));
    return {min:Math.min(300,max), max};
  }
  function mount({workspace, sidebar, separator, toggles, mobileDock, mobileButtons, onChange}) {
    let preferences = normalize({sidebarWidth:Number(workspace.dataset.sidebarWidth),sidebarCollapsed:workspace.dataset.sidebarCollapsed==='true'});
    let drag = null, frame = null;
    let mobilePanel = 'closed', sheetAnimation = null, sheetRevision = 0;
    const panelScroll={editor:0,list:0};
    const mobile = matchMedia('(max-width:760px)');
    const reduced = matchMedia('(prefers-reduced-motion:reduce)');
    function saved(fallback) {
      try { return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY)),fallback); } catch (_) { return fallback; }
    }
    function apply() {
      const range = bounds(workspace.clientWidth);
      const preferred=preferences.sidebarWidth===DEFAULT_WIDTH && workspace.clientWidth<1000 ? 300 : preferences.sidebarWidth;
      const width = Math.max(range.min,Math.min(range.max,preferred));
      workspace.style.setProperty('--sidebar-width',width+'px');
      workspace.dataset.sidebarWidth = String(preferences.sidebarWidth);
      workspace.dataset.sidebarCollapsed = String(preferences.sidebarCollapsed);
      const hasDocument=workspace.classList.contains('has-document');
      const closed=mobile.matches ? mobilePanel==='closed' : preferences.sidebarCollapsed;
      workspace.dataset.mobilePanel=mobilePanel;
      sidebar.inert = closed && hasDocument;
      if(!mobile.matches || !hasDocument)sidebar.hidden=false;
      else if(!sheetAnimation)sidebar.hidden=closed;
      mobileDock.hidden=!mobile.matches || !hasDocument;
      for(const [name,button] of Object.entries(mobileButtons)) {
        if(name==='close')continue;
        button.setAttribute(name==='reading' ? 'aria-pressed' : 'aria-expanded',String(name==='reading' ? closed : mobilePanel===name));
        button.classList.toggle('is-active',name==='reading' ? closed : mobilePanel===name);
      }
      document.getElementById('sheet-title').textContent=mobilePanel==='list' ? '审阅记录' : '写下你的意见';
      separator.setAttribute('aria-valuemin',String(range.min));
      separator.setAttribute('aria-valuemax',String(range.max));
      separator.setAttribute('aria-valuenow',String(width));
      separator.setAttribute('aria-valuetext',width+' 像素');
      separator.tabIndex = !workspace.classList.contains('has-document') || mobile.matches || preferences.sidebarCollapsed ? -1 : 0;
      for (const toggle of toggles) {
        toggle.setAttribute('aria-expanded',String(!closed));
        const label = closed ? '展开批注栏' : '收起批注栏';
        toggle.setAttribute('aria-label',label); toggle.title = label;
      }
    }
    function commit() {
      try { localStorage.setItem(STORAGE_KEY,JSON.stringify(preferences)); } catch (_) { /* Still usable without storage. */ }
      onChange?.();
    }
    function setCollapsed(collapsed, remember = true) {
      if(mobile.matches){showMobile(collapsed ? 'closed' : 'editor');return;}
      if (preferences.sidebarCollapsed === collapsed) return;
      if (collapsed && sidebar.contains(document.activeElement)) toggles[0].focus({preventScroll:true});
      preferences.sidebarCollapsed = collapsed; apply();
      if (remember) commit();
    }
    function showMobile(panel) {
      if(!mobile.matches || !workspace.classList.contains('has-document') || mobilePanel===panel)return;
      const old=mobilePanel,closing=panel==='closed',revision=++sheetRevision;
      if(old!=='closed')panelScroll[old]=sidebar.scrollTop;
      const transform=sidebar.hidden ? 'translateY(24px)' : getComputedStyle(sidebar).transform;
      const opacity=sidebar.hidden ? 0 : Number(getComputedStyle(sidebar).opacity);
      sheetAnimation?.cancel();sheetAnimation=null;
      if(closing && sidebar.contains(document.activeElement))mobileButtons.reading.focus({preventScroll:true});
      mobilePanel=panel;
      // Keep the closing surface painted until its exit finishes, without exposing focus.
      workspace.dataset.mobileView=closing ? old : panel;
      apply();sidebar.hidden=false;sidebar.inert=closing;
      if(!closing)sidebar.scrollTop=panelScroll[panel];
      if(reduced.matches){sidebar.hidden=closing;return;}
      sheetAnimation=sidebar.animate([{transform,opacity},{transform:closing ? 'translateY(24px)' : 'translateY(0)',opacity:closing?0:1}],{duration:closing?150:230,easing:'cubic-bezier(.22,1,.36,1)',fill:'both'});
      const current=sheetAnimation;
      current.finished.then(()=>{if(revision!==sheetRevision)return;current.cancel();sheetAnimation=null;sidebar.hidden=closing;},()=>{});
    }
    function setWidth(value, remember = true) {
      const range = bounds(workspace.clientWidth);
      preferences.sidebarWidth = Math.round(Math.max(range.min,Math.min(range.max,value)));
      apply(); if (remember) commit();
    }
    function finishDrag(cancel = false) {
      if (!drag) return;
      const current = drag; drag = null;
      if (frame !== null) {cancelAnimationFrame(frame);frame=null;}
      if (cancel) preferences.sidebarWidth = current.initial;
      else setWidth(current.next,false);
      workspace.classList.remove('is-resizing');
      if (separator.hasPointerCapture(current.id)) separator.releasePointerCapture(current.id);
      apply(); if (!cancel) commit();
    }
    separator.addEventListener('pointerdown',event => {
      if (drag || event.button !== 0 || event.isPrimary === false || mobile.matches || preferences.sidebarCollapsed) return;
      event.preventDefault(); separator.focus({preventScroll:true});
      const width=Number(separator.getAttribute('aria-valuenow'));
      drag={id:event.pointerId,x:event.clientX,width,initial:preferences.sidebarWidth,next:width};
      separator.setPointerCapture(event.pointerId); workspace.classList.add('is-resizing');
    });
    separator.addEventListener('pointermove',event => {
      if (!drag || drag.id !== event.pointerId) return;
      const direction = workspace.dataset.sidebarPosition === 'right' ? -1 : 1;
      drag.next=drag.width+(event.clientX-drag.x)*direction;
      if (frame === null) frame=requestAnimationFrame(()=>{frame=null;if(drag)setWidth(drag.next,false);});
    });
    separator.addEventListener('pointerup',event=>{if(drag?.id===event.pointerId)finishDrag();});
    separator.addEventListener('pointercancel',()=>finishDrag(true));
    separator.addEventListener('lostpointercapture',()=>finishDrag(true));
    separator.addEventListener('dblclick',()=>setWidth(DEFAULT_WIDTH));
    separator.addEventListener('keydown',event=>{
      if (event.key==='Escape' && drag) {event.preventDefault();event.stopPropagation();finishDrag(true);return;}
      if (event.key==='Home'||event.key==='End'||event.key==='Enter'||event.key==='ArrowLeft'||event.key==='ArrowRight') {
        event.preventDefault(); const range=bounds(workspace.clientWidth);
        const direction=workspace.dataset.sidebarPosition==='right' ? -1 : 1;
        const step=event.shiftKey ? 40 : 16;
        setWidth(event.key==='Home' ? range.min : event.key==='End' ? range.max : event.key==='Enter' ? DEFAULT_WIDTH : Number(separator.getAttribute('aria-valuenow'))+(event.key==='ArrowRight' ? step : -step)*direction);
      }
    });
    for(const toggle of toggles) toggle.addEventListener('click',()=>setCollapsed(mobile.matches ? mobilePanel!=='closed' : !preferences.sidebarCollapsed));
    mobileButtons.reading.addEventListener('click',()=>showMobile('closed'));
    mobileButtons.close.addEventListener('click',()=>showMobile('closed'));
    mobileButtons.editor.addEventListener('click',()=>showMobile('editor'));
    mobileButtons.list.addEventListener('click',()=>showMobile('list'));
    const cancelDrag=()=>finishDrag(true);
    window.addEventListener('blur',cancelDrag);
    const onVisibility=()=>{if(document.visibilityState==='hidden')cancelDrag();};
    document.addEventListener('visibilitychange',onVisibility);
    const onResize=()=>{if(mobile.matches)cancelDrag();if(!mobile.matches && sheetAnimation){++sheetRevision;sheetAnimation.cancel();sheetAnimation=null;}apply();onViewport();};
    const observer=new ResizeObserver(onResize);observer.observe(workspace);
    mobile.addEventListener('change',onResize);
    const onReduced=()=>{if(reduced.matches && sheetAnimation)sheetAnimation.finish();};
    reduced.addEventListener('change',onReduced);
    const viewport=window.visualViewport;
    function onViewport(){
      const unzoomed=!viewport || Math.abs(viewport.scale-1)<.01;
      const height=unzoomed ? viewport?.height || innerHeight : innerHeight;
      // Blurring the textarea precedes a Save click. Keep the surface still until
      // the keyboard actually retreats, rather than moving it on focusout.
      const keyboard=mobile.matches && unzoomed && innerHeight-height>120;
      const bottom=Math.max(0,innerHeight-height-(unzoomed ? viewport?.offsetTop || 0 : 0))+'px';
      workspace.dataset.keyboard=String(Boolean(keyboard));
      workspace.style.setProperty('--visible-height',height+'px');
      workspace.style.setProperty('--viewport-bottom',bottom);
      // The dock is a sibling of the workspace, so it cannot inherit its value.
      mobileDock.style.setProperty('--viewport-bottom',bottom);
    }
    viewport?.addEventListener('resize',onViewport);viewport?.addEventListener('scroll',onViewport);
    document.addEventListener('focusin',onViewport);document.addEventListener('focusout',onViewport);
    onViewport();
    preferences=saved(preferences); apply();
    return {
      preferences:()=>({...preferences}), refresh(){cancelDrag();apply();},
      restore(value){preferences=saved(normalize(value,preferences));apply();},
      reveal(){setCollapsed(false);},
      selecting(){if(mobile.matches)showMobile('closed');else setCollapsed(false);},
      reviewing(){if(mobile.matches)showMobile('list');else setCollapsed(false);},
      reading(){if(mobile.matches)showMobile('closed');},
      closeMobile(){if(!mobile.matches || mobilePanel==='closed')return false;showMobile('closed');return true;},
      cleanCopy(copy){const stage=copy.querySelector('.workspace');stage.classList.remove('is-resizing');stage.dataset.sidebarWidth=String(preferences.sidebarWidth);stage.dataset.sidebarCollapsed=String(preferences.sidebarCollapsed);stage.dataset.mobilePanel='closed';delete stage.dataset.mobileView;delete stage.dataset.keyboard;stage.style.removeProperty('--visible-height');stage.style.removeProperty('--viewport-bottom');copy.querySelector('#review-sidebar').hidden=false;const dock=copy.querySelector('#mobile-dock');dock.hidden=true;dock.style.removeProperty('--viewport-bottom');},
      destroy(){cancelDrag();sheetAnimation?.cancel();observer.disconnect();mobile.removeEventListener('change',onResize);reduced.removeEventListener('change',onReduced);viewport?.removeEventListener('resize',onViewport);viewport?.removeEventListener('scroll',onViewport);document.removeEventListener('focusin',onViewport);document.removeEventListener('focusout',onViewport);window.removeEventListener('blur',cancelDrag);document.removeEventListener('visibilitychange',onVisibility);}
    };
  }
  global.HRWorkspaceLayout = Object.freeze({normalize,bounds,mount});
})(typeof window === 'undefined' ? globalThis : window);
