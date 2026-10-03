(() => {
  let saved = 0;
  document.getElementById('save-note').addEventListener('click', () => {
    saved += 1;
    document.getElementById('save-status').textContent = `已记录 ${saved} 次旅程想法。🌿`;
  });
})();
