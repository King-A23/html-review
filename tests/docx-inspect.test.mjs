import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {runPython} from '../scripts/python.mjs';

test('Python DOCX inspection, mapping, result feedback and portable paths', async () => {
  await runPython([fileURLToPath(new URL('./docx_inspect_test.py', import.meta.url))], {encoding: 'utf8'});
});
