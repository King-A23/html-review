/* Curated static deployment: never copy the repository or video work directory wholesale. */
import {mkdir, readFile, writeFile, copyFile, stat, rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '_site');
const {version} = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)) throw new Error('Invalid version');
const standalone = await readFile(path.join(root, 'dist/html-review.html'));
if (!standalone.equals(await readFile(path.join(root, 'index.html')))) throw new Error('Prepare current release downloads before building the site.');
// Only this dedicated generated directory is cleared.
await rm(output, {recursive:true, force:true});
await mkdir(output, {recursive:true});
async function copy(from, to) {
  const input = path.join(root, from);
  if (!(await stat(input)).isFile()) throw new Error(`Missing site input: ${from}`);
  const destination = path.join(output, to);
  await mkdir(path.dirname(destination), {recursive:true});
  await copyFile(input, destination);
}
let launchVideo = 'https://king-a23.github.io/html-review/media/launch.mp4';
try { await copy('docs/media/launch.mp4', 'media/launch.mp4'); launchVideo = 'media/launch.mp4'; }
catch (error) { if (error.code !== 'ENOENT') throw error; }
for (const name of ['demo.mp4','social-preview.png']) await copy(`docs/media/${name}`, `media/${name}`);
for (const name of ['style.css','main.js','favicon.svg']) await copy(`site/${name}`, name);
for (const name of ['html-review.html', `html-review-v${version}.zip`, 'SHA256SUMS.txt']) await copy(`dist/${name}`, `downloads/${name}`);
await copy('docs/preview.png', 'assets/preview.png');
const landing = (await readFile(path.join(root, 'site/index.html'), 'utf8'))
  .replaceAll('{{VERSION}}', version).replaceAll('{{DOWNLOAD_SIZE}}', `${Math.round(standalone.length / 1000)} KB`).replaceAll('{{LAUNCH_VIDEO}}', launchVideo);
if (/\{\{[A-Z_]+\}\}/.test(landing)) throw new Error('Unresolved site placeholders');
await writeFile(path.join(output, 'index.html'), landing);
// Online navigation is removed when the tool exports an editable offline review copy.
const onlineStyle = '<style data-site-only>.online-bar{height:38px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 28px;background:#edf0e4;color:#58624e;font:12px system-ui,sans-serif;border-bottom:1px solid #d9dece}.online-bar a{color:inherit;text-decoration:none;padding:8px 0}.online-bar a:focus-visible{outline:2px solid #bd4d32;outline-offset:2px}.online-bar a:last-child{font-weight:650;color:#33412b}.workspace{height:calc(100dvh - var(--header-height) - 38px)}@media(max-width:760px){.online-bar{padding:0 16px;font-size:11px}.online-bar span{display:none}.workspace{height:auto}}</style>';
const onlineBar = '<nav class="online-bar" aria-label="在线版导航" data-site-only><a href="./">← HTML Review 首页</a><span>本地处理 · 无需登录</span><a href="downloads/html-review.html" download="html-review.html">下载离线工具 ↓</a></nav>';
const app = standalone.toString('utf8').replace('</head>', `<link rel="icon" href="favicon.svg" type="image/svg+xml" data-site-only>${onlineStyle}</head>`).replace(/<body([^>]*)>/, `<body$1>${onlineBar}`);
if (!app.includes(onlineBar)) throw new Error('Unable to add online navigation');
await writeFile(path.join(output, 'app.html'), app);
await writeFile(path.join(output, '.nojekyll'), '');
await writeFile(path.join(output, '404.html'), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>返回 HTML Review</title><body style="font:18px system-ui;padding:8vw;background:#f7f6f0;color:#2e372e"><h1>这个页面不存在。</h1><a href="/html-review/">返回 HTML Review 首页 →</a></body></html>');
await writeFile(path.join(output, 'version.json'), JSON.stringify({version, standaloneBytes:standalone.length})+'\n');
console.log(`Site built: _site/ · v${version} · direct HTML download ${(standalone.length / 1024).toFixed(1)} KiB`);
