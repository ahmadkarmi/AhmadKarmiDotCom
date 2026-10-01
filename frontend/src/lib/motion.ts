// Site-wide motion that is not tied to one component. Styles live in
// global.css under the same names.
//
// 1. Card to article: when an insight card is clicked, its image glides into
//    the article's hero image (and back again on the way out). The shared
//    view-transition name is set only on the one card involved, at click
//    time: naming every card up front would snapshot every card on every
//    navigation, and two elements with one name cancels the transition.
// 2. Scroll reveals: elements marked [data-reveal] fade up once as they come
//    into view. Only elements that start below the fold are hidden, and only
//    once this script runs, so nothing flashes and no-JS readers and
//    crawlers always see the content.
//
// Both are skipped under prefers-reduced-motion.

const HERO_NAME = 'insight-hero';
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The article path for an /insights/<slug> URL, else null. */
function articlePath(url: URL | undefined): string | null {
  if (!url || url.origin !== location.origin) return null;
  return /^\/insights\/(?!topic\/)[^/]+$/.test(url.pathname) ? url.pathname : null;
}

function setName(el: Element | null | undefined, name: string) {
  if (el instanceof HTMLElement) el.style.viewTransitionName = name;
}

// Going to an article from a card: name the clicked card's image. If we are
// on an article already (a related card), the current hero must give up the
// name first.
document.addEventListener('astro:before-preparation', (event) => {
  // A card named by the previous navigation (the one we came back to) must
  // not keep the name, or it would clash with the card clicked now.
  document.querySelectorAll('[data-vt-img]').forEach((el) => setName(el, ''));
  if (reduceMotion() || !articlePath(event.to)) return;
  const link = event.sourceElement?.closest('a');
  const img = link?.querySelector('[data-vt-img]');
  if (!img) return;
  document.querySelectorAll('[data-vt-hero]').forEach((hero) => setName(hero, 'none'));
  setName(img, HERO_NAME);
});

// Leaving an article: name the incoming page's card for it, if there is one,
// so the hero shrinks back into place.
document.addEventListener('astro:before-swap', (event) => {
  const from = articlePath(event.from);
  if (reduceMotion() || !from || articlePath(event.to)) return;
  const img = event.newDocument.querySelector(`a[href="${from}"] [data-vt-img]`);
  setName(img, HERO_NAME);
});

function initReveals() {
  if (reduceMotion() || !('IntersectionObserver' in window)) return;
  const pending = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]:not([data-reveal-state])'))
    .filter((el) => el.getBoundingClientRect().top > window.innerHeight);
  if (!pending.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        (entry.target as HTMLElement).dataset.revealState = 'shown';
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px' }
  );
  for (const el of pending) {
    el.dataset.revealState = 'pending';
    observer.observe(el);
  }
}

// astro:page-load fires on the first load and after every client navigation.
document.addEventListener('astro:page-load', initReveals);
