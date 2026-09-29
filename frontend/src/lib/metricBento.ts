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

// TEMPORARY iPhone diagnosis: ?mbtest=<a,b,...> strips one suspect at a time
// so a real device can show which one stops iOS treating the row as a
// horizontal scroller. Remove together with the ?touchdebug panel.
function applyTestToggles(row: HTMLElement): Set<string> {
  const raw = new URLSearchParams(location.search).get('mbtest') || '';
  const t = new Set(raw.split(',').filter(Boolean));
  if (t.has('all')) ['nopulse', 'noreveal', 'nooverlay', 'noopacity', 'wrap'].forEach((k) => t.add(k));
  if (t.has('nopulse')) row.querySelectorAll('.animate-pulse').forEach((el) => el.classList.remove('animate-pulse'));
  if (t.has('nooverlay')) row.querySelectorAll('.metric-card > .pointer-events-none').forEach((el) => el.remove());
  if (t.has('noopacity')) row.querySelectorAll('.opacity-60').forEach((el) => el.classList.remove('opacity-60'));
  if (t.has('wrap')) {
    row.querySelectorAll<HTMLElement>(':scope > .metric-card').forEach((card) => {
      const wrap = document.createElement('div');
      wrap.className = 'min-w-[70vw] md:min-w-0 snap-center';
      card.classList.remove('min-w-[70vw]', 'md:min-w-0', 'snap-center');
      card.parentNode!.insertBefore(wrap, card);
      wrap.appendChild(card);
    });
  }
  if (t.size) {
    const tag = document.createElement('p');
    tag.textContent = 'mbtest: ' + [...t].join(', ');
    tag.style.cssText = 'font:12px ui-monospace,monospace;color:#d00;margin:0 0 8px';
    row.parentElement!.insertBefore(tag, row);
  }
  return t;
}

function init() {
  const row = document.querySelector<HTMLElement>('[data-metrics-row]');
  if (!row || row.dataset.metricsBound) return;
  row.dataset.metricsBound = 'true';

  const tests = applyTestToggles(row);
  if (tests.has('noreveal')) return;

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
