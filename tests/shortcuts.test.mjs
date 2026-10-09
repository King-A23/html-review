import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const context = {window: {}};
vm.runInNewContext(await readFile(new URL('../src/shortcuts.js', import.meta.url), 'utf8'), context);
const classify = (key, editable = false, modifiers = {}) => context.window.HRShortcut({key, ...modifiers}, editable);

test('both Control and Command expose the documented file and annotation commands', () => {
  for (const modifier of ['ctrlKey', 'metaKey']) {
    assert.equal(classify('O', true, {[modifier]: true}), 'open');
    assert.equal(classify('s', true, {[modifier]: true}), 'download');
    assert.equal(classify('Enter', true, {[modifier]: true}), 'save');
    assert.equal(classify('z', false, {[modifier]: true}), 'undo');
    assert.equal(classify('Z', false, {[modifier]: true, shiftKey: true}), 'redo');
    assert.equal(classify('z', true, {[modifier]: true}), null, 'native input undo must remain available');
  }
});

test('editable fields, IME composition and unrelated modifier combinations retain their native keys', () => {
  for (const key of ['v', 't', 'e', 'p', 'a', '?']) {
    assert.equal(classify(key, true), null);
    assert.equal(classify(key, false, {isComposing: true}), null);
    assert.equal(classify(key, false, {altKey: true}), null);
  }
  assert.equal(classify('s', false, {ctrlKey: true, shiftKey: true}), null);
  assert.equal(classify('Enter', false, {ctrlKey: true, altKey: true}), null);
  assert.equal(classify('f', false, {metaKey: true}), null, 'find is a browser action');
  assert.equal(classify('Escape', true), 'escape');
  assert.equal(classify('?', false, {shiftKey: true}), 'help');
  assert.deepEqual(['v', 't', 'e', 'p', 'a'].map(key => classify(key)), ['browse', 'text', 'element', 'page', 'browse']);
});
