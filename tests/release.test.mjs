import {runPython} from '../scripts/python.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));

test('release downloads preserve the standalone app, use a curated bundle and match checksums', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'html-review-release-'));
  try {
    await runPython(['scripts/package_release.py', '--output', output], {cwd: root});
    const {version} = JSON.parse(await readFile(path.join(root, 'package.json')));
    assert((await readFile(path.join(output, 'html-review.html'), 'utf8')).includes(`name="html-review-version" content="${version}"`));
    assert.deepEqual(await readFile(path.join(output, 'html-review.html')), await readFile(path.join(root, 'index.html')));
    assert((await readFile(path.join(output, 'html-review.html'), 'utf8')).includes(await readFile(path.join(root, 'LICENSE'), 'utf8')), 'standalone distribution retains the full MIT notice');
    assert((await readFile(path.join(root, 'examples/demo.review.html'), 'utf8')).includes(await readFile(path.join(root, 'LICENSE'), 'utf8')), 'downloaded review copies retain the full MIT notice');
    const zipPath = path.join(output, `html-review-v${version}.zip`);
    const first = await readFile(zipPath);
    await runPython(['scripts/package_release.py', '--output', output], {cwd: root});
    assert.deepEqual(await readFile(zipPath), first, 'same inputs produce the same ZIP');
    const {stdout} = await runPython(['-c', 'import zipfile,json,sys; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({"names":z.namelist(),"version":z.read("html-review/VERSION").decode(),"bad":z.testzip(),"binMode":(z.getinfo("html-review/bin/html-review.mjs").external_attr >> 16) & 0o777}))', zipPath]);
    const archive = JSON.parse(stdout);
    assert.equal(archive.version.trim(), version);
    assert.equal(archive.bad, null);
    assert.equal(archive.binMode, 0o755, 'ZIP retains the executable CLI mode for Unix archive tools');
    for (const name of ['LICENSE','index.html','docs/QUICKSTART.md','scripts/update_review.py','examples/demo.review.html',
      'tests/docx_inspect_test.py','tests/roundtrip-fixture.py','tests/roundtrip-verify.py', 'tests/pdf-requirements.txt',
      'examples/documents/review.docx','examples/documents/review.pdf','examples/documents/docx.review.json','examples/documents/pdf.review.json',
      'docs/docx-preview.png','docs/pdf-preview.png','docs/media/documents-demo.mp4','docs/media/documents-demo.gif',
      'scripts/verify_release.mjs','docs/RELEASE_PROCESS.md','docs/RELEASE_VALIDATION.md','docs/DOCX_DEVELOPMENT.md','docs/PDF_DEVELOPMENT.md']) assert(archive.names.includes(`html-review/${name}`), name);
    assert(archive.names.includes('html-review/tests/helpers/pdf-fixture.py'), 'PDF fixture generator travels with its development tests');
    assert(archive.names.every(name => name.startsWith('html-review/')));
    assert(archive.names.every(name => !name.includes('\\')), 'ZIP paths use portable forward slashes on every OS');
    for (const name of ['docs/WINDOWS.md','docs/REFERENCE.md','docs/media/demo.gif','docs/media/demo.mp4','docs/media/social-preview.png','site/index.html','scripts/build_site.mjs','scripts/python.mjs','scripts/test.mjs']) assert(archive.names.includes(`html-review/${name}`));
    assert(!archive.names.includes('html-review/docs/media/launch.mp4'), 'full promotional film is streamed separately');
    assert(archive.names.includes('html-review/docs/media/licenses/HyperFrames-SFX-CREDITS.md'));
    assert(!archive.names.some(name => /(?:videos|node_modules|test-results|\.git|\.env|__pycache__)\//.test(name)));
    for (const line of (await readFile(path.join(output, 'SHA256SUMS.txt'), 'utf8')).trim().split('\n')) {
      const [hash, filename] = line.split('  ');
      assert.equal(createHash('sha256').update(await readFile(path.join(output, filename))).digest('hex'), hash);
    }
    // Exercise the delivered tree, rather than accidentally importing repository helpers.
    await runPython(['-c', 'import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', zipPath, path.join(output, 'unpacked')]);
    const unpacked = path.join(output, 'unpacked', 'html-review');
    await runPython([path.join(unpacked, 'tests/docx_inspect_test.py')], {cwd: unpacked});
  } finally { await rm(output, {recursive:true, force:true}); }
});
