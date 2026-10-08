/* Fixture validity checks independent of the permissive browser DOCX converter. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import JSZip from 'jszip';
import {DOMParser} from '@xmldom/xmldom';
import {createDocxFixture} from './docx-fixtures.mjs';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const C='http://schemas.openxmlformats.org/drawingml/2006/chart';
const variants=['base','changed','inserted','moved-table','deleted','replacement-image'];
const children=node=>Array.from(node.childNodes).filter(n=>n.nodeType===1);
function xml(text) {
  const errors=[];
  const document=new DOMParser({errorHandler:{warning:m=>errors.push(m),error:m=>errors.push(m),fatalError:m=>errors.push(m)}}).parseFromString(text,'application/xml');
  assert.deepEqual(errors,[]);return document;
}
function crc32(bytes) {
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}
function validatePNG(bytes,name) {
  assert.deepEqual(bytes.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]),`${name}: PNG signature`);
  let offset=8;const types=[];const compressed=[];let header;
  while(offset<bytes.length){
    assert(offset+12<=bytes.length,`${name}: complete chunk header`);
    const length=bytes.readUInt32BE(offset);assert(offset+12+length<=bytes.length,`${name}: complete chunk data`);
    const type=bytes.toString('ascii',offset+4,offset+8);const data=bytes.subarray(offset+8,offset+8+length);
    assert.equal(bytes.readUInt32BE(offset+8+length),crc32(bytes.subarray(offset+4,offset+8+length)),`${name}: ${type} CRC`);
    types.push(type);if(type==='IHDR')header=data;if(type==='IDAT')compressed.push(data);
    offset+=12+length;
  }
  assert.equal(types[0],'IHDR');assert.equal(types.at(-1),'IEND');assert.equal(types.filter(t=>t==='IHDR').length,1);assert.equal(types.filter(t=>t==='IEND').length,1);
  assert(header&&header.length===13);assert(compressed.length>0,`${name}: IDAT required`);
  const raw=inflateSync(Buffer.concat(compressed));
  const width=header.readUInt32BE(0),height=header.readUInt32BE(4),depth=header[8],colorType=header[9];
  assert(width>0&&height>0);assert.equal(header[10],0);assert.equal(header[11],0);assert.equal(header[12],0,'Fixture PNG must be noninterlaced');
  const channels={0:1,2:3,3:1,4:2,6:4}[colorType];assert(channels,`${name}: valid PNG color type`);
  const stride=Math.ceil(width*channels*depth/8)+1;assert.equal(raw.length,height*stride,`${name}: exact uncompressed scanline size`);
  for(let row=0;row<height;row++)assert(raw[row*stride]<=4,`${name}: valid PNG scanline filter`);
}
for(const variant of variants)test(`DOCX ${variant} fixture has valid binary media and core OOXML structures`,async()=>{
  const bytes=await createDocxFixture(variant);assert.deepEqual(bytes,await createDocxFixture(variant),'Deterministic fixture generation');
  const zip=await JSZip.loadAsync(bytes,{checkCRC32:true});
  const images=Object.values(zip.files).filter(file=>!file.dir&&file.name.endsWith('.png'));assert.equal(images.length,2);
  for(const file of images)validatePNG(await file.async('nodebuffer'),file.name);
  for(const file of Object.values(zip.files).filter(file=>!file.dir&&/\.(xml|rels)$/.test(file.name)))xml(await file.async('string'));
  const numbering=xml(await zip.file('word/numbering.xml').async('string'));
  const order={numPicBullet:0,abstractNum:1,num:2,numIdMacAtCleanup:3};let previous=-1;const abstractIds=new Set(), references=[];
  for(const node of children(numbering.documentElement)){
    assert.equal(node.namespaceURI,W);const rank=order[node.localName];assert.notEqual(rank,undefined);assert(rank>=previous,'CT_Numbering requires all abstractNum definitions before all num instances');previous=rank;
    if(node.localName==='abstractNum')abstractIds.add(node.getAttributeNS(W,'abstractNumId'));
    if(node.localName==='num')references.push(node.getElementsByTagNameNS(W,'abstractNumId')[0]?.getAttributeNS(W,'val'));
  }
  assert.equal(abstractIds.size,2);assert.equal(references.length,2);assert(references.every(id=>abstractIds.has(id)));
  for(const [part,singular]of[['footnotes','footnote'],['endnotes','endnote']]){
    const document=xml(await zip.file(`word/${part}.xml`).async('string'));const notes=Array.from(document.getElementsByTagNameNS(W,singular));assert(notes.length>0);
    for(const note of notes){
      assert(note.hasAttributeNS(W,'id'));
      for(const attribute of Array.from(note.attributes).filter(a=>a.namespaceURI!=='http://www.w3.org/2000/xmlns/'))assert(attribute.namespaceURI===W&&['id','type'].includes(attribute.localName),`${part}: CT_FtnEdn permits w:id and w:type, not ${attribute.name}`);
    }
  }
  const chart=xml(await zip.file('word/charts/chart1.xml').async('string'));
  const plotAreas=Array.from(chart.getElementsByTagNameNS(C,'plotArea'));assert.equal(plotAreas.length,1);
  const chartTypes=new Set(['areaChart','area3DChart','lineChart','line3DChart','stockChart','radarChart','scatterChart','pieChart','pie3DChart','doughnutChart','barChart','bar3DChart','ofPieChart','surfaceChart','surface3DChart','bubbleChart']);
  const plots=children(plotAreas[0]).filter(node=>node.namespaceURI===C&&chartTypes.has(node.localName));assert(plots.length>=1,'CT_PlotArea requires at least one chart child');
});
