const demo = document.querySelector('#quick-demo');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const toggle = document.querySelector('#demo-toggle');
toggle.hidden = false;
demo.controls = false;
let manualOverride = false;
function updateToggle() { toggle.textContent = demo.paused ? '播放演示 ▷' : '暂停演示 Ⅱ'; }
demo.addEventListener('play', updateToggle);
demo.addEventListener('pause', updateToggle);
toggle.addEventListener('click', async () => {
  autoplayOwned = false;
  manualOverride = true;
  if (demo.paused) {try {await demo.play();} catch (_) {demo.controls = true;}}
  else demo.pause();
});
let autoplayOwned = false;
async function playDemo() {
  if (!motion.matches && !document.hidden && !manualOverride) {
    try { await demo.play(); autoplayOwned = true; } catch (_) { /* Native controls remain available. */ }
  }
}
motion.addEventListener('change', () => { if (motion.matches && autoplayOwned) { demo.pause(); autoplayOwned = false; } });
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) playDemo();
    else if (autoplayOwned) { demo.pause(); autoplayOwned = false; }
  }, {threshold:.3});
  observer.observe(demo);
} else playDemo();
document.addEventListener('visibilitychange', () => { if (document.hidden && autoplayOwned) { demo.pause(); autoplayOwned = false; } });
let toastTimer;
for (const link of document.querySelectorAll('[data-download]')) link.addEventListener('click', () => {
  const status = document.querySelector('.download-status');
  status.textContent = '下载开始后，用浏览器打开 html-review.html 即可使用。';
  status.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { status.hidden = true; }, 6000);
});
