/* Verify the frozen GitHub release against a successful default-branch build. Never publishes. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile, mkdtemp, rm, mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export function validateRelease({version, sha, release, ciRuns, files, published = false, tagSha = null}) {
  assert.equal(release.tagName, `v${version}`, 'Release tag must match package version');
  assert(!published || !release.isDraft, 'Publication gate requires a public release');
  if (release.isDraft) assert.equal(release.targetCommitish, sha, 'Draft target must be the exact tested commit');
  if (!release.isDraft || tagSha) assert.equal(tagSha, sha, 'Release tag must resolve to the tested commit');
  assert(ciRuns.some(run => run.headSha === sha && run.status === 'completed' && run.conclusion === 'success'), 'Successful default-branch push CI is required for this exact commit');
  const names = ['html-review.html', `html-review-v${version}.zip`, 'SHA256SUMS.txt'];
  assert.deepEqual(release.assets.map(asset => asset.name).sort(), names.slice().sort(), 'Release must have exactly the three expected assets');
  const report = {};
  for (const name of names) {
    const {local, remote} = files[name];
    assert(local.equals(remote), `Uploaded asset differs from the source build: ${name}`);
    const asset = release.assets.find(asset => asset.name === name);
    assert.equal(asset.state, 'uploaded', `Upload must be complete: ${name}`);
    assert.equal(asset.size, local.length, `Asset size differs: ${name}`);
    const sha256 = createHash('sha256').update(local).digest('hex');
    if (asset.digest) assert.equal(asset.digest, `sha256:${sha256}`, `GitHub asset digest differs: ${name}`);
    report[name] = {bytes: local.length, sha256};
  }
  assert(files['html-review.html'].local.includes(Buffer.from(`name="html-review-version" content="${version}"`)), 'Standalone version metadata must match');
  const expectedSums = names.slice(0, 2).map(name => `${report[name].sha256}  ${name}\n`).join('');
  assert.equal(files['SHA256SUMS.txt'].local.toString('utf8'), expectedSums, 'SHA256SUMS must identify these exact assets');
  return {version, sha, draft: release.isDraft, assets: report};
}

async function main() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const gh = args => execFileSync('gh', args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  const json = args => JSON.parse(gh(args));
  const {version} = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const tag = process.argv.slice(2).find(value => !value.startsWith('--')) || `v${version}`;
  assert.equal(tag, `v${version}`, 'Requested release must match the checked-out version');
  assert(/^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(tag), 'Invalid release tag');
  assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {cwd: root, encoding: 'utf8'}).trim(), '', 'Tracked files must be committed before verification');
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
  const repository = json(['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef']);
  const branch = repository.defaultBranchRef.name;
  const release = json(['release', 'view', tag, '--json', 'tagName,isDraft,targetCommitish,assets,url']);
  if (release.isDraft) {
    const head = gh(['api', `repos/${repository.nameWithOwner}/commits/${encodeURIComponent(branch)}`, '--jq', '.sha']).trim();
    assert.equal(sha, head, 'Publish-ready draft must be built from the current default-branch commit');
  }
  const ciRuns = json(['run', 'list', '--workflow', 'ci.yml', '--commit', sha, '--branch', branch, '--event', 'push', '--status', 'success', '--json', 'headSha,status,conclusion,url']);
  let tagSha = null;
  try {
    gh(['api', `repos/${repository.nameWithOwner}/git/ref/tags/${encodeURIComponent(tag)}`]);
    tagSha = gh(['api', `repos/${repository.nameWithOwner}/commits/${encodeURIComponent(tag)}`, '--jq', '.sha']).trim();
  }
  catch (error) {if (!release.isDraft || !String(error.stderr).includes('HTTP 404')) throw error;}
  const directory = await mkdtemp(path.join(tmpdir(), 'html-review-release-preflight-'));
  try {
    gh(['release', 'download', tag, '--dir', directory, '--pattern', 'html-review.html', '--pattern', `html-review-v${version}.zip`, '--pattern', 'SHA256SUMS.txt']);
    const files = {};
    for (const name of ['html-review.html', `html-review-v${version}.zip`, 'SHA256SUMS.txt']) files[name] = {local: await readFile(path.join(root, 'dist', name)), remote: await readFile(path.join(directory, name))};
    const report = validateRelease({version, sha, release, ciRuns, files, tagSha, published: process.argv.includes('--published')});
    report.releaseUrl = release.url; report.ciUrl = ciRuns[0].url;
    await mkdir(path.join(root, 'test-results'), {recursive: true});
    await writeFile(path.join(root, 'test-results/release-preflight.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`PASS ${tag}: exact default-branch CI, complete uploads, checksums and rebuilt assets match; ${release.isDraft ? 'draft ready to publish' : 'published release verified'}`);
  } finally {await rm(directory, {recursive: true, force: true});}
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main().catch(error => {console.error(error.message); process.exitCode = 1;});
