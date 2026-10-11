/* PDF pages are rendered by trusted code. Original bytes and passwords never enter the page DOM. */
(function (global) {
  'use strict';
  const lib=global.HRPdfLib, core=global.HRCore;
  const TIMEOUT=30000, MAX_PIXELS=8000000, MAX_SEARCH_CHARACTERS=4000000;
  let current=null, importing=null, assets=null;
  const clone=value=>JSON.parse(JSON.stringify(value));
  const abortError=()=>new Error('已取消 PDF 处理，原工作区和批注已保留。');
  const hash=value=>core.sha256(new TextEncoder().encode(JSON.stringify(value)));
  function alive(session) { if(session.destroyed) throw abortError(); }
  class OfflineData {
    async fetch({kind,filename}) {
      const folder={cMapUrl:'cmaps',standardFontDataUrl:'standard_fonts',wasmUrl:'wasm',iccUrl:'iccs'}[kind];
      assets ||= JSON.parse(document.getElementById('hr-pdf-assets').textContent);
      const encoded=assets[folder+'/'+filename];
      if(!encoded) throw new Error('未打包的 PDF 资源：'+filename);
      return core.base64ToBytes(encoded);
    }
  }
  function destroy(session) {
    if(!session || session.destroyed) return;
    session.destroyed=true;session.selectionSerial++;session.searchSerial++;session.checkSerial++;
    session.events?.abort();session.resize?.disconnect();session.thumbnailObserver?.disconnect();clearTimeout(session.scrollTimer);
    for(const slot of session.slots || []) { slot.renderTask?.cancel();slot.textLayer?.cancel();if(slot.canvas){slot.canvas.width=0;slot.canvas.height=0;} }
    for(const thumb of session.thumbnails || []) clearThumbnail(thumb);
    session.thumbnailGeneration++;session.thumbnailContainer?.replaceChildren();
    session.passwordCancel?.();session.passwordCancel=null;
    // Give PDF.js a short chance to release document fonts and filters before force termination.
    let stopped=false;
    const stop=()=>{if(stopped)return;stopped=true;session.pdfWorker?.destroy();session.worker?.terminate();URL.revokeObjectURL(session.workerUrl);};
    const cleanupTimer=setTimeout(stop,1000);
    Promise.resolve(session.loading?.destroy()).catch(()=>{}).finally(()=>{clearTimeout(cleanupTimer);stop();});
    session.fingerprints.clear();session.contents.clear();session.searchStreams.clear();session.searchCharacters=0;
    if(importing===session) importing=null;
  }
  async function timed(session,promise,label,budget=TIMEOUT) {
    alive(session);let timer;
    try { return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>{destroy(session);reject(new Error('PDF '+label+'超过 30 秒，已中止。批注与原文件仍保留。'));},budget);})]); }
    finally {clearTimeout(timer);}
  }
  function askPassword(session,updatePassword,reason) {
    // A Worker may deliver a password retry after cancellation. Only the active import owns this dialog.
    if(session.destroyed || importing!==session) return;
    const dialog=document.getElementById('pdf-password-dialog'),input=document.getElementById('pdf-password-input');
    session.passwordCancel?.();session.passwordWaiting=true;
    const passwordStarted=performance.now();let clockResumed=false;
    const resumeClock=()=>{if(clockResumed)return;clockResumed=true;session.passwordPausedMs+=performance.now()-passwordStarted;session.passwordWaiting=false;};
    document.getElementById('pdf-password-error').textContent=reason===lib.PasswordResponses.INCORRECT_PASSWORD ? '密码不正确，请重试。' : '';
    input.value='';const events=new AbortController();
    const finish=cancelled=>{
      events.abort();input.value='';resumeClock();session.passwordCancel=null;
      global.HRUI.closeDialog(dialog);
      if(cancelled) {destroy(session);session.rejectImport?.(abortError());}
    };
    session.passwordCancel=()=>{events.abort();input.value='';resumeClock();global.HRUI.closeDialog(dialog);};
    const submit=()=>{if(!input.value) {input.focus();return;} const password=input.value;finish(false);updatePassword(password);};
    document.getElementById('pdf-password-submit').addEventListener('click',submit,{signal:events.signal});
    document.getElementById('pdf-password-cancel').addEventListener('click',()=>finish(true),{signal:events.signal});
    dialog.addEventListener('cancel',event=>{event.preventDefault();finish(true);},{signal:events.signal});
    dialog.addEventListener('close',()=>{if(session.passwordWaiting)finish(true);},{signal:events.signal});
    input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();submit();}},{signal:events.signal});
    global.HRUI.openDialog(dialog);input.focus();
  }
  async function preview(data) {
    cancel();
    const importStarted=performance.now();
    const workerUrl=URL.createObjectURL(new Blob([core.base64ToBytes(document.getElementById('hr-pdf-worker').textContent)],{type:'application/javascript'}));
    const worker=new Worker(workerUrl);
    assets ||= JSON.parse(document.getElementById('hr-pdf-assets').textContent);
    const syncAssets={};
    for(const [name,encoded] of Object.entries(assets)) if(name.startsWith('iccs/') || name==='wasm/qcms_bg.wasm') syncAssets['offline:'+name]=core.base64ToBytes(encoded);
    worker.postMessage({hrOfflineSync:syncAssets});
    const session={data,workerUrl,worker,importStarted,passwordPausedMs:0,destroyed:false,contents:new Map(),searchStreams:new Map(),searchCharacters:0,fingerprints:new Map(),slots:[],selectionSerial:0,searchSerial:0,checkSerial:0,mode:'browse',zoom:'fit',pageNumber:1,renderQueue:Promise.resolve(),searchMatches:[],thumbnailGeneration:0,thumbnailQueue:Promise.resolve()};
    importing=session;
    worker.addEventListener('error',event=>{const error=new Error('PDF Worker 无法运行，当前工作区已保留。'+(event.message ? ' '+event.message : ''));session.rejectImport?.(error);destroy(session);});
    try {
      session.pdfWorker=new lib.PDFWorker({port:worker});
      session.loading=lib.getDocument({data:core.base64ToBytes(data.source.base64),worker:session.pdfWorker,
        BinaryDataFactory:OfflineData,useWorkerFetch:false,cMapUrl:'offline:cmaps/',cMapPacked:true,
        standardFontDataUrl:'offline:standard_fonts/',wasmUrl:'offline:wasm/',iccUrl:'offline:iccs/',
        isEvalSupported:false,enableXfa:false,disableAutoFetch:true,disableStream:true,disableRange:true,
        maxImageSize:-1,canvasMaxAreaInBytes:32000000,stopAtErrors:true,verbosity:0});
      session.loading.onPassword=(callback,reason)=>askPassword(session,callback,reason);
      session.doc=await new Promise((resolve,reject)=>{
        session.rejectImport=reject;
        const timer=setInterval(()=>{if(session.destroyed){clearInterval(timer);reject(abortError());return;}if(!session.passwordWaiting && performance.now()-session.importStarted-session.passwordPausedMs>=TIMEOUT){clearInterval(timer);destroy(session);reject(new Error('PDF 读取超过 30 秒，已中止；原工作区已保留。'));}},100);
        session.loading.promise.then(value=>{clearInterval(timer);resolve(value);},error=>{clearInterval(timer);reject(error);});
      });
      if(session.doc.numPages>1000) throw new Error('PDF 超过 1000 页限制；原工作区已保留。');
      const prepare=async()=>{
        session.labels=await session.doc.getPageLabels();session.outline=await session.doc.getOutline();
        session.geometry=[];session.pageProxies=[];
        for(let number=1;number<=session.doc.numPages;number++) {
          alive(session);const page=await session.doc.getPage(number);
          session.pageProxies.push(page);
          session.geometry.push({pageNumber:number,label:String(session.labels?.[number-1]||number).slice(0,100),viewBox:page.view.slice(),rotation:page.rotate,userUnit:page.userUnit});
        }
        // Complete the first render before replacing the previous workspace.
        const page=await session.doc.getPage(1), viewport=page.getViewport({scale:1});
        const scale=Math.min(1,Math.sqrt(MAX_PIXELS/(viewport.width*viewport.height)));
        const canvas=document.createElement('canvas');const scaled=page.getViewport({scale});
        canvas.width=Math.max(1,Math.floor(scaled.width));canvas.height=Math.max(1,Math.floor(scaled.height));
        await page.render({canvasContext:canvas.getContext('2d'),viewport:scaled,annotationMode:lib.AnnotationMode.ENABLE}).promise;
        await nativeNotes(page,canvas,scaled);
        canvas.width=0;canvas.height=0;await content(session,1);
      };
      await timed(session,prepare(),'预览准备',Math.max(1,TIMEOUT-(performance.now()-session.importStarted-session.passwordPausedMs)));alive(session);
      importing=null;session.rejectImport=null;
      return {pdf:true,session,html:'',warnings:['PDF 按原页预览；扫描页可框选，首版不提供 OCR。原生批注仅显示外观，不转换为修改任务。']};
    } catch(error) {
      destroy(session);
      if(error.name==='PasswordException') throw new Error('PDF 密码验证失败；原工作区已保留。');
      if(error.name==='InvalidPDFException' || error.name==='UnknownErrorException') throw new Error('PDF 损坏或格式不受支持；原工作区已保留。');
      throw error;
    }
  }
  async function content(session,number) {
    alive(session);
    if(session.contents.has(number)) return session.contents.get(number);
    const page=await session.doc.getPage(number), value=await page.getTextContent({includeMarkedContent:false,disableNormalization:true});
    value.items=value.items.filter(item=>typeof item.str==='string');
    let stream='';const starts=[];
    for(const item of value.items){starts.push(stream.length);stream+=item.str+(item.hasEOL?'\n':'');}
    const result={value,stream,starts};
    if(session.contents.size>=12) session.contents.delete(session.contents.keys().next().value);
    session.contents.set(number,result);return result;
  }
  async function searchStream(session,number) {
    alive(session);
    if(session.searchStreams.has(number)) return session.searchStreams.get(number);
    const stream=(await content(session,number)).stream;alive(session);
    if(session.searchStreams.has(number)) return session.searchStreams.get(number);
    // Reuse only exact extracted strings, keeping PDF item geometry in the existing
    // small content cache. The separate search cache is bounded to 8 MB of UTF-16.
    if(stream.length<=MAX_SEARCH_CHARACTERS) {
      while(session.searchCharacters+stream.length>MAX_SEARCH_CHARACTERS) {
        const oldest=session.searchStreams.keys().next().value;
        session.searchCharacters-=session.searchStreams.get(oldest).length;session.searchStreams.delete(oldest);
      }
      session.searchStreams.set(number,stream);session.searchCharacters+=stream.length;
    }
    return stream;
  }
  async function fingerprint(session,number) {
    alive(session);
    if(session.fingerprints.has(number)) return session.fingerprints.get(number);
    const resultPromise=(async()=>{
      const page=await session.doc.getPage(number), c=await content(session,number), geom=session.geometry[number-1];
      const textSha256=await hash({viewBox:geom.viewBox,rotation:geom.rotation,userUnit:geom.userUnit,items:c.value.items.map(item=>({str:item.str,transform:item.transform,width:item.width,height:item.height,hasEOL:item.hasEOL}))});
      const natural=page.getViewport({scale:1});const viewport=page.getViewport({scale:Math.min(1,600/Math.max(natural.width,natural.height))});
      const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      try {
        await page.render({canvasContext:canvas.getContext('2d',{willReadFrequently:true}),viewport,annotationMode:lib.AnnotationMode.ENABLE}).promise;
        await nativeNotes(page,canvas,viewport);
        const rgba=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
        const visualSha256=await core.sha256(new Uint8Array(rgba.buffer));alive(session);
        return {textSha256,visualSha256};
      } finally {canvas.width=0;canvas.height=0;}
    })();
    session.fingerprints.set(number,resultPromise);
    try {const result=await timed(session,resultPromise,'页面核对');session.fingerprints.set(number,result);return result;}
    catch(error){session.fingerprints.delete(number);throw error;}
  }
  function emit(session,event,extra={}) {if(!session.destroyed) session.emit?.({event,...extra});}
  function warning(session,error) {if(!session.destroyed) emit(session,'warning',{message:error.message || String(error)});else if(current===session)session.emit?.({event:'warning',message:error.message || String(error)});}
  function layout(session) {
    const available=Math.max(200,session.container.clientWidth-48);
    for(const slot of session.slots) {
      const geom=session.geometry[slot.number-1], natural=session.pageProxies[slot.number-1].getViewport({scale:1});
      const scale=session.zoom==='fit'?Math.min(2,available/natural.width):session.zoom;
      slot.viewport=session.pageProxies[slot.number-1].getViewport({scale});
      slot.node.style.width=slot.viewport.width+'px';slot.node.style.height=slot.viewport.height+'px';
      slot.node.style.setProperty('--total-scale-factor',scale*geom.userUnit);slot.node.style.setProperty('--scale-factor',scale);slot.node.style.setProperty('--user-unit',geom.userUnit);
    }
    paintFocus(session);emit(session,'pdf-view',{pageNumber:session.pageNumber,pageCount:session.doc.numPages,zoom:session.zoom});
  }
  function clearSlot(slot) {
    slot.renderTask?.cancel();slot.textLayer?.cancel();slot.renderTask=null;slot.textLayer=null;
    if(slot.canvas){slot.canvas.width=0;slot.canvas.height=0;}slot.canvas=null;slot.texts=null;slot.node.replaceChildren();slot.node.dataset.rendered='false';
  }
  async function renderSlot(session,slot,generation) {
    alive(session);if(generation!==session.renderGeneration || slot.node.dataset.rendered==='true') return;
    clearSlot(slot);const page=await session.doc.getPage(slot.number), viewport=slot.viewport;
    const ratio=Math.min(global.devicePixelRatio||1,2,Math.sqrt(MAX_PIXELS/(viewport.width*viewport.height)));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.floor(viewport.width*ratio));canvas.height=Math.max(1,Math.floor(viewport.height*ratio));
    canvas.className='pdf-canvas';canvas.setAttribute('aria-label','第 '+slot.number+' 页');canvas.style.width='100%';canvas.style.height='100%';slot.canvas=canvas;slot.node.append(canvas);
    const textContainer=document.createElement('div');textContainer.className='textLayer';slot.node.append(textContainer);
    slot.renderTask=page.render({canvasContext:canvas.getContext('2d'),viewport,transform:[ratio,0,0,ratio,0,0],annotationMode:lib.AnnotationMode.ENABLE});
    try {
      await timed(session,slot.renderTask.promise,'页面渲染');
      if(generation!==session.renderGeneration || session.destroyed) {clearSlot(slot);return;}
      await nativeNotes(page,canvas,viewport,ratio);
      if(generation!==session.renderGeneration || session.destroyed) {clearSlot(slot);return;}
      const c=await content(session,slot.number);slot.content=c;
      slot.textLayer=new lib.TextLayer({textContentSource:c.value,container:textContainer,viewport});await slot.textLayer.render();
      slot.texts=slot.textLayer.textDivs;
      slot.texts.forEach((node,index)=>{node.dataset.pdfItem=String(index);node.dataset.pdfPage=String(slot.number);});
      slot.node.dataset.noText=String(!c.stream.trim());
      await links(session,slot,page,generation);
      slot.node.dataset.rendered='true';slot.renderTask=null;paintFocus(session);paintSearch(session);guideScan(session);
    } catch(error) {if(error.name!=='RenderingCancelledException' && error.name!=='AbortException') throw error;}
  }
  async function links(session,slot,page,generation) {
    const annotations=await page.getAnnotations({intent:'display'});if(generation!==session.renderGeneration) return;
    for(const annotation of annotations) {
      if(!Array.isArray(annotation.rect)) continue;
      if(annotation.subtype==='Text') {
        const box=viewportRect(slot.viewport,annotation.rect),note=document.createElement('span');note.className='pdf-native-note';
        note.style.left=Math.min(box[0],box[2])+'px';note.style.top=Math.min(box[1],box[3])+'px';note.style.width=Math.abs(box[2]-box[0])+'px';note.style.height=Math.abs(box[3]-box[1])+'px';
        note.title='原生 PDF 批注：'+String(annotation.contentsObj?.str || '').slice(0,2000);note.setAttribute('role','img');note.setAttribute('aria-label',note.title);slot.node.append(note);continue;
      }
      if(annotation.subtype!=='Link') continue;
      if(!annotation.dest && !(typeof annotation.url==='string' && /^(https?:|mailto:)/i.test(annotation.url))) continue;
      const box=viewportRect(slot.viewport,annotation.rect), link=document.createElement('a');link.className='pdf-link';
      link.style.left=Math.min(box[0],box[2])+'px';link.style.top=Math.min(box[1],box[3])+'px';link.style.width=Math.abs(box[2]-box[0])+'px';link.style.height=Math.abs(box[3]-box[1])+'px';
      link.setAttribute('aria-label',annotation.url || '跳转到文档页面');
      if(annotation.url){link.href=annotation.url;link.target='_blank';link.rel='noopener noreferrer';}
      else {link.href='#';link.addEventListener('click',event=>{event.preventDefault();destination(session,annotation.dest).then(number=>number && goToPage(number)).catch(error=>warning(session,error));});}
      link.addEventListener('click',event=>{if(session.mode!=='browse') event.preventDefault();});slot.node.append(link);
    }
  }
  // Notes without an appearance stream are viewer-generated icons. Keep them visible,
  // including in fingerprints, without creating an editable annotation layer.
  async function nativeNotes(page,canvas,viewport,ratio=1) {
    const annotations=await page.getAnnotations({intent:'display'}),ctx=canvas.getContext('2d');
    ctx.save();ctx.setTransform(ratio,0,0,ratio,0,0);
    for(const note of annotations) {
      if(note.subtype!=='Text' || note.hasAppearance || !Array.isArray(note.rect)) continue;
      const box=viewportRect(viewport,note.rect),x=Math.min(box[0],box[2]),y=Math.min(box[1],box[3]),w=Math.abs(box[2]-box[0]),h=Math.abs(box[3]-box[1]);
      const color=note.color;ctx.fillStyle=color?.length===3 ? 'rgb('+Array.from(color).join(',')+')' : '#e7c15a';
      ctx.beginPath();ctx.roundRect(x,y,w,h,Math.min(2,w/8,h/8));ctx.fill();
    }
    ctx.restore();
  }
  async function destination(session,dest) {
    if(typeof dest==='string') dest=await session.doc.getDestination(dest);
    if(!Array.isArray(dest)) return null;
    return typeof dest[0]==='number'?dest[0]+1:(await session.doc.getPageIndex(dest[0]))+1;
  }
  function wantedPages(session) {const n=session.pageNumber;return [n,...[n-1,n+1].filter(v=>v>=1&&v<=session.slots.length)];}
  function scheduleRender(session,reset=false) {
    if(session.destroyed) return Promise.resolve();
    session.renderGeneration++;
    if(reset) session.slots.forEach(clearSlot);
    const wanted=wantedPages(session);session.slots.filter(slot=>!wanted.includes(slot.number)).forEach(clearSlot);
    const generation=session.renderGeneration;
    session.renderQueue=session.renderQueue.catch(()=>{}).then(async()=>{for(const number of wanted){if(session.destroyed || generation!==session.renderGeneration) return;await renderSlot(session,session.slots[number-1],generation);}}).catch(error=>warning(session,error));
    return session.renderQueue;
  }
  async function mount(prepared,container,callback) {
    const session=prepared.session;alive(session);current=session;session.container=container;session.emit=callback;session.renderGeneration=1;
    session.events=new AbortController();const signal=session.events.signal;
    container.replaceChildren();container.hidden=false;
    for(const geom of session.geometry) {
      const node=document.createElement('div');node.className='pdf-page';node.dataset.pageNumber=String(geom.pageNumber);node.dataset.rendered='false';node.setAttribute('aria-label','PDF 第 '+geom.pageNumber+' 页');
      container.append(node);session.slots.push({number:geom.pageNumber,node});
    }
    const scroll=()=>{clearTimeout(session.scrollTimer);session.scrollTimer=setTimeout(()=>{
      const top=container.getBoundingClientRect().top;
      let number=1,distance=Infinity;
      for(const slot of session.slots){const rect=slot.node.getBoundingClientRect(),d=Math.abs(rect.top-top);if(rect.bottom>top && d<distance){number=slot.number;distance=d;}}
      if(number!==session.pageNumber){session.pageNumber=number;updateThumbnails(session);guideScan(session);emit(session,'pdf-view',{pageNumber:number,pageCount:session.doc.numPages,zoom:session.zoom});scheduleRender(session);}
    },80);};
    container.addEventListener('scroll',scroll,{signal});
    container.addEventListener('pointerdown',event=>pointerDown(session,event),{signal});
    container.addEventListener('pointermove',event=>pointerMove(session,event),{signal});
    container.addEventListener('pointerup',event=>pointerUp(session,event),{signal});
    container.addEventListener('pointercancel',()=>{session.drag=null;paintFocus(session);},{signal});
    document.addEventListener('selectionchange',()=>{
      if(session.mode!=='text' || session.drag || current!==session || session.destroyed) return;
      if(!session.container.contains(document.activeElement)) return;
      const selection=global.getSelection(), captured=session.selectionRange;
      if(selection?.isCollapsed){session.selectionSerial++;session.selectionRange=null;session.selectedText=false;session.focus=null;paintFocus(session);emit(session,'target-cleared',{kind:'text'});}
      else if(captured && selection?.rangeCount) {const next=selection.getRangeAt(0);if(next.startContainer!==captured.startContainer || next.startOffset!==captured.startOffset || next.endContainer!==captured.endContainer || next.endOffset!==captured.endOffset){session.selectionSerial++;session.selectionRange=null;}}
    },{signal});
    container.addEventListener('keyup',event=>{if(session.mode==='text' && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))captureSelection(session).catch(error=>warning(session,error));},{signal});
    session.resize=new ResizeObserver(()=>{if(session.zoom==='fit'){const width=container.clientWidth;if(width!==session.lastWidth){session.lastWidth=width;const anchor=readingAnchor(session);layout(session);restoreAnchor(session,anchor);scheduleRender(session,true);}}});session.lastWidth=container.clientWidth;session.resize.observe(container);
    mountThumbnails(session);container.dataset.pdfMode='browse';layout(session);await scheduleRender(session);alive(session);
    emit(session,'pages',{pages:session.geometry.map(geom=>({index:geom.pageNumber,title:'第 '+geom.pageNumber+' 页'+(geom.label!==String(geom.pageNumber)?' · '+geom.label:'')}))});
    const outline=[];
    async function walk(items,level){for(const item of items || []){if(outline.length>=1000) return;const number=await destination(session,item.dest);if(number) outline.push({index:number-1,level:Math.min(level,6),text:String(item.title).slice(0,160)});await walk(item.items,level+1);}}
    await walk(session.outline,1);if(!outline.length) outline.push(...session.geometry.map(g=>({index:g.pageNumber-1,level:1,text:'第 '+g.pageNumber+' 页'})));
    emit(session,'document-outline',{items:outline});emit(session,'ready');
  }
  function viewportRect(viewport,rect) {return [...viewport.convertToViewportPoint(rect[0],rect[1]),...viewport.convertToViewportPoint(rect[2],rect[3])];}
  function pageFor(session,event) {const node=event.target.closest?.('.pdf-page');return node && session.slots[Number(node.dataset.pageNumber)-1];}
  function localPoint(slot,event) {const box=slot.node.getBoundingClientRect();return [Math.max(0,Math.min(slot.viewport.width,event.clientX-box.left)),Math.max(0,Math.min(slot.viewport.height,event.clientY-box.top))];}
  function canonical(slot,box,geometry) {
    const [x,y,w,h]=box;
    const quad=[...slot.viewport.convertToPdfPoint(x,y),...slot.viewport.convertToPdfPoint(x+w,y),...slot.viewport.convertToPdfPoint(x+w,y+h),...slot.viewport.convertToPdfPoint(x,y+h)];
    const b=geometry.viewBox;for(let i=0;i<8;i++) quad[i]=Math.min(b[i%2+2],Math.max(b[i%2],quad[i]));
    const xs=[quad[0],quad[2],quad[4],quad[6]],ys=[quad[1],quad[3],quad[5],quad[7]];
    return {quad,rect:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]};
  }
  function pointerDown(session,event) {
    if(event.button!==0) return;const slot=pageFor(session,event);if(!slot) return;
    session.selectionSerial++;
    if(session.mode==='text') session.container.focus({preventScroll:true});
    if(session.mode==='region'){event.preventDefault();global.getSelection()?.removeAllRanges();session.selectionSerial++;session.drag={slot,start:localPoint(slot,event),end:localPoint(slot,event),pointerId:event.pointerId};session.container.setPointerCapture(event.pointerId);paintFocus(session);}
  }
  function pointerMove(session,event) {if(session.drag){session.drag.end=localPoint(session.drag.slot,event);paintFocus(session);}}
  function pointerUp(session,event) {
    const slot=pageFor(session,event);
    if(session.drag) {
      const drag=session.drag;session.drag=null;if(session.container.hasPointerCapture(event.pointerId)) session.container.releasePointerCapture(event.pointerId);
      const x=Math.min(drag.start[0],drag.end[0]),y=Math.min(drag.start[1],drag.end[1]),w=Math.abs(drag.end[0]-drag.start[0]),h=Math.abs(drag.end[1]-drag.start[1]);
      if(w<4 || h<4){session.focus=null;paintFocus(session);emit(session,'target-cleared',{kind:'region'});return;}
      const rect=canonical(drag.slot,[x,y,w,h],session.geometry[drag.slot.number-1]).rect;
      selectRegion(session,drag.slot.number,rect).catch(error=>warning(session,error));
    } else if(slot && session.mode==='page') selectPage(session,slot.number).catch(error=>warning(session,error));
    else if(session.mode==='text') captureSelection(session).catch(error=>warning(session,error));
  }
  async function pageMeta(session,number) {return {...clone(session.geometry[number-1]),fingerprint:await fingerprint(session,number)};}
  function makeTarget(session,kind,pages,extra={}) {
    const first=pages[0];return {kind,selector:'pdf-page-'+(first?.pageNumber||'all'),pdf:{adapterVersion:'1',sourceSha256:session.data.source.sha256,pages},...extra};
  }
  function chosen(session,target,serial) {
    if(session.destroyed || current!==session || serial!==session.selectionSerial) return;
    core.validatePdfTarget(target);session.focus=target;paintFocus(session);emit(session,'target',{target});
  }
  async function selectRegion(session,number,rect) {const serial=++session.selectionSerial;const meta=await pageMeta(session,number);meta.rects=[rect];chosen(session,makeTarget(session,'region',[meta],{text:'第 '+number+' 页 · 框选区域'}),serial);}
  async function selectPage(session,number) {
    if(number<1 || number>session.slots.length) return;const serial=++session.selectionSerial;
    const meta=await pageMeta(session,number);meta.rects=[meta.viewBox.slice()];
    chosen(session,makeTarget(session,'page',[meta],{scope:'single-page',pageIndex:number,pageCount:session.slots.length,pageTitle:'PDF 第 '+number+' 页',text:'PDF 第 '+number+' 页'}),serial);
  }
  async function captureSelection(session) {
    const selection=global.getSelection();if(!selection?.rangeCount || selection.isCollapsed) {session.selectionSerial++;session.selectionRange=null;if(session.selectedText){session.selectedText=false;session.focus=null;paintFocus(session);emit(session,'target-cleared',{kind:'text'});}const slot=session.slots[session.pageNumber-1];if(slot?.node.dataset.noText==='true') emit(session,'warning',{message:'这一页没有可选文字，请切换到「区域」框选。'});return;}
    const range=selection.getRangeAt(0).cloneRange();
    if(!session.container.contains(range.startContainer) || !session.container.contains(range.endContainer)) return;
    session.selectionRange=range.cloneRange();const serial=++session.selectionSerial,pages=[];
    for(const slot of session.slots) {
      if(!slot.texts) continue;const segments=[],rects=[],quads=[];
      for(let index=0;index<slot.texts.length;index++) {
        const span=slot.texts[index];if(!span.firstChild || !range.intersectsNode(span)) continue;
        const part=document.createRange();part.selectNodeContents(span);
        if(range.compareBoundaryPoints(Range.START_TO_START,part)>0) part.setStart(range.startContainer,range.startOffset);
        if(range.compareBoundaryPoints(Range.END_TO_END,part)<0) part.setEnd(range.endContainer,range.endOffset);
        const text=part.toString();if(!text) continue;
        const prefix=document.createRange();prefix.selectNodeContents(span);prefix.setEnd(part.startContainer,part.startOffset);
        const start=prefix.toString().length;segments.push({itemIndex:index,start,end:start+text.length,text});
        const box=slot.node.getBoundingClientRect();
        for(const rect of part.getClientRects()) {if(rect.width<=0 || rect.height<=0) continue;const mapped=canonical(slot,[rect.left-box.left,rect.top-box.top,rect.width,rect.height],session.geometry[slot.number-1]);if(mapped.rect[2]>mapped.rect[0]&&mapped.rect[3]>mapped.rect[1]){rects.push(mapped.rect);quads.push(mapped.quad);}}
      }
      if(!segments.length || !rects.length) continue;
      const c=slot.content,first=segments[0],last=segments.at(-1),a=c.starts[first.itemIndex]+first.start,b=c.starts[last.itemIndex]+last.end;
      const quote=c.stream.slice(a,b);
      pages.push({...await pageMeta(session,slot.number),rects,quads,segments,quote,prefix:c.stream.slice(Math.max(0,a-72),a),suffix:c.stream.slice(b,b+72)});
    }
    if(!pages.length) {emit(session,'warning',{message:'没有读取到可靠的文字范围，请重新选择或改用区域批注。'});return;}
    session.selectedText=true;
    const exact=pages.map(page=>page.quote).join('\n');if(exact.length>20000) throw new Error('选中文字超过 20000 字，请缩小范围。');
    chosen(session,makeTarget(session,'text',pages,{quote:{exact,prefix:pages[0].prefix,suffix:pages.at(-1).suffix}}),serial);
  }
  function paintFocus(session) {
    if(!session.container) return;session.container.querySelectorAll('.pdf-focus').forEach(node=>node.remove());
    const draw=(slot,rect)=>{const node=document.createElement('div');node.className='pdf-focus';node.style.left=rect[0]+'px';node.style.top=rect[1]+'px';node.style.width=rect[2]+'px';node.style.height=rect[3]+'px';slot.node.append(node);};
    for(const page of session.focus?.pdf?.pages || []) {const slot=session.slots[page.pageNumber-1];if(!slot)continue;for(const rect of page.rects){const box=viewportRect(slot.viewport,rect);draw(slot,[Math.min(box[0],box[2]),Math.min(box[1],box[3]),Math.abs(box[2]-box[0]),Math.abs(box[3]-box[1])]);}}
    if(session.drag){const {slot,start,end}=session.drag;draw(slot,[Math.min(start[0],end[0]),Math.min(start[1],end[1]),Math.abs(start[0]-end[0]),Math.abs(start[1]-end[1])]);}
  }
  function goToPage(number) {
    const session=current;if(!session || session.destroyed || !Number.isInteger(number)) return;
    number=Math.max(1,Math.min(session.slots.length,number));session.pageNumber=number;updateThumbnails(session);guideScan(session);session.slots[number-1].node.scrollIntoView({block:'start',behavior:'auto'});emit(session,'pdf-view',{pageNumber:number,pageCount:session.slots.length,zoom:session.zoom});scheduleRender(session);
  }
  function setZoom(value) {
    const session=current;if(!session || session.destroyed)return;
    if(value!=='fit' && (!Number.isFinite(value) || value<.25 || value>2))return;
    const anchor=readingAnchor(session);session.zoom=value;layout(session);restoreAnchor(session,anchor);scheduleRender(session,true);
  }
  function fingerprintEqual(a,b) {return a?.textSha256===b?.textSha256 && a?.visualSha256===b?.visualSha256;}
  function geometricallyEqual(a,b) {return JSON.stringify(a.viewBox)===JSON.stringify(b.viewBox) && a.rotation===b.rotation && a.userUnit===b.userUnit;}
  async function resolveTarget(session,target,checkToken) {
    core.validatePdfTarget(target);
    if(target.scope==='whole-document') return {status:'exact',reason:target.pdf.sourceSha256===session.data.source.sha256?'整体意见对应整个文件。':'原文件版本已变化，整体意见仍覆盖整个文件。',target:clone(target)};
    const same=target.pdf.sourceSha256===session.data.source.sha256,mapped=[];
    for(const old of target.pdf.pages) {
      alive(session);if(checkToken!==undefined && checkToken!==session.checkSerial) throw abortError();
      let candidates=[];
      if(same) {
        const geometry=session.geometry[old.pageNumber-1];
        if(!geometry || !geometricallyEqual(old,geometry) || !fingerprintEqual(old.fingerprint,await fingerprint(session,old.pageNumber))) return {status:'missing',reason:'批注定位与当前页面内容不一致。'};
        candidates=[old.pageNumber];
      } else {
        // Search all pages before choosing. Repeated pages must remain ambiguous.
        for(const geom of session.geometry) {
          if(checkToken!==undefined && checkToken!==session.checkSerial) throw abortError();
          emit(session,'check-progress',{message:'核对第 '+geom.pageNumber+' / '+session.slots.length+' 页…'});
          if(geometricallyEqual(old,geom) && fingerprintEqual(old.fingerprint,await fingerprint(session,geom.pageNumber))) candidates.push(geom.pageNumber);
        }
      }
      if(candidates.length>1) return {status:'ambiguous',reason:'找到多个内容相同的页面，请重新选择位置。'};
      if(candidates.length===1) {
        const number=candidates[0];
        if(target.kind==='text') {const c=await content(session,number),first=old.segments[0],last=old.segments.at(-1),a=c.starts[first.itemIndex]+first.start,b=c.starts[last.itemIndex]+last.end;
          if(!old.segments.every(s=>c.value.items[s.itemIndex]?.str.slice(s.start,s.end)===s.text) || c.stream.slice(a,b)!==old.quote || (old.prefix!==undefined && c.stream.slice(Math.max(0,a-old.prefix.length),a)!==old.prefix) || (old.suffix!==undefined && c.stream.slice(b,b+old.suffix.length)!==old.suffix))return {status:'missing',reason:'文字项、原文或上下文与选区不一致。'};}
        mapped.push({...clone(old),...clone(session.geometry[number-1])});continue;
      }
      if(target.kind!=='text') return {status:'missing',reason:'页面内容已变化或删除，原区域需人工确认。'};
      const matches=[];
      for(const geom of session.geometry) {
        if(checkToken!==undefined && checkToken!==session.checkSerial) throw abortError();
        const c=await content(session,geom.pageNumber);let offset=0;
        while((offset=c.stream.indexOf(old.quote,offset))!==-1) {
          const end=offset+old.quote.length;
          if((!old.prefix || c.stream.slice(Math.max(0,offset-old.prefix.length),offset)===old.prefix) && (!old.suffix || c.stream.slice(end,end+old.suffix.length)===old.suffix)) matches.push({number:geom.pageNumber,start:offset,end});
          offset++;if(matches.length>1)break;
        }
        if(matches.length>1)break;
      }
      if(matches.length>1)return {status:'ambiguous',reason:'原文及上下文对应多个候选位置。'};
      if(!matches.length)return {status:'missing',reason:'原文已删除、上下文已变化或无法确认。'};
      const match=matches[0], meta=await pageMeta(session,match.number), c=await content(session,match.number);
      const segments=[],rects=[];
      for(let index=0;index<c.value.items.length;index++) {
        const item=c.value.items[index],start=Math.max(0,match.start-c.starts[index]),end=Math.min(item.str.length,match.end-c.starts[index]);if(end<=start)continue;
        segments.push({itemIndex:index,start,end,text:item.str.slice(start,end)});
        // Only a visual hint for fallback; semantic match must be reviewed before rebinding.
        const [a,b,cc,d,x,y]=item.transform,h=Math.hypot(cc,d)||item.height||1,w=item.width||1,angle=Math.atan2(b,a);
        const dx=Math.cos(angle)*w,dy=Math.sin(angle)*w,hx=-Math.sin(angle)*h,hy=Math.cos(angle)*h;
        const points=[[x+dx*start/item.str.length,y+dy*start/item.str.length],[x+dx*end/item.str.length,y+dy*end/item.str.length],[x+dx*end/item.str.length+hx,y+dy*end/item.str.length+hy],[x+dx*start/item.str.length+hx,y+dy*start/item.str.length+hy]];
        const xs=points.map(p=>Math.min(meta.viewBox[2],Math.max(meta.viewBox[0],p[0]))),ys=points.map(p=>Math.min(meta.viewBox[3],Math.max(meta.viewBox[1],p[1])));
        const rect=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];if(rect[2]>rect[0]&&rect[3]>rect[1]) rects.push(rect);
      }
      if(!rects.length)return {status:'missing',reason:'原文匹配但无法确认有效坐标。'};
      mapped.push({...meta,segments,rects,quote:old.quote,prefix:old.prefix,suffix:old.suffix});
    }
    if(mapped.some((page,index)=>index && page.pageNumber<=mapped[index-1].pageNumber))return {status:'ambiguous',reason:'跨页选区的页面顺序已变化。'};
    const resolved=clone(target);resolved.pdf.pages=mapped;
    return {status:same?'exact':'fallback',reason:same?'原文件与选区已核对。':'已在新版本找到唯一位置，请核对；原定位记录未修改。',target:resolved};
  }
  function readingAnchor(session) {
    const frame=session.container.getBoundingClientRect(),top=frame.top+session.container.clientTop;
    const slot=session.slots.find(slot=>slot.node.getBoundingClientRect().bottom>top) || session.slots.at(-1);
    const rect=slot.node.getBoundingClientRect();
    return {number:slot.number,point:slot.viewport.convertToPdfPoint(top<rect.top?0:Math.max(0,frame.left+session.container.clientLeft-rect.left),Math.max(0,top-rect.top)),gap:Math.max(0,rect.top-top)};
  }
  function restoreAnchor(session,anchor) {
    const slot=session.slots[anchor.number-1],frame=session.container.getBoundingClientRect(),rect=slot.node.getBoundingClientRect(),point=slot.viewport.convertToViewportPoint(...anchor.point);
    session.container.scrollTop+=rect.top-(frame.top+session.container.clientTop)+point[1]-anchor.gap;
    session.container.scrollLeft+=rect.left-(frame.left+session.container.clientLeft)+point[0];
    session.pageNumber=anchor.number;
  }
  function guideScan(session) {
    if(session.mode!=='text') {session.scanGuidancePage=null;return;}
    const slot=session.slots[session.pageNumber-1];
    if(slot?.node.dataset.noText==='true' && session.scanGuidancePage!==slot.number) {
      session.scanGuidancePage=slot.number;emit(session,'scan-text-guidance',{pageNumber:slot.number,message:'这一页没有可选文字。请切换到「区域」，框选需要批注的位置。'});
    } else if(slot?.node.dataset.noText==='false')session.scanGuidancePage=null;
  }
  function clearThumbnail(thumb) {thumb.task?.cancel();thumb.task=null;if(thumb.canvas){thumb.canvas.width=0;thumb.canvas.height=0;thumb.canvas.remove();thumb.canvas=null;}}
  function mountThumbnails(session) {
    const container=document.getElementById('pdf-thumbnails');if(!container)return;
    session.thumbnailContainer=container;session.thumbnails=[];container.replaceChildren();
    for(const geom of session.geometry) {
      const button=document.createElement('button');button.type='button';button.className='pdf-thumbnail';button.dataset.pageNumber=String(geom.pageNumber);button.setAttribute('aria-label','跳转到第 '+geom.pageNumber+' 页');
      const label=document.createElement('span');label.textContent='第 '+geom.pageNumber+' 页';button.append(label);container.append(button);
      const thumb={number:geom.pageNumber,node:button,visible:false};session.thumbnails.push(thumb);
      button.addEventListener('click',()=>goToPage(geom.pageNumber),{signal:session.events.signal});
    }
    container.addEventListener('scroll',()=>scheduleThumbnails(session),{signal:session.events.signal});
    session.thumbnailObserver=new ResizeObserver(()=>scheduleThumbnails(session));session.thumbnailObserver.observe(container);
    updateThumbnails(session);scheduleThumbnails(session);
  }
  function updateThumbnails(session) {
    for(const thumb of session.thumbnails || []) {const selected=thumb.number===session.pageNumber;thumb.node.setAttribute('aria-current',selected?'page':'false');}
  }
  function scheduleThumbnails(session) {
    const container=session.thumbnailContainer;if(!container || session.destroyed)return;
    const frame=container.getBoundingClientRect(),visible=container.getClientRects().length>0 && !container.hidden;
    const wanted=visible ? session.thumbnails.filter(thumb=>{const rect=thumb.node.getBoundingClientRect();return rect.bottom>frame.top-160 && rect.top<frame.bottom+160;}).slice(0,12) : [];
    const generation=++session.thumbnailGeneration;
    for(const thumb of session.thumbnails)if(!wanted.includes(thumb))clearThumbnail(thumb);
    session.thumbnailQueue=session.thumbnailQueue.catch(()=>{}).then(async()=>{
      for(const thumb of wanted) {
        if(session.destroyed || generation!==session.thumbnailGeneration)return;if(thumb.canvas)continue;
        const page=session.pageProxies[thumb.number-1],natural=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(1,112/natural.width,144/natural.height)});
        const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);canvas.setAttribute('aria-hidden','true');thumb.canvas=canvas;thumb.node.prepend(canvas);
        thumb.task=page.render({canvasContext:canvas.getContext('2d'),viewport,annotationMode:lib.AnnotationMode.ENABLE});
        try {await thumb.task.promise;if(session.destroyed || generation!==session.thumbnailGeneration){clearThumbnail(thumb);continue;}await nativeNotes(page,canvas,viewport);thumb.task=null;}
        catch(error){clearThumbnail(thumb);if(error.name!=='RenderingCancelledException')warning(session,error);}
      }
    });
  }
  function paintSearch(session) {
    session.container.querySelectorAll('.pdf-search-highlight').forEach(node=>node.remove());
    for(const slot of session.slots) {
      if(!slot.texts || slot.node.dataset.rendered!=='true')continue;const box=slot.node.getBoundingClientRect();
      const pageMatches=session.searchMatches.filter(match=>match.index===slot.number-1),visibleMatches=pageMatches.slice(0,500),active=pageMatches.find(match=>match.id===session.activeSearchId);if(active && !visibleMatches.includes(active))visibleMatches.push(active);
      for(const match of visibleMatches) {
        for(let index=0;index<slot.texts.length;index++) {
          const span=slot.texts[index],item=slot.content.value.items[index],start=Math.max(0,match.start-slot.content.starts[index]),end=Math.min(item.str.length,match.end-slot.content.starts[index]);
          if(end<=start || !span.firstChild)continue;
          const range=document.createRange();range.setStart(span.firstChild,start);range.setEnd(span.firstChild,end);
          for(const rect of range.getClientRects()) {
            if(!rect.width || !rect.height)continue;const node=document.createElement('div');node.className='pdf-search-highlight'+(match.id===session.activeSearchId?' active':'');node.dataset.searchId=match.id;
            node.style.left=rect.left-box.left+'px';node.style.top=rect.top-box.top+'px';node.style.width=rect.width+'px';node.style.height=rect.height+'px';slot.node.append(node);
          }
        }
      }
    }
  }
  async function navigateSearch(session,match) {
    if(!match)return;session.activeSearchId=match.id;goToPage(match.index+1);await session.renderQueue;
    if(session.destroyed || session.activeSearchId!==match.id)return;paintSearch(session);
    const node=session.container.querySelector('.pdf-search-highlight.active');node?.scrollIntoView({block:'center',inline:'nearest',behavior:'auto'});
    emit(session,'pdf-search-position',{current:session.searchMatches.indexOf(match)+1,total:session.searchMatches.length,id:match.id});
  }
  async function search(session,query) {
    const serial=++session.searchSerial,items=[],matches=[],pattern=new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'giu');let total=0;session.searchMatches=[];session.activeSearchId=null;paintSearch(session);
    for(const geom of session.geometry) {
      alive(session);if(serial!==session.searchSerial)return;
      emit(session,'search-progress',{message:'查找第 '+geom.pageNumber+' / '+session.slots.length+' 页…'});
      const stream=await timed(session,searchStream(session,geom.pageNumber),'文字搜索');let found;pattern.lastIndex=0;
      while((found=pattern.exec(stream))!==null){const index=found.index;total++;
        const match={id:serial+':'+geom.pageNumber+':'+index,index:geom.pageNumber-1,start:index,end:index+found[0].length};
        if(matches.length<10000)matches.push(match);
        if(items.length<50)items.push({...match,text:('第 '+geom.pageNumber+' 页 · '+stream.slice(Math.max(0,index-30),index+query.length+80)).slice(0,220)});
      }
    }
    if(serial===session.searchSerial){session.searchMatches=matches;paintSearch(session);emit(session,'document-search',{query,total,items,navigableTotal:matches.length});emit(session,'pdf-search-position',{current:0,total:matches.length});}
  }
  async function reviewCandidates(session,target,token) {
    core.validatePdfTarget(target);const candidates=[];
    const add=(candidate,label,text)=>{candidate=clone(candidate);candidate.pdf.sourceSha256=session.data.source.sha256;core.validatePdfTarget(candidate);candidates.push({target:candidate,label,text:String(text || candidate.quote?.exact || candidate.text || '').slice(0,1600)});};
    const result=await resolveTarget(session,target,token);
    if(result.target && ['exact','fallback'].includes(result.status)) {add(result.target,'第 '+(result.target.pdf.pages[0]?.pageNumber || 1)+' 页 · '+result.reason);return {...result,candidates};}
    // Cross-page anchors need a unique ordered match; do not manufacture a partial selection.
    if(target.pdf.pages.length!==1)return {...result,candidates};
    const old=target.pdf.pages[0];
    if(target.kind==='text') {
      for(const geom of session.geometry) {
        if(token!==session.checkSerial)throw abortError();const c=await content(session,geom.pageNumber);let offset=0;
        while(candidates.length<6 && (offset=c.stream.indexOf(old.quote,offset))!==-1) {
          const endOffset=offset+old.quote.length,segments=[],rects=[],meta=await pageMeta(session,geom.pageNumber);
          for(let index=0;index<c.value.items.length;index++) {
            const item=c.value.items[index],start=Math.max(0,offset-c.starts[index]),end=Math.min(item.str.length,endOffset-c.starts[index]);if(end<=start)continue;
            segments.push({itemIndex:index,start,end,text:item.str.slice(start,end)});
            const [a,b,cc,d,x,y]=item.transform,h=Math.hypot(cc,d)||item.height||1,w=item.width||1,angle=Math.atan2(b,a),dx=Math.cos(angle)*w,dy=Math.sin(angle)*w,hx=-Math.sin(angle)*h,hy=Math.cos(angle)*h;
            const points=[[x+dx*start/item.str.length,y+dy*start/item.str.length],[x+dx*end/item.str.length,y+dy*end/item.str.length],[x+dx*end/item.str.length+hx,y+dy*end/item.str.length+hy],[x+dx*start/item.str.length+hx,y+dy*start/item.str.length+hy]];
            const xs=points.map(p=>Math.min(meta.viewBox[2],Math.max(meta.viewBox[0],p[0]))),ys=points.map(p=>Math.min(meta.viewBox[3],Math.max(meta.viewBox[1],p[1]))),rect=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];if(rect[2]>rect[0] && rect[3]>rect[1])rects.push(rect);
          }
          if(rects.length) {
            const prefix=c.stream.slice(Math.max(0,offset-72),offset),suffix=c.stream.slice(endOffset,endOffset+72),candidate=clone(target);
            candidate.pdf.pages=[{...meta,segments,rects,quote:old.quote,prefix,suffix}];candidate.quote={exact:old.quote,prefix,suffix};
            add(candidate,'第 '+geom.pageNumber+' 页 · 文字位置 '+(offset+1)+'，请核对上下文',prefix+'【'+old.quote+'】'+suffix);
          }
          offset++;if(candidates.length>=6)break;
        }
        if(candidates.length>=6)break;
      }
    } else {
      for(const geom of session.geometry) {
        if(token!==session.checkSerial)throw abortError();if(!geometricallyEqual(old,geom))continue;
        const meta=await pageMeta(session,geom.pageNumber),identical=fingerprintEqual(old.fingerprint,meta.fingerprint);
        if(!identical && geom.pageNumber!==old.pageNumber)continue;
        const candidate=clone(target);candidate.pdf.pages=[{...meta,rects:clone(old.rects)}];
        if(candidate.kind==='page'){candidate.pageIndex=geom.pageNumber;candidate.pageCount=session.slots.length;candidate.pageTitle='PDF 第 '+geom.pageNumber+' 页';}
        add(candidate,'第 '+geom.pageNumber+' 页 · '+(identical?'相同页面内容，请核对':'原页码对应页面，内容已变化，请核对'));
        if(candidates.length>=6)break;
      }
    }
    return {...result,candidates};
  }
  async function command(name,extra={}) {
    const session=current;if(!session || session.destroyed)return;
    const searchSerial=session.searchSerial+1;
    try {
      if(name==='set-mode') {session.selectionSerial++;session.mode=extra.mode==='element'?'region':extra.mode;session.container.dataset.pdfMode=session.mode;guideScan(session);}
      else if(name==='clear-focus' || name==='clear-selection') {session.selectionSerial++;session.focus=null;session.selectedText=false;if(name==='clear-selection')global.getSelection()?.removeAllRanges();paintFocus(session);}
      else if(name==='select-page') {if(session.mode==='page'){goToPage(extra.index);await selectPage(session,extra.index);}}
      else if(name==='navigate-document') {const match=session.searchMatches.find(match=>extra.id ? match.id===extra.id : match.index===extra.index && match.start===extra.start);if(match)await navigateSearch(session,match);else goToPage(extra.index+1);}
      else if(name==='search-step') {const index=session.searchMatches.findIndex(match=>match.id===session.activeSearchId),count=session.searchMatches.length;if(count)await navigateSearch(session,session.searchMatches[(index<0?(extra.direction===-1?count-1:0):(index+(extra.direction===-1?-1:1)+count)%count)]);}
      else if(name==='set-thumbnails') {if(session.thumbnailContainer){session.thumbnailContainer.hidden=!extra.visible;scheduleThumbnails(session);}}
      else if(name==='search-document') {if(typeof extra.query==='string' && extra.query.length && extra.query.length<=200)await search(session,extra.query);}
      else if(name==='cancel-search') {session.searchSerial++;session.searchMatches=[];session.activeSearchId=null;paintSearch(session);emit(session,'pdf-search-position',{current:0,total:0});}
      else if(name==='cancel-operations') cancelOperations();
      else if(name==='preview-candidate') {core.validatePdfTarget(extra.target);session.focus=clone(extra.target);goToPage(extra.target.pdf.pages[0]?.pageNumber||1);paintFocus(session);}
      else if(name==='review-candidates') {const token=session.checkSerial,result=await timed(session,reviewCandidates(session,extra.target,token),'候选位置核对');if(token===session.checkSerial)emit(session,'review-candidates',{requestId:extra.requestId,locationToken:extra.locationToken,status:result.status,reason:result.reason,candidates:result.candidates});emit(session,'operation-complete');}
      else if(name==='locate') {
        const token=session.checkSerial;
        const result=await timed(session,resolveTarget(session,extra.target,token),'批注定位');
        if(session.destroyed || session!==current || token!==session.checkSerial)return;
        if(result.target && ['exact','fallback'].includes(result.status)){session.focus=result.target;goToPage(result.target.pdf.pages[0]?.pageNumber||1);paintFocus(session);}
        emit(session,'located',{requestId:extra.requestId,locationToken:extra.locationToken,status:result.status,reason:result.reason});
        emit(session,'operation-complete');
      } else if(name==='check-targets') {
        const token=++session.checkSerial,items=[];
        for(const item of extra.items || []){if(token!==session.checkSerial)return;const result=await timed(session,resolveTarget(session,item.target,token),'批注检查');items.push({id:item.id,revision:item.revision,status:result.status,reason:result.reason});}
        if(token===session.checkSerial)emit(session,'targets-checked',{requestId:extra.requestId,items});
      }
    }catch(error){
      if(name==='search-document' && session.searchSerial===searchSerial)emit(session,'document-search-error',{query:extra.query});
      warning(session,error);emit(session,'operation-complete');
    }
  }
  function cancelOperations(){if(current){current.searchSerial++;current.checkSerial++;emit(current,'operation-complete');}}
  function cancel(){if(importing){const pending=importing;destroy(pending);pending.rejectImport?.(abortError());}cancelOperations();}
  function dispose(){destroy(current);current=null;}
  global.HRPdf=Object.freeze({preview,mount,command,setZoom,goToPage,cancel,cancelOperations,dispose});
  global.addEventListener('pagehide',()=>{cancel();dispose();});
})(window);
