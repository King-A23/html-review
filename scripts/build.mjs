import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = name => readFile(path.join(root, name), 'utf8');
const script = (id, content) => `<script id="${id}">\n${content.replace(/<\/script/gi, '<\\/script')}\n</script>`;
const worker = await build({entryPoints:[path.join(root,'src/docx-worker.js')],bundle:true,platform:'browser',format:'iife',write:false,minify:true,legalComments:'inline',metafile:true});
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
const output = template
  .replace('<!-- HR_STYLES -->', () => `<style>\n${css}\n</style>`)
  .replace('<!-- HR_EXAMPLE -->', () => `<script type="application/json" id="html-review-example">${JSON.stringify({ name: 'demo.html', base64: example.toString('base64') })}</script>`)
  .replace('<!-- HR_SCRIPTS -->', () => [licenseBlock,'<script id="hr-docx-worker" type="text/plain">'+Buffer.from(worker.outputFiles[0].text).toString('base64')+'</script>',script('hr-core', core),script('hr-docx',docx), script('hr-session', session), script('hr-local-files', localFiles), script('hr-shortcuts', shortcuts), script('hr-bridge', bridge), script('hr-ui', ui), script('hr-app', app)].join('\n'));
if (process.argv.includes('--check')) {
  if (await read('index.html') !== output) throw new Error('index.html is out of date. Run node scripts/build.mjs and commit the generated file.');
  console.log('Generated index.html matches the current source.');
} else {
  await writeFile(path.join(root, 'index.html'), output, 'utf8');
  console.log(`Built index.html (${Buffer.byteLength(output).toLocaleString('en-US')} bytes), no runtime dependencies.`);
}
