/** Deterministic OOXML stress fixtures. No office installation or network required. */
import JSZip from 'jszip';
import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const pngRed = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
const pngBlue = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const run = (s, props = '') => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(s)}</w:t></w:r>`;
const p = (s, props = '') => `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${run(s)}</w:p>`;
const cell = (s, props = '') => `<w:tc><w:tcPr>${props}</w:tcPr>${p(s)}</w:tc>`;
const drawing = (id, rid) => `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="457200"/><wp:docPr id="${id}" name="Figure ${id}" descr="Embedded figure ${id}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="Figure ${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
const table = `<w:tbl><w:tblPr><w:tblW w:w="8000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid><w:tr>${cell('合并表头 Merged heading', '<w:gridSpan w:val="2"/>')}</w:tr><w:tr>${cell('纵向合并 Vertical', '<w:vMerge w:val="restart"/>')}${cell('右侧单元格 Right cell')}</w:tr><w:tr>${cell('', '<w:vMerge/>')}<w:tc><w:tcPr/>${p('外层单元格 Outer cell')}<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr>${cell('嵌套表格 Nested table')}</w:tr></w:tbl>${p('')}</w:tc></w:tr></w:tbl>`;
/** variant: base | changed | inserted | moved-table | deleted | replacement-image | invalid */
export async function createDocxFixture(variant = 'base') {
  if (variant === 'invalid') return Buffer.from('not an OOXML ZIP');
  if (!['base','changed','inserted','moved-table','deleted','replacement-image'].includes(variant)) throw new Error(`Unknown DOCX fixture variant: ${variant}`);
  const changed = variant === 'changed';
  const blocks = [
    p('DOCX 审阅测试 Review fixture', '<w:pStyle w:val="Title"/>'),
    p('正文与定位 Body and locators', '<w:pStyle w:val="Heading1"/>'),
    `<w:p>${run('中英混排 Chinese and English ')}${run('bold', '<w:b/>')}${run(' italic', '<w:i/>')}${run(' underline', '<w:u w:val="single"/>')}${run(' strike', '<w:strike/>')}${run(' color', '<w:color w:val="A020F0"/>')}${run(' superscript', '<w:vertAlign w:val="superscript"/>')}</w:p>`,
    p('重复段落 Duplicate paragraph'), p('重复段落 Duplicate paragraph'),
    p('需要删除的段落 Delete this paragraph'),
    p('第一项 Numbered item one', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'),
    p('第二项 Numbered item two', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'),
    p('项目符号 Bullet item', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>'),
    table, drawing(1, 'rIdImage1'), drawing(2, 'rIdImage2'), drawing(3, 'rIdExternal').replace('r:embed=', 'r:link='),
    `<w:p>${run('脚注与尾注 Notes')}<w:r><w:footnoteReference w:id="1"/></w:r><w:r><w:endnoteReference w:id="1"/></w:r></w:p>`,
    `<w:p><w:hyperlink r:id="rIdUnsafe">${run('危险链接 Unsafe link')}</w:hyperlink></w:p>`,
    `<w:p><w:commentRangeStart w:id="0"/>${run('带原生批注 Native comment')}<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>`,
    `<w:p>${run('修订 Revisions ')}<w:del w:id="4" w:author="Reviewer" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>已删除的修订 Deleted revision</w:delText></w:r></w:del><w:ins w:id="5" w:author="Reviewer" w:date="2026-01-01T00:00:00Z">${run('新增的修订 Inserted revision')}</w:ins></w:p>`,
    `<w:p><w:r><w:br w:type="page"/></w:r>${run('显式分页 Explicit page break')}</w:p>`,
    `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="457200"/><wp:docPr id="9" name="Unsupported chart"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rIdChart"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
  ];
  if (changed || variant === 'deleted') blocks.splice(blocks.findIndex(b => b.includes('需要删除的段落')), 1);
  if (changed || variant === 'inserted') blocks.splice(2, 0, p('插入的新段落 Inserted paragraph'));
  if (changed || variant === 'moved-table') { blocks.splice(blocks.indexOf(table), 1); blocks.splice(2, 0, table); }
  const zip = new JSZip(); const fixedDate = new Date('2026-01-01T00:00:00Z');
  const put = (name, body) => zip.file(name, body, {date: fixedDate});
  const xml = body => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`;
  const rels = entries => xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries.map(([id,type,target,external]) => `<Relationship Id="${id}" Type="${REL}${type}" Target="${esc(target)}"${external ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`);
  put('_rels/.rels', rels([['rId1','officeDocument','word/document.xml']]));
  put('word/document.xml', xml(`<w:document xmlns:w="${NS}" xmlns:r="${REL.slice(0,-1)}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><w:body>${blocks.join('')}<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1200" w:right="1200" w:bottom="1200" w:left="1200"/></w:sectPr></w:body></w:document>`));
  put('word/_rels/document.xml.rels', rels([['rIdStyles','styles','styles.xml'],['rIdNumbers','numbering','numbering.xml'],['rIdImage1','image','media/image1.png'],['rIdImage2','image','media/image2.png'],['rIdFootnotes','footnotes','footnotes.xml'],['rIdEndnotes','endnotes','endnotes.xml'],['rIdComments','comments','comments.xml'],['rIdUnsafe','hyperlink','javascript:window.__DOCX_UNSAFE__=true',true],['rIdExternal','image','https://docx-network.invalid/remote.png',true],['rIdHeader','header','header1.xml'],['rIdChart','chart','charts/chart1.xml']]));
  put('word/styles.xml', xml(`<w:styles xmlns:w="${NS}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/></w:rPr></w:style></w:styles>`));
  put('word/numbering.xml', xml(`<w:numbering xmlns:w="${NS}">${[1,2].map(id => `<w:abstractNum w:abstractNumId="${id}"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${id === 1 ? 'decimal' : 'bullet'}"/><w:lvlText w:val="${id === 1 ? '%1.' : '•'}"/></w:lvl></w:abstractNum>`).join('')}${[1,2].map(id=>`<w:num w:numId="${id}"><w:abstractNumId w:val="${id}"/></w:num>`).join('')}</w:numbering>`));
  for (const [part, singular, text] of [['footnotes','footnote','脚注内容 Footnote content'],['endnotes','endnote','尾注内容 Endnote content'],['comments','comment','原生批注内容 Native comment content']]) put(`word/${part}.xml`, xml(`<w:${part} xmlns:w="${NS}"><w:${singular} w:id="${part === 'comments' ? 0 : 1}"${part==='comments' ? ' w:author="Fixture"' : ''}>${p(text)}</w:${singular}></w:${part}>`));
  put('word/header1.xml', xml(`<w:hdr xmlns:w="${NS}">${p('页眉 Header content')}</w:hdr>`));
  put('word/charts/chart1.xml', xml('<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:pieChart><c:varyColors val="1"/><c:ser><c:idx val="0"/><c:order val="0"/><c:cat><c:strLit><c:ptCount val="2"/><c:pt idx="0"><c:v>业务甲</c:v></c:pt><c:pt idx="1"><c:v>业务乙</c:v></c:pt></c:strLit></c:cat><c:val><c:numLit><c:formatCode>General</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>60</c:v></c:pt><c:pt idx="1"><c:v>40</c:v></c:pt></c:numLit></c:val></c:ser><c:firstSliceAng val="0"/></c:pieChart></c:plotArea></c:chart></c:chartSpace>'));
  put('word/media/image1.png', Buffer.from(changed || variant === 'replacement-image' ? pngBlue : pngRed, 'base64'));
  put('word/media/image2.png', Buffer.from(pngBlue, 'base64'));
  const overrides = {document:'document.main',styles:'styles',numbering:'numbering',footnotes:'footnotes',endnotes:'endnotes',comments:'comments',header1:'header'};
  put('[Content_Types].xml', xml(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>${Object.entries(overrides).map(([name,type]) => `<Override PartName="/word/${name}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${type}+xml"/>`).join('')}<Override PartName="/word/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>`));
  return zip.generateAsync({type:'nodebuffer', compression:'DEFLATE'});
}
export const docxFixture = createDocxFixture;
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = process.argv[2]; if (!target) throw new Error('Usage: node tests/docx-fixtures.mjs OUTPUT.docx [variant]');
  await writeFile(target, await createDocxFixture(process.argv[3] || 'base'));
}
