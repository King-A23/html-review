import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = name => readFile(path.join(root, name), 'utf8');
const script = (id, content) => `<script id="${id}">\n${content.replace(/<\/script/gi, '<\\/script')}\n</script>`;
const [template, css, core, session, shortcuts, bridge, ui, app, example] = await Promise.all([
  read('src/template.html'), read('src/style.css'), read('src/core.js'),
  read('src/session.js'), read('src/shortcuts.js'), read('src/bridge.js'), read('src/ui.js'), read('src/app.js'), readFile(path.join(root, 'examples/demo.html')),
]);
const output = template
  .replace('<!-- HR_STYLES -->', `<style>\n${css}\n</style>`)
  .replace('<!-- HR_EXAMPLE -->', `<script type="application/json" id="html-review-example">${JSON.stringify({ name: 'demo.html', base64: example.toString('base64') })}</script>`)
  .replace('<!-- HR_SCRIPTS -->', [script('hr-core', core), script('hr-session', session), script('hr-shortcuts', shortcuts), script('hr-bridge', bridge), script('hr-ui', ui), script('hr-app', app)].join('\n'));
if (process.argv.includes('--check')) {
  if (await read('index.html') !== output) throw new Error('index.html is out of date. Run node scripts/build.mjs and commit the generated file.');
  console.log('Generated index.html matches the current source.');
} else {
  await writeFile(path.join(root, 'index.html'), output, 'utf8');
  console.log(`Built index.html (${Buffer.byteLength(output).toLocaleString('en-US')} bytes), no runtime dependencies.`);
}
