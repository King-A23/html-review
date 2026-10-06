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
    assert.deepEqual(await readFile(path.join(output, 'html-review.html')), await readFile(path.join(root, 'index.html')));
    assert((await readFile(path.join(output, 'html-review.html'), 'utf8')).includes(await readFile(path.join(root, 'LICENSE'), 'utf8')), 'standalone distribution retains the full MIT notice');
    assert((await readFile(path.join(root, 'examples/demo.review.html'), 'utf8')).includes(await readFile(path.join(root, 'LICENSE'), 'utf8')), 'downloaded review copies retain the full MIT notice');
    const zipPath = path.join(output, `html-review-v${version}.zip`);
    const first = await readFile(zipPath);
    await runPython(['scripts/package_release.py', '--output', output], {cwd: root});
    assert.deepEqual(await readFile(zipPath), first, 'same inputs produce the same ZIP');
    const {stdout} = await runPython(['-c', 'import zipfile,json,sys; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({"names":z.namelist(),"version":z.read("html-review/VERSION").decode(),"bad":z.testzip()}))', zipPath]);
    const archive = JSON.parse(stdout);
    assert.equal(archive.version.trim(), version);
    assert.equal(archive.bad, null);
    for (const name of ['LICENSE','index.html','docs/QUICKSTART.md','scripts/update_review.py','examples/demo.review.html']) assert(archive.names.includes(`html-review/${name}`));
    assert(archive.names.every(name => name.startsWith('html-review/')));
    assert(archive.names.every(name => !name.includes('\\')), 'ZIP paths use portable forward slashes on every OS');
    for (const name of ['docs/WINDOWS.md','scripts/python.mjs','scripts/test.mjs']) assert(archive.names.includes(`html-review/${name}`));
    assert(!archive.names.some(name => /(?:videos|node_modules|test-results|\.git|\.env|__pycache__)\//.test(name)));
    for (const line of (await readFile(path.join(output, 'SHA256SUMS.txt'), 'utf8')).trim().split('\n')) {
      const [hash, filename] = line.split('  ');
      assert.equal(createHash('sha256').update(await readFile(path.join(output, filename))).digest('hex'), hash);
    }
  } finally { await rm(output, {recursive:true, force:true}); }
});
