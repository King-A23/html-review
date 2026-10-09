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
  function mount({workspace, sidebar, separator, toggles, onChange}) {
    let preferences = normalize({sidebarWidth:Number(workspace.dataset.sidebarWidth),sidebarCollapsed:workspace.dataset.sidebarCollapsed==='true'});
    let drag = null, frame = null;
    const mobile = matchMedia('(max-width:760px)');
    function saved(fallback) {
      try { return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY)),fallback); } catch (_) { return fallback; }
    }
    function apply() {
      const range = bounds(workspace.clientWidth);
      const width = Math.max(range.min,Math.min(range.max,preferences.sidebarWidth));
      workspace.style.setProperty('--sidebar-width',width+'px');
      workspace.dataset.sidebarWidth = String(preferences.sidebarWidth);
      workspace.dataset.sidebarCollapsed = String(preferences.sidebarCollapsed);
      sidebar.inert = preferences.sidebarCollapsed && workspace.classList.contains('has-document');
      separator.setAttribute('aria-valuemin',String(range.min));
      separator.setAttribute('aria-valuemax',String(range.max));
      separator.setAttribute('aria-valuenow',String(width));
      separator.setAttribute('aria-valuetext',width+' 像素');
      separator.tabIndex = !workspace.classList.contains('has-document') || mobile.matches || preferences.sidebarCollapsed ? -1 : 0;
      for (const toggle of toggles) {
        toggle.setAttribute('aria-expanded',String(!preferences.sidebarCollapsed));
        const label = preferences.sidebarCollapsed ? '展开批注栏' : '收起批注栏';
        toggle.setAttribute('aria-label',label); toggle.title = label;
      }
    }
    function commit() {
      try { localStorage.setItem(STORAGE_KEY,JSON.stringify(preferences)); } catch (_) { /* Still usable without storage. */ }
      onChange?.();
    }
    function setCollapsed(collapsed, remember = true) {
      if (preferences.sidebarCollapsed === collapsed) return;
      if (collapsed && sidebar.contains(document.activeElement)) toggles[0].focus({preventScroll:true});
      preferences.sidebarCollapsed = collapsed; apply();
      if (remember) commit();
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
    for(const toggle of toggles) toggle.addEventListener('click',()=>setCollapsed(!preferences.sidebarCollapsed));
    const cancelDrag=()=>finishDrag(true);
    window.addEventListener('blur',cancelDrag);
    const onVisibility=()=>{if(document.visibilityState==='hidden')cancelDrag();};
    document.addEventListener('visibilitychange',onVisibility);
    const onResize=()=>{if(mobile.matches)cancelDrag();apply();};
    const observer=new ResizeObserver(onResize);observer.observe(workspace);
    mobile.addEventListener('change',onResize);
    preferences=saved(preferences); apply();
    return {
      preferences:()=>({...preferences}), refresh(){cancelDrag();apply();},
      restore(value){preferences=saved(normalize(value,preferences));apply();},
      reveal(){setCollapsed(false);},
      cleanCopy(copy){const stage=copy.querySelector('.workspace');stage.classList.remove('is-resizing');stage.dataset.sidebarWidth=String(preferences.sidebarWidth);stage.dataset.sidebarCollapsed=String(preferences.sidebarCollapsed);},
      destroy(){cancelDrag();observer.disconnect();mobile.removeEventListener('change',onResize);window.removeEventListener('blur',cancelDrag);document.removeEventListener('visibilitychange',onVisibility);}
    };
  }
  global.HRWorkspaceLayout = Object.freeze({normalize,bounds,mount});
})(typeof window === 'undefined' ? globalThis : window);
