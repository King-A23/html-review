/* Shared by the workspace and its opaque-origin preview. */
window.HRShortcut = function HRShortcut(event, editable) {
  if (event.altKey || event.isComposing) return null;
  const key = event.key.toLowerCase();
  if (event.ctrlKey || event.metaKey) {
    if (key === 'z' && !editable) return event.shiftKey ? 'redo' : 'undo';
    if (event.shiftKey) return null;
    return {o: 'open', s: 'download', enter: 'save'}[key] || null;
  }
  if (key === 'escape') return 'escape';
  if (editable) return null;
  if (key === '?') return 'help';
  if (event.shiftKey) return null;
  return {v: 'browse', t: 'text', e: 'element', p: 'page', a: 'browse'}[key] || null;
};
