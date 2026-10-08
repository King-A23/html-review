(function () {
  'use strict';
  let activeType = 'html';
  const sourceType = data => data?.source?.type || 'html';
  window.HRAdapters = {
    sourceType,
    capabilities(data) { const type=sourceType(data); return {pages:type!=='docx',search:type==='docx'||type==='pdf',region:type==='pdf'}; },
    preview(data, bridge) {
      const type=sourceType(data);
      return type==='pdf' ? window.HRPdf.preview(data) : type==='docx' ? window.HRDocx.preview(data,bridge) : window.HRCore.createPreview(data,bridge);
    },
    async mount(prepared, container, emit) {
      if(activeType==='pdf') window.HRPdf.dispose();
      activeType=prepared.pdf ? 'pdf' : 'html';
      return prepared.pdf ? window.HRPdf.mount(prepared,container,emit) : Promise.resolve();
    },
    command(command,extra,iframe,channel) {
      if(activeType==='pdf') { if(command==='cancel-operations') return window.HRPdf.cancelOperations(); return window.HRPdf.command(command,extra); }
      if(iframe.contentWindow&&channel) iframe.contentWindow.postMessage({hr:true,channel,command,...extra},'*');
    },
    cancel() { window.HRDocx?.cancel(); window.HRPdf?.cancel(); },
    dispose() { if(activeType==='pdf') window.HRPdf?.dispose(); activeType='html'; }
  };
})();
