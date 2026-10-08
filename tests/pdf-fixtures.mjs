/** Optional Python fixture tooling. The application itself never needs Python. */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {access, mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir, homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const execute = promisify(execFile);
const helper = fileURLToPath(new URL('./helpers/pdf-fixture.py', import.meta.url));
export const PDF_PASSWORD = 'review-secret';
export const PDF_VARIANTS = ['base','changed','inserted','moved','duplicated','deleted-text','chart-replacement','scan-change','encrypted','corrupt','oversized','page-limit'];
let pythonPromise;
export function fixturePython() {
  return pythonPromise ??= (async () => {
    const bundled = path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3');
    for (const command of [process.env.PDF_FIXTURE_PYTHON, bundled, 'python3', 'python'].filter(Boolean)) {
      try {await execute(command, ['-c', 'import runpy,sys; runpy.run_path(sys.argv[1],run_name="_fixture_probe_")',helper]); return command;} catch {}
    }
    return null;
  })();
}
export async function writePdfFixture(output, variant='base') {
  if (!PDF_VARIANTS.includes(variant)) throw new Error(`Unknown PDF fixture: ${variant}`);
  const python = await fixturePython();
  if (!python) throw new Error('PDF fixtures require reportlab, pypdf, Pillow and a Chinese TrueType font; set PDF_FIXTURE_PYTHON / PDF_FIXTURE_CJK_FONT.');
  await execute(python, [helper, output, '--variant', variant], {encoding:'utf8'});
  return output;
}
export async function createPdfFixture(variant='base') {
  const directory = await mkdtemp(path.join(tmpdir(), 'html-review-pdf-fixture-'));
  try {const output=path.join(directory,`${variant}.pdf`); await writePdfFixture(output,variant); return await readFile(output);}
  finally {await rm(directory,{recursive:true,force:true});}
}
export async function inspectPdfFixture(output) {
  const python = await fixturePython();
  if (!python) throw new Error('Missing PDF fixture Python dependencies.');
  const {stdout} = await execute(python, [helper, output, '--inspect'], {encoding:'utf8',maxBuffer:4*1024*1024});
  return JSON.parse(stdout);
}
export async function popplerCommand(name) {
  const override=path.join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override',name);
  try {await access(override); return override;} catch {}
  try {await execute(name,['-v']);return name;} catch {return null;}
}
