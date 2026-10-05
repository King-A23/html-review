#!/usr/bin/env node
import {readFile, writeFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('用法：html-review [文件.html] [--no-open]\n\n无参数打开工具；HTML 生成同目录批注副本；批注副本直接继续编辑。\n已有文件不会被覆盖。外部资源请在工具中使用“导入文件夹”。\n--no-open 仅准备文件并输出路径，不启动浏览器。');
  process.exit(0);
}
const noOpen = args.includes('--no-open');
const files = args.filter(a => a !== '--no-open');
if (files.length > 1 || files.some(a => a.startsWith('-'))) {
  console.error('参数无效。运行 html-review --help 查看用法。'); process.exit(1);
}
async function prepare() {
  if (!files.length) return path.join(root, 'index.html');
  const filename = path.resolve(files[0]);
  if (!/\.html?$/i.test(filename)) throw new Error('请选择 .html 或 .htm 文件。');
  const info = await stat(filename);
  if (!info.isFile()) throw new Error('输入路径不是文件。');
  if (info.size > 100 * 1024 * 1024) throw new Error('输入文件超过 100 MiB。');
  const bytes = await readFile(filename);
  const context = {crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, URL, btoa, atob};
  vm.runInNewContext(await readFile(path.join(root, 'src/core.js'), 'utf8'), context);
  const core = context.HRCore;
  const text = core.decodeBytes(bytes).text;
  const blocks = Array.from(text.matchAll(/<script\b(?=[^>]*\bid\s*=\s*["']html-review-data["'])(?=[^>]*\btype\s*=\s*["']application\/json["'])[^>]*>([\s\S]*?)<\/script\s*>/gi));
  if (blocks.length) {
    if (blocks.length !== 1) throw new Error('文件包含多个批注数据块。');
    const data = JSON.parse(blocks[0][1]);
    if (data) await core.validateData(data);
    return filename;
  }
  const data = await core.importSource({bytes: new Uint8Array(bytes), name: path.basename(filename), lastModified: info.mtimeMs});
  const template = await readFile(path.join(root, 'index.html'), 'utf8');
  const marker = '<script id="html-review-data" type="application/json">null</script>';
  if (template.split(marker).length !== 2) throw new Error('工具模板无效，请重新构建 index.html。');
  const output = template.replace(marker, () => '<script id="html-review-data" type="application/json">' + core.serialize(data) + '</script>');
  const basename = filename.replace(/\.html?$/i, '');
  for (let index = 0; index < 10000; index++) {
    const destination = basename + '.review' + (index ? '.' + index : '') + '.html';
    try {await writeFile(destination, output, {flag: 'wx'}); return destination;}
    catch (error) {if (error.code !== 'EEXIST') throw error;}
  }
  throw new Error('批注副本文件名已全部占用。');
}
async function open(filename) {
  const url = pathToFileURL(filename).href;
  // Explicit argument arrays keep filenames from being interpreted as shell commands.
  const command = process.platform === 'darwin' ? ['open', ['-a', 'Google Chrome', filename]]
    : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : ['xdg-open', [url]];
  await new Promise((resolve, reject) => {
    const child = spawn(command[0], command[1], {stdio: 'ignore'});
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('无法启动浏览器，请手动打开上面的文件。macOS 默认使用 Google Chrome。')));
  });
}
try {
  const filename = await prepare(); console.log(filename);
  if (!noOpen) await open(filename);
} catch (error) {console.error('HTML Review：' + error.message); process.exitCode = 1;}
