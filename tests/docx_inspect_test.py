"""DOCX static inspection protocol tests; no browser or third party XML parser."""
import base64
import copy
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from inspect_review import sha256, read_review, inspect, docx_evidence, bounded_docx_archive, docx_paragraph_text, string_length
from xml.etree import ElementTree as ET
from update_review import create_results, main as update_main

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
P = '/w:document[1]/w:body[1]'


def fixture():
    image = b'mapped image bytes'
    xml = f'''<w:document xmlns:w="{W}" xmlns:r="{R}" xmlns:a="{A}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:body>
<w:p w14:paraId="000001"><w:r><w:t>中文😀</w:t><w:tab/><w:t>原文</w:t><w:br/></w:r><w:del><w:r><w:delText>已删除</w:delText></w:r></w:del><w:ins><w:r><w:t>新增</w:t></w:r></w:ins></w:p>
<w:p><w:r><w:t>未批注的秘密全文</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格证据</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><w:drawing><a:blip r:embed="rId1"/></w:drawing></w:r></w:p>
</w:body></w:document>'''
    notes = f'<w:footnotes xmlns:w="{W}"><w:footnote w:id="1"><w:p><w:r><w:t>脚注内容</w:t></w:r></w:p></w:footnote></w:footnotes>'
    stream = io.BytesIO()
    with ZipFile(stream, 'w') as archive:
        archive.writestr('word/document.xml', xml)
        archive.writestr('word/footnotes.xml', notes)
        archive.writestr('word/media/image1.png', image)
        archive.writestr('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>')
    raw = stream.getvalue()
    blocks = [
        {'id': 'p1', 'part': 'word/document.xml', 'path': P + '/w:p[1]', 'paraId': '000001'},
        {'id': 'cell', 'part': 'word/document.xml', 'path': P + '/w:tbl[1]/w:tr[1]/w:tc[1]/w:p[1]', 'table': {'path': P + '/w:tbl[1]', 'row': 1, 'column': 1}},
        {'id': 'img', 'part': 'word/document.xml', 'path': P + '/w:p[3]', 'image': {'relationshipId': 'rId1', 'mediaPath': 'word/media/image1.png', 'sha256': sha256(image)}},
        {'id': 'note', 'part': 'word/footnotes.xml', 'path': '/w:footnotes[1]/w:footnote[1]/w:p[1]'},
    ]
    data = {'format': 'html-review', 'schemaVersion': 2,
            'source': {'type': 'docx', 'adapterVersion': '1', 'name': '中文 报告.docx', 'path': 'C:\\资料\\中文 报告.docx', 'byteLength': len(raw), 'sha256': sha256(raw), 'base64': base64.b64encode(raw).decode()},
            'resources': [], 'annotations': [{'id': '意见😀', 'updatedAt': '2026-10-08T00:00:00Z', 'comment': '修改中文', 'target': {'kind': 'text', 'quote': {'exact': '中文😀', 'prefix': '', 'suffix': '\t原文'}, 'docx': {'adapterVersion': '1', 'sourceSha256': sha256(raw), 'blocks': blocks, 'start': {'id': 'p1', 'offset': 0}, 'end': {'id': 'p1', 'offset': 4}}}}]}
    return data, raw


class DocxInspectTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='docx-中文-')
        self.root = Path(self.directory.name)
        self.data, self.raw = fixture()
        self.original = self.root / '中文 报告.docx'
        self.original.write_bytes(self.raw)

    def tearDown(self):
        self.directory.cleanup()

    def write(self, data):
        target = self.root / '批注 副本.review.json'
        target.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
        return target

    def light(self):
        data = copy.deepcopy(self.data)
        data['format'] = 'html-review-annotations'
        del data['source']['base64']
        return data

    def test_full_and_light_read_results_keep_schema_one(self):
        for data in [self.data, self.light()]:
            review, _ = read_review(self.write(data))
            result = create_results(review, summary='中文😀已验证')
            self.assertEqual(result['schemaVersion'], 1)
            self.assertEqual(result['results'][0]['id'], '意见😀')
        output = self.root / '中文 结果.json'
        self.assertEqual(update_main([str(self.write(self.light())), '--pending', '--output', str(output)]), 0)
        self.assertEqual(json.loads(output.read_text())['schemaVersion'], 1)

    def test_inspect_only_mapped_evidence_and_utf16(self):
        output = io.StringIO()
        with redirect_stdout(output):
            self.assertEqual(inspect(self.write(self.light()), self.original), 0)
        text = output.getvalue()
        self.assertIn('中文😀', text)
        self.assertIn('表格证据', text)
        self.assertIn('脚注内容', text)
        self.assertIn('C:\\资料\\中文 报告.docx', text)
        self.assertNotIn('未批注的秘密全文', text)
        self.assertNotIn(self.data['source']['base64'], text)
        self.assertNotIn('mapped image bytes', text)
        self.assertEqual(docx_evidence(self.data, self.raw)[0]['evidence'][0]['paragraph'], '中文😀\t原文\n新增')
        self.data['annotations'][0]['target']['docx']['end']['offset'] = 100
        with self.assertRaisesRegex(ValueError, '偏移'):
            docx_evidence(self.data, self.raw)

    def test_mapping_version_hash_and_snapshot_rejections(self):
        mutations = [
            lambda d: d['source'].update(adapterVersion='2'),
            lambda d: d['source'].update(encoding='utf-8'),
            lambda d: d['annotations'][0]['target']['docx'].update(sourceSha256='invalid'),
            lambda d: d['annotations'][0]['target']['docx'].update(adapterVersion='2'),
            lambda d: d['annotations'][0]['target']['docx']['blocks'][0].update(path=P + '/w:p[0]'),
            lambda d: d['annotations'][0]['target']['docx']['blocks'][0].update(path=P + '//w:p[1]'),
            lambda d: d['annotations'][0]['target']['docx']['blocks'][0].update(paraId='wrong'),
            lambda d: d['annotations'][0]['target']['docx']['blocks'][1]['table'].update(column=2),
            lambda d: d['annotations'][0]['target']['docx']['blocks'][2]['image'].update(sha256='0' * 64),
            lambda d: d['source'].update(base64=base64.b64encode(b'corrupt').decode()),
        ]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                data = copy.deepcopy(self.data)
                mutation(data)
                with self.assertRaises(ValueError):
                    read_review(self.write(data))
        self.original.write_bytes(b'changed')
        with redirect_stdout(io.StringIO()):
            self.assertEqual(inspect(self.write(self.light()), self.original), 2)

    def test_table_row_and_cell_element_targets(self):
        for suffix in ('/w:tbl[1]', '/w:tbl[1]/w:tr[1]', '/w:tbl[1]/w:tr[1]/w:tc[1]'):
            data = copy.deepcopy(self.data)
            target = data['annotations'][0]['target']
            target['kind'] = 'element'
            mapping = target['docx']
            mapping.pop('start')
            mapping.pop('end')
            mapping['blocks'] = [mapping['blocks'][1]]
            mapping['blocks'][0]['path'] = P + suffix
            evidence = docx_evidence(data, self.raw)
            self.assertEqual(evidence[0]['evidence'][0]['paragraphs'], ['表格证据'])

    def test_reloaded_source_retains_old_and_resolved_targets(self):
        old = copy.deepcopy(self.data['annotations'][0])
        old['id'] = '旧版本待处理'
        old['target']['docx']['sourceSha256'] = '0' * 64
        # These paths and image hashes belonged to the old ZIP and need not exist now.
        old['target']['docx']['blocks'][0]['path'] = P + '/w:p[999]'
        old['target']['docx']['blocks'][1]['table']['column'] = 999
        old['target']['docx']['blocks'][2]['image']['sha256'] = '1' * 64
        old['target']['docx']['end']['offset'] = 999
        resolved = copy.deepcopy(old)
        resolved.update(id='旧版本已完成', status='resolved')
        self.data['annotations'].extend([old, resolved])
        review, _ = read_review(self.write(self.data))
        evidence = docx_evidence(review, self.raw)
        self.assertEqual(evidence[0]['evidence'][0]['paragraph'], '中文😀\t原文\n新增')
        self.assertFalse(evidence[0].get('stale', False))
        self.assertTrue(evidence[1]['stale'])
        self.assertTrue(evidence[2]['stale'])
        self.assertEqual(evidence[1]['evidence'], [])
        results = create_results(review)
        self.assertEqual([result['id'] for result in results['results']], ['意见😀', '旧版本待处理'])
        self.assertEqual(results['schemaVersion'], 1)
        with redirect_stdout(io.StringIO()) as output:
            self.assertEqual(inspect(self.write(self.data), self.original), 0)
        self.assertIn('旧版本目标', output.getvalue())

    def test_docx_resources_must_stay_inside_original_zip(self):
        for data in (copy.deepcopy(self.data), self.light()):
            resource = {'path': 'assets/image.png', 'mime': 'image/png', 'sha256': sha256(b'image')}
            if data['format'] == 'html-review':
                resource['base64'] = base64.b64encode(b'image').decode()
            data['resources'] = [resource]
            with self.assertRaisesRegex(ValueError, 'resources 必须为空列表'):
                read_review(self.write(data))
            output = self.root / '不应生成.json'
            self.assertEqual(update_main([str(self.write(data)), '--pending', '--output', str(output)]), 1)
            self.assertFalse(output.exists())

    def test_paragraph_breaks_hyphens_and_explicit_utf16_offsets(self):
        node = ET.fromstring(f'<w:p xmlns:w="{W}"><w:r><w:t>😀A</w:t><w:noBreakHyphen/><w:t>B</w:t><w:softHyphen/><w:t>C</w:t><w:br w:type="page"/><w:br w:type="column"/><w:t>D</w:t><w:br/><w:t>E</w:t><w:cr/><w:t>F</w:t></w:r></w:p>')
        text = docx_paragraph_text(node)
        self.assertEqual(text, '😀A\u2011B\u00adCD\nE\nF')
        self.assertEqual(string_length(text), 12)
        stream = io.BytesIO()
        with ZipFile(io.BytesIO(self.raw)) as archive, ZipFile(stream, 'w') as replacement:
            for part in archive.namelist():
                raw = archive.read(part)
                if part == 'word/document.xml':
                    root = ET.fromstring(raw)
                    body = root.find(f'{{{W}}}body')
                    body.remove(body[0])
                    node.set('{http://schemas.microsoft.com/office/word/2010/wordml}paraId', '000001')
                    body.insert(0, node)
                    raw = ET.tostring(root)
                replacement.writestr(part, raw)
        raw = stream.getvalue()
        data = copy.deepcopy(self.data)
        data['source'].update(sha256=sha256(raw), byteLength=len(raw), base64=base64.b64encode(raw).decode())
        mapping = data['annotations'][0]['target']['docx']
        mapping.update(sourceSha256=sha256(raw), blocks=[mapping['blocks'][0]], start={'id': 'p1', 'offset': 8}, end={'id': 'p1', 'offset': 12})
        evidence = docx_evidence(data, raw)
        self.assertEqual(evidence[0]['evidence'][0]['paragraph'], text)
        read_review(self.write(data))
        mapping['end']['offset'] = 13
        with self.assertRaisesRegex(ValueError, '偏移'):
            read_review(self.write(data))

    def test_zip_limits_and_xml_entity_rejection(self):
        stream = io.BytesIO()
        with ZipFile(stream, 'w') as archive:
            archive.writestr('word/document.xml', '<x/>')
            for n in range(3000):
                archive.writestr('empty/' + str(n), b'')
        with self.assertRaisesRegex(ValueError, '3000'):
            bounded_docx_archive(stream.getvalue())
        stream = io.BytesIO()
        with ZipFile(stream, 'w') as archive:
            archive.writestr('word/document.xml', '<!DOCTYPE x [<!ENTITY x "danger">]><x/>')
        self.data['annotations'][0]['target']['docx']['sourceSha256'] = sha256(stream.getvalue())
        with self.assertRaisesRegex(ValueError, 'DTD'):
            docx_evidence(self.data, stream.getvalue())


if __name__ == '__main__':
    unittest.main()
