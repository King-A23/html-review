import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateRelease} from '../scripts/verify_release.mjs';
function fixture() {
  const version = '0.2.0', sha = 'a'.repeat(40);
  const contents = {'html-review.html': Buffer.from('<meta name="html-review-version" content="0.2.0">'), 'html-review-v0.2.0.zip': Buffer.from('frozen ZIP')};
  contents['SHA256SUMS.txt'] = Buffer.from(Object.entries(contents).map(([name, value]) => `${createHash('sha256').update(value).digest('hex')}  ${name}\n`).join(''));
  return {version, sha, release: {tagName: 'v0.2.0', isDraft: true, targetCommitish: sha, assets: Object.entries(contents).map(([name, data]) => ({name, state: 'uploaded', size: data.length, digest: 'sha256:' + createHash('sha256').update(data).digest('hex')}))}, ciRuns: [{headSha: sha, status: 'completed', conclusion: 'success'}], files: Object.fromEntries(Object.entries(contents).map(([name, value]) => [name, {local: value, remote: Buffer.from(value)}]))};
}
test('release preflight accepts a frozen draft and a matching public tag', () => {
  const input = fixture(); assert.equal(validateRelease(input).draft, true);
  input.release.isDraft = false; input.tagSha = input.sha; input.published = true;
  assert.equal(validateRelease(input).draft, false);
});
test('release preflight blocks stale targets, tags, CI, incomplete uploads and changed assets', () => {
  const cases = [
    input => {input.release.targetCommitish = 'main';},
    input => {input.tagSha = 'b'.repeat(40);},
    input => {input.ciRuns[0].headSha = 'b'.repeat(40);},
    input => {input.ciRuns[0].conclusion = 'failure';},
    input => {input.release.assets.pop();},
    input => {input.release.assets[0].state = 'new';},
    input => {input.release.assets[0].digest = 'sha256:bad';},
    input => {input.files['html-review.html'].remote = Buffer.from('changed download');},
    input => {input.published = true;},
  ];
  for (const change of cases) {const input = fixture(); change(input); assert.throws(() => validateRelease(input));}
});
