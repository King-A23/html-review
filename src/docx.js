/* DOCX adapter: original bytes stay in core; derived HTML stays in memory. */
(function(global) {
  'use strict';
  const cache = new Map();
  let active = null;
  const css = `html{background:#eef0e9;color:#28372f}body{max-width:860px;margin:32px auto;padding:52px;background:#fffefb;font:16px/1.8 system-ui,sans-serif;overflow-wrap:anywhere}h1,h2,h3,h4{line-height:1.35;color:#24372c}p{margin:0 0 1em}img{max-width:100%;height:auto}table{border-collapse:collapse;width:100%;margin:20px 0}td,th{border:1px solid #dce1d5;padding:10px;vertical-align:top}.docx-table-scroll{overflow-x:auto}a{color:#506b55}.docx-image{display:inline}li{margin:.4em 0}pre{white-space:pre-wrap}span[data-docx-id]{white-space:pre-wrap}@media(max-width:600px){body{margin:12px;padding:24px;font-size:15px}}`;
  function cancel() { if(active) active.cancel(); }
  function convert(bytes) {
    return new Promise((resolve,reject)=> {
      const code = new TextDecoder().decode(global.HRCore.base64ToBytes(document.getElementById('hr-docx-worker').textContent));
      const url = URL.createObjectURL(new Blob([code],{type:'application/javascript'}));
      const worker = new Worker(url);
      let timer;
      const job = {cancel:()=>finish(new Error('已取消 DOCX 转换，当前工作区已保留。'))};
      function finish(error,result) {
        clearTimeout(timer);worker.terminate();URL.revokeObjectURL(url);
        if(active===job) active=null;
        if(error) reject(error);else resolve(result);
      }
      active=job;
      timer=setTimeout(()=>finish(new Error('DOCX 转换超过 30 秒，已中止；当前工作区已保留。')),30000);
      worker.onmessage = e=>finish(e.data.error ? new Error(e.data.error) : null,e.data.result);
      worker.onerror = e=>finish(new Error('DOCX 转换失败：'+e.message));
      worker.postMessage({bytes},[bytes.buffer]);
    });
  }
  function prepare(result,source) {
    const doc=new DOMParser().parseFromString(result.html,'text/html');
    const allowed=new Set('p h1 h2 h3 h4 h5 h6 ul ol li table thead tbody tfoot tr td th strong em b i u s sup sub a img br span'.split(' '));
    for(const node of Array.from(doc.body.querySelectorAll('*'))) {
      if(!allowed.has(node.localName)) { if(['script','style','iframe','object','embed','svg','math','form','input'].includes(node.localName)) node.remove();else node.replaceWith(...node.childNodes);continue; }
      for(const attr of Array.from(node.attributes)) {
        if(!['id','href','src','alt','title','colspan','rowspan','start'].includes(attr.name)) node.removeAttribute(attr.name);
      }
      if(node.hasAttribute('href')) {
        const href=node.getAttribute('href');
        if(!/^(https?:|mailto:|#)/i.test(href)) node.removeAttribute('href');
        else if(!href.startsWith('#')) {node.setAttribute('target','_blank');node.setAttribute('rel','noopener noreferrer');}
      }
      if(node.localName==='img' && !/^data:image\/(png|jpeg|gif|webp|bmp);base64,/i.test(node.getAttribute('src')||'')) {node.replaceWith(doc.createTextNode('[图片未呈现]'));}
    }
    // Make logical line breaks available to the same text stream used by locators.
    for(const br of doc.body.querySelectorAll('br')) br.replaceWith(doc.createTextNode('\n'));
    for(const link of doc.body.querySelectorAll('a[id*="footnote-ref-"],a[id*="endnote-ref-"]')) {
      const label=link.closest('sup') || link;label.setAttribute('data-html-review-owned','note-reference');
    }
    const map={};
    for(const [id,locator] of Object.entries(result.map)) {
      const start=doc.getElementById(result.markerPrefix+id+'_s'),end=doc.getElementById(result.markerPrefix+id+'_e');
      if(!start || !end) continue;
      const range=doc.createRange();range.setStartAfter(start);range.setEndBefore(end);
      const wrapper=doc.createElement('span');wrapper.setAttribute('data-docx-id',id);
      wrapper.append(range.extractContents());range.insertNode(wrapper);start.remove();end.remove();
      if(locator.image) {
        const image=wrapper.querySelector('img');
        if(!image) {wrapper.removeAttribute('data-docx-id');continue;}
        image.setAttribute('data-docx-id',id);wrapper.removeAttribute('data-docx-id');
        image.setAttribute('data-docx-media-hash',locator.image.sha256);
      }
      map[id]=locator;
    }
    // Source paths for table/row/cell targets are derived from explicit paragraph anchors.
    for(const element of doc.body.querySelectorAll('table,tr,td,th')) {
      const kind=element.localName==='table'?'table':element.localName==='tr'?'tr':'td,th';
      const span=Array.from(element.querySelectorAll('span[data-docx-id]')).find(node=>node.closest(kind)===element);
      const anchor=map[span?.getAttribute('data-docx-id')];
      if(!anchor?.table) continue;
      const id='el'+Object.keys(map).length;
      const locator={...anchor,id,path:element.localName==='table'?anchor.table.path:element.localName==='tr'?anchor.table.cellPath.replace(/\/w:tc\[\d+\]$/,''):anchor.table.cellPath};
      delete locator.paraId;
      map[id]=locator;element.setAttribute('data-docx-id',id);
    }
    for(const table of Array.from(doc.body.querySelectorAll('table'))) {
      const wrapper=doc.createElement('div');wrapper.className='docx-table-scroll';table.replaceWith(wrapper);wrapper.append(table);
    }
    doc.documentElement.lang='zh-CN';
    doc.body.setAttribute('data-docx-source-sha256',source.sha256);
    const style=doc.createElement('style');style.textContent=css;doc.head.append(style);
    const meta=doc.createElement('script');meta.type='application/json';meta.setAttribute('data-docx-map','');meta.setAttribute('data-html-review-owned','true');
    meta.textContent=JSON.stringify(map).replace(/</g,'\\u003c');doc.head.append(meta);
    return {html:'<!doctype html>\n'+doc.documentElement.outerHTML,warnings:result.warnings};
  }
  async function preview(data,bridge) {
    const key=data.source.sha256;
    let prepared=cache.get(key);
    if(!prepared) {
      const converted=await convert(global.HRCore.base64ToBytes(data.source.base64));
      prepared=prepare(converted,data.source);cache.clear();cache.set(key,prepared);
    }
    const doc=new DOMParser().parseFromString(prepared.html,'text/html');
    const script=doc.createElement('script');script.setAttribute('data-html-review-owned','true');script.textContent=bridge;doc.head.append(script);
    return {html:'<!doctype html>\n'+doc.documentElement.outerHTML,warnings:prepared.warnings};
  }
  global.HRDocx=Object.freeze({preview,cancel});
  global.addEventListener('pagehide',cancel);
})(window);
