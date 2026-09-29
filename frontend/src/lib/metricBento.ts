// Reveal + count-up for the "Results That Speak" row (components/MetricBento.astro).
//
// Progressive enhancement only: the server-rendered cards and figures are
// complete without this. One IntersectionObserver watches the row as it
// enters the viewport vertically. Nothing observes individual cards, because
// on phones they sit inside a horizontal scroller where per-card visibility
// is unreliable on iPhone.

function countUp(el: HTMLElement) {
  const target = el.dataset.countTo || '';
  const match = target.match(/[\d.]+/);
  if (!match) return;
  const end = parseFloat(match[0]);
  const decimals = match[0].includes('.') ? match[0].split('.')[1].length : 0;
  const [before, after] = target.split(match[0]);
  const duration = 2000;
  const start = performance.now();

  const frame = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = before + (end * eased).toFixed(decimals) + after;
    if (t < 1) requestAnimationFrame(frame);
    else el.textContent = target;
  };
  requestAnimationFrame(frame);
}

function init() {
  const row = document.querySelector<HTMLElement>('[data-metrics-row]');
  if (!row || row.dataset.metricsBound) return;
  row.dataset.metricsBound = 'true';

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!('IntersectionObserver' in window)) return;

  // Only hide the cards for the reveal when the row is still below the fold,
  // so nothing ever blinks out once it is on screen.
  const belowFold = row.getBoundingClientRect().top > window.innerHeight;
  if (belowFold) row.dataset.reveal = 'pending';

  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      delete row.dataset.reveal;
      if (belowFold) {
        row.querySelectorAll<HTMLElement>('[data-count-to]').forEach(countUp);
      }
    },
    { threshold: 0.2 }
  );
  observer.observe(row);
}

// astro:page-load fires on the first load and after every client navigation.
document.addEventListener('astro:page-load', init);
