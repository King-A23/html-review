#!/usr/bin/env node
import {readFile, writeFile, stat, realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function validatePendingAnnotations(data, core) {
  const source = data?.source;
  const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  if (data?.format !== 'html-review-annotations' || ![2,3].includes(data.schemaVersion) || source?.type !== (data.schemaVersion === 3 ? 'pdf' : 'docx')
    || source.adapterVersion !== '1' || source.encoding !== undefined || source.base64 !== undefined
    || typeof source.name !== 'string' || !source.name || source.name.length > 1024
    || typeof source.path !== 'string' || core.normalizePath(source.path) !== source.path
    || !Number.isSafeInteger(source.byteLength) || source.byteLength < 2 || source.byteLength > core.limits.source
    || !/^[a-f0-9]{64}$/.test(source.sha256 || '')
    || (source.lastModified !== null && (!Number.isFinite(source.lastModified) || source.lastModified < 0))
    || !validTime(data.createdAt) || !validTime(data.updatedAt)
    || !Array.isArray(data.resources) || data.resources.length !== 0
    || data.preview !== undefined || data.index !== undefined
    || !Array.isArray(data.annotations) || data.annotations.length > core.limits.annotations
    || data.annotations.some(annotation => !annotation || typeof annotation !== 'object' || Array.isArray(annotation))) {
    throw new Error('请选择有效的 DOCX / PDF 轻量批注 JSON（格式版本 2 / 3）。');
  }
  if (data.schemaVersion === 3) return core.validateAnnotationExport(data);
  return data;
}
export async function prepareReview(input) {
  if (!input) return path.join(root, 'index.html');
  // Decode file URLs with Node's platform-aware converter, including Windows
  // drive letters and UNC hosts. URL.pathname alone loses both kinds of paths.
  const filename = /^file:/i.test(input) ? fileURLToPath(input) : path.resolve(input);
  if (!/\.(?:html?|docx|pdf|json)$/i.test(filename)) throw new Error('请选择 .html、.htm、.docx、.pdf 或 DOCX / PDF 轻量批注 .json 文件。');
  const info = await stat(filename);
  if (!info.isFile()) throw new Error('输入路径不是文件。');
  if (info.size > 100 * 1024 * 1024) throw new Error('输入文件超过 100 MiB。');
  const bytes = await readFile(filename);
  const context = {crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, URL, btoa, atob};
  vm.runInNewContext(await readFile(path.join(root, 'src/core.js'), 'utf8'), context);
  const core = context.HRCore;
  const isDocx = /\.docx$/i.test(filename);
  const isPdf = /\.pdf$/i.test(filename);
  const isJSON = /\.json$/i.test(filename);
  const text = isDocx || isPdf ? '' : core.decodeBytes(bytes).text;
  const blocks = isJSON ? [] : Array.from(text.matchAll(/<script\b(?=[^>]*\bid\s*=\s*["']html-review-data["'])(?=[^>]*\btype\s*=\s*["']application\/json["'])[^>]*>([\s\S]*?)<\/script\s*>/gi));
  if (blocks.length) {
    if (blocks.length !== 1) throw new Error('文件包含多个批注数据块。');
    const data = JSON.parse(blocks[0][1]);
    if (data) await core.validateData(data);
    return filename;
  }
  const data = isJSON ? await validatePendingAnnotations(JSON.parse(text), core)
    : await core.importSource({bytes: new Uint8Array(bytes), name: path.basename(filename), lastModified: info.mtimeMs});
  if (!isJSON) await core.validateData(data);
  const template = (await readFile(path.join(root, 'index.html'), 'utf8'))
    .replace(/(<script type="application\/json" id="html-review-example">)[\s\S]*?(<\/script>)/, '$1null$2')
    .replace('<button id="example-button"', '<button hidden id="example-button"');
  const marker = '<script id="html-review-data" type="application/json">null</script>';
  if (template.split(marker).length !== 2) throw new Error('工具模板无效，请重新构建 index.html。');
  let output;
  if (isJSON) {
    const pendingMarker = '<script id="html-review-pending-annotations" type="application/json">null</script>';
    const pendingScript = '<script id="html-review-pending-annotations" type="application/json">' + core.serialize(data) + '</script>';
    if (template.includes(pendingMarker)) output = template.replace(pendingMarker, () => pendingScript);
    else output = template.replace(marker, () => marker + '\n' + pendingScript);
  } else output = template.replace(marker, () => '<script id="html-review-data" type="application/json">' + core.serialize(data) + '</script>');
  const basename = filename.replace(/\.(?:html?|docx|pdf|json)$/i, '');
  for (let index = 0; index < 10000; index++) {
    const destination = basename + '.review' + (index ? '.' + index : '') + '.html';
    try {await writeFile(destination, output, {flag: 'wx'}); return destination;}
    catch (error) {if (error.code !== 'EEXIST') throw error;}
  }
  throw new Error('批注副本文件名已全部占用。');
}
export function browserLaunchPlan(filename, platform = process.platform) {
  const url = (platform === process.platform ? pathToFileURL(filename)
    : pathToFileURL(filename, {windows: platform === 'win32'})).href;
  // Explicit argument arrays keep filenames from being interpreted as shell commands.
  const [command, args] = platform === 'darwin' ? ['open', ['-a', 'Google Chrome', filename]]
    : platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]] : ['xdg-open', [url]];
  return {command, args, options: {stdio: 'ignore', shell: false, windowsHide: true}};
}
export async function openReview(filename, {platform = process.platform, spawnProcess = spawn} = {}) {
  const plan = browserLaunchPlan(filename, platform);
  await new Promise((resolve, reject) => {
    const child = spawnProcess(plan.command, plan.args, plan.options);
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('无法启动浏览器，请手动打开上面的文件。' + (platform === 'darwin' ? 'macOS 默认使用 Google Chrome。' : ''))));
  });
}
export async function main(args = process.argv.slice(2), {openFile = openReview, log = console.log, errorLog = console.error} = {}) {
  if (args.includes('--help') || args.includes('-h')) {
    log('用法：html-review [文件.html / 文件.docx / 文件.pdf / DOCX或PDF批注.json 或 file: URL] [--no-open]\n\n无参数打开工具；HTML / DOCX / PDF 生成同目录批注副本；批注副本直接继续编辑。\nDOCX / PDF 轻量批注 JSON 打开配对工作区，请在浏览器中选择对应的原始 DOCX 或 PDF。\n已有文件不会被覆盖。外部资源请在工具中使用“导入文件夹”。\n--no-open 仅准备文件并输出路径，不启动浏览器。');
    return 0;
  }
  const noOpen = args.includes('--no-open');
  const files = args.filter(a => a !== '--no-open');
  if (files.length > 1 || files.some(a => a.startsWith('-'))) {
    errorLog('参数无效。运行 html-review --help 查看用法。');
    return 1;
  }
  try {
    const filename = await prepareReview(files[0]); log(filename);
    if (!noOpen) await openFile(filename);
    return 0;
  } catch (error) {errorLog('HTML Review：' + error.message); return 1;}
}
if (process.argv[1] && await realpath(process.argv[1]).catch(() => '') === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
