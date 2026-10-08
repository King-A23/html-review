import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = name => readFile(path.join(root, name), 'utf8');
const script = (id, content) => `<script id="${id}">\n${content.replace(/<\/script/gi, '<\\/script')}\n</script>`;
const worker = await build({entryPoints:[path.join(root,'src/docx-worker.js')],bundle:true,platform:'browser',format:'iife',write:false,minify:true,legalComments:'inline',metafile:true});
const handoffLibrary = await build({entryPoints:[path.join(root,'src/handoff-lib.js')],bundle:true,platform:'browser',format:'iife',write:false,minify:true,legalComments:'inline'});
const handoff = await read('src/handoff.js');
const pdfLibrary = await build({entryPoints:[path.join(root,'src/pdf-lib.js')],bundle:true,platform:'browser',format:'iife',write:false,minify:true,legalComments:'inline'});
const pdfAssets = {};
const pdfAssetLicenses = [];
for (const folder of ['cmaps','standard_fonts','wasm','iccs']) {
  for (const name of (await readdir(path.join(root,'node_modules/pdfjs-dist',folder))).sort()) {
    if (/\.(bcmap|pfb|ttf|wasm|icc)$/i.test(name)) pdfAssets[folder+'/'+name]=(await readFile(path.join(root,'node_modules/pdfjs-dist',folder,name))).toString('base64');
    if (/^LICENSE/i.test(name)) pdfAssetLicenses.push(folder+'/'+name+'\n'+await readFile(path.join(root,'node_modules/pdfjs-dist',folder,name),'utf8'));
  }
}
const pdfWorkerSource = await readFile(path.join(root,'node_modules/pdfjs-dist/build/pdf.worker.mjs'),'utf8');
if(!pdfWorkerSource.includes('function fetchSync(url) {')) throw new Error('PDF.js offline sync-resource hook changed.');
const pdfWorkerBuild = await build({stdin:{contents:'let hrOfflineSync = {};\nself.addEventListener("message", event => { if(event.data?.hrOfflineSync) hrOfflineSync=event.data.hrOfflineSync; });\n'+pdfWorkerSource.replace('function fetchSync(url) {','function fetchSync(url) {\n  if (url.startsWith("offline:")) { const bytes=hrOfflineSync[url]; if(!bytes) throw new Error("Missing offline PDF resource: "+url); return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength); }'),resolveDir:root},platform:'browser',format:'iife',define:{'import.meta.url':'self.location.href'},write:false,minify:true,legalComments:'inline'});
const pdfWorker = Buffer.from(pdfWorkerBuild.outputFiles[0].text);
const pdfLicense = await readFile(path.join(root,'node_modules/pdfjs-dist/LICENSE'),'utf8');
const pdfBlocks = [
  '<script id="hr-pdf-licenses" type="text/plain">PDF.js 6.4.299\n'+(pdfLicense+'\n'+pdfAssetLicenses.join('\n\n')).replace(/[ \t]+\r?\n/g,'\n').replace(/<\/script/gi,'<\\/script')+'</script>',
  '<script id="hr-pdf-worker" type="text/plain">'+pdfWorker.toString('base64')+'</script>',
  '<script id="hr-pdf-assets" type="application/json">'+JSON.stringify(pdfAssets)+'</script>',
  script('hr-pdf-library',pdfLibrary.outputFiles[0].text),
  script('hr-pdf',await read('src/pdf.js')),
  script('hr-adapters',await read('src/adapters.js'))
];
const bundled = [...new Set(Object.keys(worker.metafile.inputs).filter(name=>name.includes('node_modules/')).map(name=>name.match(/node_modules\/(?:@[^/]+\/)?[^/]+/)[0]))].sort();
const credits = [];
for (const folder of bundled) {
  const manifest = JSON.parse(await readFile(path.join(root,folder,'package.json'),'utf8'));
  const files=(await readdir(path.join(root,folder))).filter(name=>/^(license|licence|copying)(?:[.-]|$)/i.test(name) && !/GPL/i.test(name));
  const licenses=await Promise.all(files.map(name=>readFile(path.join(root,folder,name),'utf8')));
  if(!licenses.length) throw new Error('Missing bundled license for '+manifest.name);
  credits.push(manifest.name+' '+manifest.version+' ('+manifest.license+')\n'+licenses.join('\n'));
}
const licenseBlock = '<script id="hr-docx-licenses" type="text/plain">'+credits.join('\n\n').replace(/[ \t]+\r?\n/g,'\n').replace(/<\/script/gi,'<\\/script')+'</script>';
const docx = await read('src/docx.js');
const [template, css, core, session, localFiles, shortcuts, bridge, ui, app, example] = await Promise.all([
  read('src/template.html'), read('src/style.css'), read('src/core.js'),
  read('src/session.js'), read('src/local-files.js'), read('src/shortcuts.js'), read('src/bridge.js'), read('src/ui.js'), read('src/app.js'), readFile(path.join(root, 'examples/demo.html')),
]);
const awaitPdfCss = await read('src/pdf-text-layer.css');
const output = template
  .replace('<!-- HR_STYLES -->', () => `<style>\n${css}\n${awaitPdfCss}\n</style>`)
  .replace('<!-- HR_EXAMPLE -->', () => `<script type="application/json" id="html-review-example">${JSON.stringify({ name: 'demo.html', base64: example.toString('base64') })}</script>`)
  .replace('<!-- HR_SCRIPTS -->', () => [licenseBlock,'<script id="hr-docx-worker" type="text/plain">'+Buffer.from(worker.outputFiles[0].text).toString('base64')+'</script>',script('hr-core', core),script('hr-docx',docx), ...pdfBlocks, script('hr-handoff-library',handoffLibrary.outputFiles[0].text),script('hr-handoff',handoff), script('hr-session', session), script('hr-local-files', localFiles), script('hr-shortcuts', shortcuts), script('hr-bridge', bridge), script('hr-ui', ui), script('hr-app', app)].join('\n'));
if (process.argv.includes('--check')) {
  if (await read('index.html') !== output) throw new Error('index.html is out of date. Run node scripts/build.mjs and commit the generated file.');
  console.log('Generated index.html matches the current source.');
} else {
  await writeFile(path.join(root, 'index.html'), output, 'utf8');
  console.log(`Built index.html (${Buffer.byteLength(output).toLocaleString('en-US')} bytes), no runtime dependencies.`);
}
