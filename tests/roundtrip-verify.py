#!/usr/bin/env python3
"""Independent read-only verification of the real DOCX review roundtrip.

Uses only the original, exported package, returned DOCX and review JSON.
Writes a verification report, never mutates its inputs or product sources.
"""
from pathlib import Path
from zipfile import ZipFile
from io import BytesIO
from copy import deepcopy
import argparse
import hashlib
import json
from lxml import etree
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
NS = {'w': W, 'wp': 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', 'a': 'http://schemas.openxmlformats.org/drawingml/2006/main'}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--directory', type=Path, default=ROOT/'output/iteration-review')
    args = ap.parse_args()
    base = args.directory.resolve()
    original = base/'澄川经营报告.docx'
    returned = base/'agent-return/original/澄川经营报告.docx'
    annotations = base/'original.review.json'
    results = base/'agent-return/original/澄川经营报告.review-results.json'
    exported = base/'真实修改交接包.zip'
    output = base/'independent-edit-verification.json'
    checks = []
    def check(name, condition, detail=None):
        row = {'name':name, 'passed':bool(condition)}
        if detail is not None: row['detail'] = detail
        checks.append(row)
    def text(el): return ''.join(el.xpath('.//w:t/text()', namespaces=NS))
    def serial(el): return etree.tostring(el, method='c14n', exclusive=True)
    oa = original.read_bytes(); rb = returned.read_bytes()
    srcsha = hashlib.sha256(oa).hexdigest()
    task = json.loads(annotations.read_text())
    result = json.loads(results.read_text())
    with ZipFile(exported) as z:
        export_source = z.read('original/澄川经营报告.docx')
        export_task = json.loads(z.read('review/annotations.json'))
    check('original_sha_matches_task', srcsha == task['source']['sha256'], srcsha)
    check('original_docx_export_is_byte_identical', export_source == oa)
    check('review_json_export_is_identical', export_task == task)
    anns = task['annotations']; rs = result['results']
    check('five_unique_annotation_and_result_ids', len(anns)==len(rs)==5 and len({r['id'] for r in rs})==5 and {a['id'] for a in anns}=={r['id'] for r in rs})
    guards = []
    for ann in anns:
        matches = [r for r in rs if r['id']==ann['id']]
        guards.append(bool(matches) and matches[0]['revision']==ann['revision'] and matches[0]['annotationUpdatedAt']==ann['updatedAt'] and ann['target']['docx']['sourceSha256']==srcsha)
    check('all_result_revision_and_updated_at_guards_match', all(guards))
    check('result_format_and_statuses', result['format']=='html-review-results' and result['schemaVersion']==1 and [r['status'] for r in rs]==['resolved']*4+['open'])
    check('open_caption_result_reports_missing_brand_material', '品牌规范' in rs[-1]['summary'] and '保留' in rs[-1]['summary'])
    with ZipFile(BytesIO(oa)) as z: old={n:z.read(n) for n in z.namelist()}; oldcrc=z.testzip()
    with ZipFile(BytesIO(rb)) as z: new={n:z.read(n) for n in z.namelist()}; newcrc=z.testzip()
    check('both_docx_zip_crcs_valid', oldcrc is None and newcrc is None)
    check('docx_package_entry_sets_unchanged', old.keys()==new.keys())
    changed = [n for n in old if old[n]!=new.get(n)]
    check('only_document_and_image_parts_changed', set(changed)=={'word/document.xml','word/media/image1.png'}, changed)
    for data in (old,new):
        for n,v in data.items():
            if n.endswith(('.xml','.rels')): etree.fromstring(v)
    check('all_package_xml_parts_parse', True)
    a=etree.fromstring(old['word/document.xml']); b=etree.fromstring(new['word/document.xml'])
    original_summary = next(p for p in a.xpath('//w:body/w:p',namespaces=NS) if text(p).startswith('2026年前三季度，公司'))
    returned_summary = next(p for p in b.xpath('//w:body/w:p',namespaces=NS) if text(p).startswith('2026年前三季度，公司'))
    st = text(returned_summary)
    expected_summary = '2026年前三季度，公司累计实现营业收入8.1亿元，同比增长20%。经营活动现金流净额为0.90亿元，客户回款节奏改善。'
    check('summary_is_exactly_two_sentences_with_three_required_figures', st==expected_summary and st.count('。')==2, st)
    bold=[]
    for run in returned_summary.xpath('./w:r',namespaces=NS):
        tags=run.xpath('./w:rPr/w:b',namespaces=NS)
        if tags and tags[0].get('{'+W+'}val') not in ('0','false','off'): bold.append(text(run))
    check('exactly_three_required_figures_remain_bold', bold==['8.1亿元','20%','0.90亿元'],bold)
    check('summary_paragraph_style_preserved', serial(original_summary.find('{'+W+'}pPr'))==serial(returned_summary.find('{'+W+'}pPr')))
    old_temp=[p for p in a.xpath('//w:body/w:p',namespaces=NS) if text(p).startswith('免责声明 临时重复无效文字')]
    new_temp=[p for p in b.xpath('//w:body/w:p',namespaces=NS) if text(p).startswith('免责声明 临时重复无效文字')]
    check('only_one_temporary_paragraph_deleted', len(old_temp)==1 and len(new_temp)==0 and len(a.xpath('//w:body/w:p',namespaces=NS))-len(b.xpath('//w:body/w:p',namespaces=NS))==1)
    oldtable=a.xpath('//w:tbl',namespaces=NS)[0]; newtable=b.xpath('//w:tbl',namespaces=NS)[0]
    table_expected=deepcopy(oldtable)
    for t in table_expected.xpath('.//w:t',namespaces=NS):
        if t.text in ('营业收入','净利润'): t.text += '（亿元）'
    check('table_only_two_headers_changed_all_values_merges_styles_preserved', serial(table_expected)==serial(newtable))
    check('quarterly_amounts_and_totals_correct', [text(r) for r in newtable.xpath('./w:tr',namespaces=NS)[2:]]==['Q12.400.2410%','Q22.700.2710%','Q33.000.3010%','前三季度合计8.100.8110%'])
    oldim=Image.open(BytesIO(old['word/media/image1.png'])).convert('RGB'); newim=Image.open(BytesIO(new['word/media/image1.png'])).convert('RGB')
    check('image_dimensions_preserved', oldim.size==newim.size==(1440,760),list(newim.size))
    source_color=(0x17,0x8c,0x92); target_color=(0x50,0x66,0x3e)
    count=0; unexpected=0
    for x,y in zip(oldim.get_flattened_data(),newim.get_flattened_data()):
        expected = target_color if x==source_color else x
        if x==source_color: count+=1
        if y!=expected: unexpected+=1
    check('all_and_only_blue_green_pixels_replaced_with_olive', count>0 and unexpected==0,{'changed_color_pixels':count,'unexpected_pixels':unexpected,'from':'#178C92','to':'#50663E'})
    def extents(el): return [dict(x.attrib) for x in el.xpath('//wp:extent|//a:ext',namespaces=NS)]
    check('drawing_emu_sizes_preserved', extents(a)==extents(b),extents(b))
    check('duplicate_phrase_still_occurs_twice', text(a).count('现金回收仍需持续关注。')==text(b).count('现金回收仍需持续关注。')==2)
    def caption(el): return next(p for p in el.xpath('//w:body/w:p',namespaces=NS) if text(p)=='图 1 2026年前三季度营业收入')
    check('caption_text_style_and_structure_unchanged', serial(caption(a))==serial(caption(b)))
    check('footnotes_byte_identical', old['word/footnotes.xml']==new['word/footnotes.xml'])
    # Build the exact permitted XML transformation from the original. Whole-root
    # comparison also protects numbering, section settings, drawing metadata,
    # footnote references and every non-target paragraph and run property.
    expected=deepcopy(a)
    es=next(p for p in expected.xpath('//w:body/w:p',namespaces=NS) if text(p).startswith('2026年前三季度，公司'))
    runs=es.xpath('./w:r',namespaces=NS)
    for r in runs[7:]: es.remove(r)
    fifth=runs[4].find('{'+W+'}t'); fifth.text=fifth.text.replace('；','。',1)
    et=next(p for p in expected.xpath('//w:body/w:p',namespaces=NS) if text(p).startswith('免责声明 临时重复无效文字'))
    et.getparent().remove(et)
    for t in expected.xpath('//w:tbl//w:t',namespaces=NS):
        if t.text in ('营业收入','净利润'): t.text += '（亿元）'
    check('entire_document_xml_matches_only_permitted_transformation', serial(expected)==serial(b))
    old_other=[etree.tostring(p) for p in a.xpath('//w:body/w:p',namespaces=NS) if p is not original_summary and p not in old_temp]
    new_other=[etree.tostring(p) for p in b.xpath('//w:body/w:p',namespaces=NS) if p is not returned_summary]
    check('all_non_target_body_paragraphs_byte_and_structure_identical', old_other==new_other)
    report={'format':'independent-docx-edit-verification','passed':all(c['passed'] for c in checks),'originalSha256':srcsha,'returnedSha256':hashlib.sha256(rb).hexdigest(),'inputs':{'original':str(original),'returned':str(returned),'annotations':str(annotations),'results':str(results),'exportedZip':str(exported)},'checks':checks,'verificationScope':'Read-only ZIP XML pixel and result guard checks. No rendering or Word all-page claim.'}
    output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'passed':report['passed'],'checks':len(checks),'failed':[c['name'] for c in checks if not c['passed']],'report':str(output)},ensure_ascii=False))
    raise SystemExit(0 if report['passed'] else 1)

if __name__=='__main__': main()
