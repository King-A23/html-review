/* Independent fixture validation: pypdf geometry/text and Poppler rasterization. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fixturePython,writePdfFixture,inspectPdfFixture,popplerCommand,PDF_PASSWORD,PDF_VARIANTS} from './pdf-fixtures.mjs';
const execute=promisify(execFile);
test('PDF stress corpus is deterministic and independently validates text, geometry, media and revisions',async t=>{
  if (!await fixturePython()) return t.skip('Optional fixture tooling requires reportlab, pypdf, Pillow and a Chinese TrueType font.');
  const directory=await mkdtemp(path.join(tmpdir(),'html-review-pdf-validation-'));
  try {
    const files={}, inspections={};
    for (const variant of PDF_VARIANTS) {
      files[variant]=path.join(directory,`${variant}.pdf`);
      await writePdfFixture(files[variant],variant);
      if (!['corrupt','oversized'].includes(variant)) {
        inspections[variant]=await inspectPdfFixture(files[variant]);
        assert.equal(new Set(inspections[variant].pages.map(page=>page.objectId)).size,inspections[variant].pageCount,`${variant}: every page has a distinct page-tree object`);
      }
      const repeat=path.join(directory,'repeat.pdf');
      await writePdfFixture(repeat,variant);
      assert.deepEqual(await readFile(repeat),await readFile(files[variant]),`${variant}: repeatable bytes`);
    }
    const base=inspections.base;
    assert.equal(base.pageCount,5);
    assert.match(base.pages[0].text,/中英混排/);
    assert.equal(base.pages[0].text.match(/Repeated sentence/g).length,2);
    assert.match(base.pages[0].text,/Bold.*Italic.*Purple/s);
    assert.match(base.pages[1].text,/LEFT column line 15/);
    assert.match(base.pages[1].text,/RIGHT column line 15/);
    assert.match(base.pages[2].text,/Revenue/);
    assert.equal(base.pages[2].images,1);
    assert.equal(base.pages[3].images,1);
    assert.equal(base.pages[3].text,'','Scan page intentionally has no extractable text.');
    assert.deepEqual(base.pages[2].mediaBox,[0,0,792,612]);
    assert.deepEqual(base.pages[4].cropBox,[40,60,600,780]);
    assert.equal(base.pages[4].rotation,90);
    assert.deepEqual(base.fields,['reviewer']);
    const annotations=base.pages[0].annotations;
    assert(annotations.some(a=>a.uri.startsWith('https://')));
    assert(annotations.some(a=>a.destination));
    assert(annotations.some(a=>a.uri.startsWith('javascript:')));
    assert(annotations.some(a=>a.uri.startsWith('file:')));
    assert(annotations.some(a=>a.subtype==='/Widget'));
    assert(annotations.some(a=>a.subtype==='/Text'));
    assert.equal(inspections.inserted.pageCount,6);
    assert.equal(inspections.inserted.pages[1].text,'');
    assert.deepEqual(inspections.inserted.pages[1].mediaBox,[0,0,400,500]);
    assert.equal(inspections.inserted.pages[2].text,base.pages[1].text);
    assert.equal(inspections.moved.pages[1].text,base.pages[2].text);
    assert.equal(inspections.moved.pages[2].text,base.pages[1].text);
    assert.equal(inspections.duplicated.pageCount,6);
    assert.equal(inspections.duplicated.pages[1].text,inspections.duplicated.pages[2].text);
    assert.doesNotMatch(inspections['deleted-text'].pages[0].text,/Delete this sentence/);
    assert.match(inspections.changed.pages[0].text,/UPDATED 2027/);
    assert.equal(inspections['chart-replacement'].pages[2].text,base.pages[2].text,'Vector revision changes graphics only.');
    assert.equal(inspections['scan-change'].pages[3].text,'','Scan revision changes pixels only.');
    assert.equal(inspections.encrypted.encrypted,true);
    assert.equal(inspections.encrypted.pages[0].text,base.pages[0].text);
    assert.equal(inspections['page-limit'].pageCount,1001);
    assert.equal((await stat(files.oversized)).size,64*1024*1024);
    await assert.rejects(inspectPdfFixture(files.corrupt));
    const python=await fixturePython();
    const {stdout}=await execute(python,['-c','from pypdf import PdfReader; import sys; r=PdfReader(sys.argv[1]); print(int(r.decrypt("wrong-password")))',files.encrypted]);
    assert.equal(stdout.trim(),'0','Wrong password must fail.');
    if (process.env.PDF_FIXTURE_RENDER!=='1') {t.diagnostic('Set PDF_FIXTURE_RENDER=1 for independent Poppler raster verification.');return;}
    const rasterizer=await popplerCommand('pdftoppm');
    if (!rasterizer) {t.diagnostic('Poppler missing: raster validation skipped; structural validation passed.');return;}
    const rendered=new Map();
    const render=async(variant,page)=>{
      const key=`${variant}:${page}`;
      if(rendered.has(key)) return rendered.get(key);
      const prefix=path.join(directory,`${variant}-${page}`);
      await execute(rasterizer,['-upw',PDF_PASSWORD,'-f',String(page),'-l',String(page),'-scale-to','640','-singlefile','-png',files[variant],prefix],{timeout:30000});
      const bytes=await readFile(`${prefix}.png`);
      assert.deepEqual(bytes.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));
      assert(bytes.readUInt32BE(16)>0&&bytes.readUInt32BE(20)>0);
      rendered.set(key,bytes);
      return bytes;
    };
    for(let page=1;page<=5;page++) await render('base',page);
    assert.notDeepEqual(await render('base',3),await render('chart-replacement',3),'Vector chart replacement changes rendered pixels.');
    assert.notDeepEqual(await render('base',4),await render('scan-change',4),'Scan replacement changes rendered pixels.');
    assert.deepEqual(await render('base',1),await render('encrypted',1),'Encrypted rendering matches original.');
  } finally {await rm(directory,{recursive:true,force:true});}
});
