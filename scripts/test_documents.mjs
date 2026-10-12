/* Required document regression gate. Missing fixture tooling is an error here. */
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {fixturePython, popplerCommand} from '../tests/pdf-fixtures.mjs';
if (!await fixturePython()) throw new Error('Install tests/pdf-requirements.txt and a Chinese TrueType font; see docs/PDF_DEVELOPMENT.md.');
if (!await popplerCommand('pdftoppm')) throw new Error('Install Poppler for the document release gate.');
const files = [
  'docx.browser.mjs', 'docx-errors.browser.mjs', 'docx-location.browser.mjs',
  'docx-session.browser.mjs', 'docx-list-indent.browser.mjs',
  'pdf.browser.mjs', 'pdf-errors.browser.mjs', 'pdf-lifecycle.browser.mjs',
  'pdf-visual.browser.mjs', 'pdf-copy.browser.mjs', 'pdf-reading.browser.mjs',
  'workflow.browser.mjs', 'ux-flow.browser.mjs', 'location-candidates.browser.mjs',
  'reading-tools.browser.mjs', 'frontend-robustness.browser.mjs', 'review-navigation.browser.mjs',
];
for (const file of files) {
  console.log(`Running ${file}`);
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../tests/' + file, import.meta.url))], {stdio:'inherit', windowsHide:true});
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(signal ? 1 : code ?? 1));
  });
  if (code) {process.exitCode = code; break;}
}
