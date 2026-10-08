import mammoth from 'mammoth';
import JSZip from 'jszip';
import {DOMParser, XMLSerializer} from '@xmldom/xmldom';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const MAX = 100 * 1024 * 1024;
const elements = node => Array.from(node.childNodes || []).filter(n => n.nodeType === 1);
const descendants = (node, ns, name) => Array.from(node.getElementsByTagNameNS(ns, name));
function path(node) {
  const pieces = [];
  for (let n = node; n?.nodeType === 1; n = n.parentNode) {
    const siblings = elements(n.parentNode).filter(e => e.namespaceURI === n.namespaceURI && e.localName === n.localName);
    const prefix = n.namespaceURI === W ? 'w' : n.prefix;
    pieces.unshift(`${prefix}:${n.localName}[${siblings.indexOf(n) + 1}]`);
  }
  return '/' + pieces.join('/');
}
function ancestor(node, name) {
  for (let n = node.parentNode; n?.nodeType === 1; n = n.parentNode) if (n.namespaceURI === W && n.localName === name) return n;
  return null;
}
function xml(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('DOCX XML 不支持 DTD 或外部实体。');
  const errors = [];
  const doc = new DOMParser({errorHandler:{warning:m=>errors.push(m),error:m=>errors.push(m),fatalError:m=>errors.push(m)}}).parseFromString(text, 'application/xml');
  if (errors.length || !doc.documentElement) throw new Error('DOCX 内部 XML 损坏。');
  return doc;
}
function mediaPath(part, target) {
  const items = target.startsWith('/') ? [] : part.split('/').slice(0, -1);
  for (const piece of target.split('/')) {
    if (piece === '..') items.pop(); else if (piece && piece !== '.') items.push(piece);
  }
  return items.join('/');
}
async function hash(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b=>b.toString(16).padStart(2,'0')).join('');
}
function checkZipDirectory(bytes) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--) if(view.getUint32(i,true)===0x06054b50 && i+22+view.getUint16(i+20,true)===bytes.length) {end=i;break;}
  if(end<0) throw new Error('DOCX 压缩目录损坏或文件被加密。');
  const count=view.getUint16(end+10,true), directorySize=view.getUint32(end+12,true),offset=view.getUint32(end+16,true);
  if(count>3000 || view.getUint16(end+4,true)!==0 || view.getUint16(end+6,true)!==0 || offset+directorySize>end) throw new Error('DOCX 压缩目录超限或不受支持。');
  let cursor=offset,total=0;const names=new Set();
  for(let i=0;i<count;i++) {
    if(cursor+46>end || view.getUint32(cursor,true)!==0x02014b50) throw new Error('DOCX 压缩目录损坏。');
    if(view.getUint16(cursor+8,true)&1) throw new Error('加密 DOCX 暂不支持，请先提供未加密副本。');
    const size=view.getUint32(cursor+24,true),nameLength=view.getUint16(cursor+28,true),extra=view.getUint16(cursor+30,true),comment=view.getUint16(cursor+32,true);
    const next=cursor+46+nameLength+extra+comment;
    if(next>end) throw new Error('DOCX 压缩目录损坏。');
    const name=new TextDecoder().decode(bytes.subarray(cursor+46,cursor+46+nameLength));
    if(names.has(name) || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) throw new Error('DOCX 内部路径重复或不安全。');
    names.add(name);total+=size;
    if(total>MAX) throw new Error('DOCX 解压后超过 100 MiB 限制。');
    cursor=next;
  }
  if(cursor!==offset+directorySize) throw new Error('DOCX 压缩目录损坏。');
}
function boundedEntry(item, remaining) {
  return new Promise((resolve,reject)=> {
    const chunks=[];let size=0,settled=false;
    const reader=item.internalStream('uint8array');
    reader.on('data',chunk=> {
      if(settled) return;
      size+=chunk.length;
      if(size>remaining) {settled=true;reader.pause();reject(new Error('DOCX 解压后超过 100 MiB 限制。'));return;}
      chunks.push(chunk);
    });
    reader.on('error',error=>{if(!settled) {settled=true;reject(error);}});
    reader.on('end',()=> {
      if(settled) return;
      settled=true;const raw=new Uint8Array(size);let offset=0;
      for(const chunk of chunks) {raw.set(chunk,offset);offset+=chunk.length;}
      resolve(raw);
    });
    reader.resume();
  });
}
export async function convertDocx(bytes) {
  if (bytes.byteLength > 20 * 1024 * 1024) throw new Error('DOCX 文件超过 20 MiB 限制。');
  checkZipDirectory(bytes);
  let zip;
  try { zip = await JSZip.loadAsync(bytes); } catch (_) { throw new Error('无法打开 DOCX：文件损坏、被加密或不是有效的 DOCX。'); }
  const entries = Object.values(zip.files);
  if (entries.length > 3000) throw new Error('DOCX 内部文件超过 3000 项限制。');
  let declared = 0, actual = 0;
  for (const item of entries) {
    if (item.dir) continue;
    declared += item._data?.uncompressedSize || 0;
    if (declared > MAX) throw new Error('DOCX 解压后超过 100 MiB 限制。');
  }
  for (const item of entries) {
    if (item.dir) continue;
    const raw = await boundedEntry(item,MAX-actual); actual += raw.length;
    if (actual > MAX) throw new Error('DOCX 解压后超过 100 MiB 限制。');
    zip.file(item.name, raw);
  }
  if (!zip.file('[Content_Types].xml') || !zip.file('word/document.xml')) throw new Error('请选择 .docx 文档；此文件没有有效的 Word 文档结构。');
  const map = {}, warnings = ['DOCX 为内容预览，不还原 Word 字体、页码和完整排版。'];
  let counter = 0;
  const markerPrefix = 'hrdx_' + (await hash(bytes)).slice(0, 12) + '_';
  function mark(doc, node, locator, image = false) {
    const id = 'dx' + (++counter);
    map[id] = {id, ...locator};
    const start = doc.createElementNS(W, 'w:bookmarkStart');
    start.setAttributeNS(W,'w:name',markerPrefix+id+'_s'); start.setAttributeNS(W,'w:id',String(100000000+counter*2));
    const end = doc.createElementNS(W,'w:bookmarkStart');
    end.setAttributeNS(W,'w:name',markerPrefix+id+'_e'); end.setAttributeNS(W,'w:id',String(100000001+counter*2));
    if (image) { node.parentNode.insertBefore(start,node); node.parentNode.insertBefore(end,node.nextSibling); }
    else { const first = elements(node).find(n=>!(n.namespaceURI===W && n.localName==='pPr')); node.insertBefore(start, first || null); node.appendChild(end); }
  }
  for (const part of ['word/document.xml','word/footnotes.xml','word/endnotes.xml']) {
    if (!zip.file(part)) continue;
    const doc = xml(await zip.file(part).async('string'));
    const relationships = {};
    const relPath = part.replace(/\/([^/]+)$/, '/_rels/$1.rels');
    if (zip.file(relPath)) {
      const relDoc = xml(await zip.file(relPath).async('string'));
      for (const rel of elements(relDoc.documentElement)) relationships[rel.getAttribute('Id')] = rel;
    }
    for (const paragraph of descendants(doc, W, 'p')) {
      if (ancestor(paragraph,'del')) continue;
      for(const carriage of descendants(paragraph,W,'cr')) {
        const lineBreak=doc.createElementNS(W,'w:br');carriage.parentNode.replaceChild(lineBreak,carriage);
      }
      if(descendants(paragraph,W,'sym').length) {warnings.push('含特殊符号字体的段落可预览，暂不提供精确文字定位；请使用整体意见。');continue;}
      const locator = {part,path:path(paragraph)};
      if(!/^\/(?:w:\w+\[\d+\])(?:\/w:\w+\[\d+\])*$/.test(locator.path)) {warnings.push('文本框等复杂容器仅供预览，无法准确定位的内容请使用整体意见。');continue;}
      const paraId = paragraph.getAttributeNS('http://schemas.microsoft.com/office/word/2010/wordml','paraId');
      if (paraId) locator.paraId = paraId;
      const cell = ancestor(paragraph,'tc'), row = cell && ancestor(cell,'tr'), table = row && ancestor(row,'tbl');
      if (table) locator.table = {path:path(table),row:elements(table).filter(e=>e.localName==='tr').indexOf(row)+1,column:elements(row).filter(e=>e.localName==='tc').indexOf(cell)+1,cellPath:path(cell)};
      // Record original structural paths before inserting any synthetic nodes.
      const drawings = descendants(paragraph,W,'drawing').filter(n=>ancestor(n,'p')===paragraph);
      const pictures = descendants(paragraph,W,'pict').filter(n=>ancestor(n,'p')===paragraph);
      const images = [];
      for (const drawing of [...drawings,...pictures]) {
        const blip = descendants(drawing,A,'blip')[0];
        const legacy = descendants(drawing,'urn:schemas-microsoft-com:vml','imagedata')[0];
        const relationshipId = blip?.getAttributeNS(R,'embed') || legacy?.getAttributeNS(R,'id');
        const rel = relationships[relationshipId];
        if (!rel || rel.getAttribute('TargetMode')==='External') { warnings.push('部分外部图片或复杂图形未呈现；请结合原始 DOCX 核对。'); continue; }
        const filePath = mediaPath(part, rel.getAttribute('Target'));
        const media = zip.file(filePath);
        if (!media) { warnings.push('DOCX 中存在缺失的图片资源。'); continue; }
        const imageLocator={...locator,path:path(drawing),image:{relationshipId,mediaPath:filePath,sha256:await hash(await media.async('uint8array'))}};
        delete imageLocator.paraId;
        images.push({node:drawing,locator:imageLocator});
      }
      mark(doc,paragraph,locator);
      for (const image of images) mark(doc,image.node,image.locator,true);
    }
    if (descendants(doc,W,'commentRangeStart').length) warnings.push('原生 Word 批注不转为本工具的任务。');
    if (descendants(doc,W,'ins').length || descendants(doc,W,'del').length) warnings.push('修订以当前正文内容预览；源文件修订记录保持不变。');
    if (descendants(doc,'http://schemas.openxmlformats.org/drawingml/2006/chart','chart').length || descendants(doc,W,'object').length) warnings.push('图表、嵌入对象等复杂内容可能无法完整呈现。');
    zip.file(part,new XMLSerializer().serializeToString(doc));
  }
  if (entries.some(e=>/^word\/(header|footer)\d*\.xml$/.test(e.name))) warnings.push('内容预览不呈现页眉页脚。');
  const transformed = await zip.generateAsync({type:'arraybuffer'});
  const result = await mammoth.convertToHtml({arrayBuffer:transformed},{externalFileAccess:false,includeEmbeddedStyleMap:false,ignoreEmptyParagraphs:false,
    styleMap:['p.Title => h1:fresh', 'p.Subtitle => p:fresh', 'p.Caption => p:fresh']});
  for (const message of result.messages) warnings.push('DOCX 转换提示：'+message.message);
  return {html:result.value,map,markerPrefix,warnings:[...new Set(warnings)]};
}
if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof window === 'undefined') {
  self.onmessage = async event => {
    try { self.postMessage({result:await convertDocx(event.data.bytes)}); }
    catch (error) { self.postMessage({error:error.message || String(error)}); }
  };
}
