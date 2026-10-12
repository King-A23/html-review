/* Reproduce navigation/resize cancellation at real asynchronous PDF render boundaries. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source = await readFile(new URL('../src/pdf.js', import.meta.url), 'utf8');
function deferred() {
  let resolve;
  const promise = new Promise(done => {resolve = done;});
  return {promise, resolve};
}
function element() {
  return {
    dataset: {}, style: {}, children: [],
    append(...nodes) {this.children.push(...nodes);},
    replaceChildren(...nodes) {this.children = nodes;},
    setAttribute() {}, addEventListener() {},
    getContext() {return {save() {}, setTransform() {}, restore() {}};},
    getBoundingClientRect() {return {left: 0, top: 0};},
  };
}
test('PDF navigation during text/link rendering cannot cache an incomplete page as rendered', async () => {
  for (const boundary of ['text', 'links']) {
    const paused = deferred(), resume = deferred();
    let textCalls = 0, annotationCalls = 0;
    const context = {setTimeout, clearTimeout, HRCore: {}, document: {createElement: element}, addEventListener() {}};
    context.window = context;
    context.HRPdfLib = {
      AnnotationMode: {ENABLE: 1},
      TextLayer: class {
        textDivs = [];
        cancel() {}
        async render() {
          if (boundary === 'text' && ++textCalls === 1) {paused.resolve(); await resume.promise;}
        }
      },
    };
    const marker = 'global.HRPdf=Object.freeze({';
    assert.equal(source.split(marker).length, 2);
    vm.runInNewContext(source.replace(marker, 'global.HRPdf=Object.freeze({_render:renderSlot,'), context);
    const page = {
      render() {return {promise: Promise.resolve(), cancel() {}};},
      async getAnnotations() {
        // nativeNotes reads first; links reads second.
        if (boundary === 'links' && ++annotationCalls === 2) {paused.resolve(); await resume.promise;}
        return [{subtype: 'Link', dest: [2], rect: [0, 0, 40, 20]}];
      },
    };
    const slot = {number: 1, node: element(), viewport: {width: 600, height: 800, convertToViewportPoint: (x, y) => [x, y]}};
    const session = {
      destroyed: false, renderGeneration: 1, mode: 'browse', slots: [slot], searchMatches: [],
      contents: new Map([[1, {value: {items: []}, stream: 'page text', starts: []}]]),
      doc: {async getPage() {return page;}}, container: {querySelectorAll: () => []},
    };
    const pending = context.HRPdf._render(session, slot, 1);
    await paused.promise;
    session.renderGeneration = 2;
    resume.resolve();
    await pending;
    assert.equal(slot.node.dataset.rendered, 'false', `${boundary}: canceled page must remain eligible for rendering`);
    assert.equal(slot.node.children.length, 0, `${boundary}: canceled layers must be cleared`);
    await context.HRPdf._render(session, slot, 2);
    assert.equal(slot.node.dataset.rendered, 'true');
    assert.equal(slot.node.children.filter(node => node.className === 'pdf-link').length, 1, `${boundary}: current render must restore internal links`);
  }
});
