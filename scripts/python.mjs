/* Resolve Python without relying on a Unix-only command name or a shell. */
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
const execute = promisify(execFile);
let interpreter;
export async function findPython() {
  interpreter ??= (async () => {
    const configured = process.env.PYTHON;
    const candidates = configured ? [{command: configured, args: []}]
      : process.platform === 'win32'
        ? [{command: 'py', args: ['-3']}, {command: 'python', args: []}, {command: 'python3', args: []}]
        : [{command: 'python3', args: []}, {command: 'python', args: []}];
    for (const candidate of candidates) {
      try {
        await execute(candidate.command, [...candidate.args, '-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)'], {windowsHide: true, timeout: 5000});
        return candidate;
      } catch { /* Try another installed interpreter, never run a command shell. */ }
    }
    throw new Error(configured ? 'PYTHON must point to a Python 3.8+ executable.' : 'Python 3.8+ is required for agent scripts and release packaging. Install Python or set PYTHON to its executable path.');
  })();
  return interpreter;
}
export async function runPython(args, options = {}) {
  const {command, args: prefix} = await findPython();
  return execute(command, [...prefix, '-X', 'utf8', ...args], {...options, windowsHide: true,
    env: {...process.env, ...options.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8'}});
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    if (!process.argv[2]) throw new Error('Usage: node scripts/python.mjs script.py [arguments]');
    const {command, args} = await findPython();
    const child = spawn(command, [...args, '-X', 'utf8', ...process.argv.slice(2)], {stdio: 'inherit', windowsHide: true,
      env: {...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8'}});
    child.once('error', error => {console.error(error.message); process.exitCode = 1;});
    child.once('exit', (code, signal) => {process.exitCode = signal ? 1 : code ?? 1;});
  } catch (error) {console.error(error.message); process.exitCode = 1;}
}
