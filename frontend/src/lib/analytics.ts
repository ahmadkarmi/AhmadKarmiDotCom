// Google Analytics 4 — single source of truth for event tracking.
//
// The GA bootstrap (gtag, Consent Mode v2, page_view) lives inline in
// BaseLayout.astro because it must run early. THIS module owns every custom
// event: the taxonomy below is the canonical list, and `initAutoTracking()`
// wires the delegated DOM listeners that emit them.
//
// Event names are snake_case and deliberately chosen NOT to collide with GA4
// Enhanced Measurement's automatic events (page_view, scroll, click,
// file_download, view_search_results, form_start/form_submit) — so both can
// run without double-counting.
//
// ┌─ Event ───────────┬─ Fires when ───────────────────┬─ Key params ──────────────┐
// │ outbound_click    │ click a link to another domain │ link_url, link_domain,    │
// │                   │                                │ link_type, page_path      │
// │ cta_click         │ click a .btn-* call to action  │ cta_text, page_path       │
// │ cv_download       │ click a download link (the CV) │ file_name, page_path      │
// │ scroll_depth      │ page scrolled to 25/50/75/100% │ percent, page_path        │
// │ search            │ site search performed          │ search_term, results_count│
// │ newsletter_signup │ Kit newsletter form submitted  │ form_location             │
// │ share             │ share / copy-link button used  │ method, item_url          │
// │ select_content    │ click an insight/portfolio card│ content_type, item_id     │
// └───────────────────┴────────────────────────────────┴───────────────────────────┘
//
// Emitted elsewhere (already wired in their own components):
//   generate_lead, contact_form_error  — ContactForm.astro
//   ask_ahmad_*                        — components/ask-ahmad/Chat.tsx

type Params = Record<string, unknown>;

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    trackEvent?: (name: string, params?: Params) => void;
    __autoTrackingBound?: boolean;
  }
}

/** Canonical event names. Reference these instead of hard-coding strings. */
export const EVENTS = {
  outboundClick: 'outbound_click',
  ctaClick: 'cta_click',
  cvDownload: 'cv_download',
  scrollDepth: 'scroll_depth',
  search: 'search',
  newsletterSignup: 'newsletter_signup',
  share: 'share',
  selectContent: 'select_content',
} as const;

/** Low-level send. Routes through window.trackEvent (defined in BaseLayout). */
export function track(name: string, params: Params = {}): void {
  if (typeof window === 'undefined') return;
  if (typeof window.trackEvent === 'function') {
    window.trackEvent(name, params);
  } else if (typeof window.gtag === 'function') {
    window.gtag('event', name, params);
  }
}

const pagePath = () =>
  typeof window !== 'undefined' ? window.location.pathname + window.location.search : '';

/** Classify an outbound URL into a coarse channel for cleaner reports. */
function linkType(url: string): string {
  if (url.startsWith('mailto:')) return 'email';
  if (/linkedin\.com/i.test(url)) return 'linkedin';
  if (/threads\.(net|com)/i.test(url)) return 'threads';
  if (/github\.com/i.test(url)) return 'github';
  if (/(twitter|x)\.com/i.test(url)) return 'twitter';
  return 'other';
}

/**
 * Wire all delegated DOM listeners. Safe to call once per page load — the
 * listeners attach to `document`, so they survive Astro view transitions.
 */
export function initAutoTracking(): void {
  if (typeof document === 'undefined' || window.__autoTrackingBound) return;
  window.__autoTrackingBound = true;

  // --- Clicks: outbound links, CTAs, downloads, shares, content cards -------
  document.addEventListener(
    'click',
    (e) => {
      const target = e.target as Element | null;
      if (!target || !target.closest) return;

      // Share / copy-link buttons (data-share-method set in ShareButtons.astro).
      const shareEl = target.closest('[data-share-method]') as HTMLElement | null;
      if (shareEl) {
        track(EVENTS.share, {
          method: shareEl.dataset.shareMethod,
          item_url: shareEl.dataset.shareUrl || window.location.href,
          page_path: pagePath(),
        });
        return;
      }

      const link = target.closest('a') as HTMLAnchorElement | null;
      if (link) {
        const rawHref = link.getAttribute('href') || '';
        const isMailto = rawHref.startsWith('mailto:');

        // File downloads (the CV button carries a `download` attribute).
        if (link.hasAttribute('download')) {
          track(EVENTS.cvDownload, {
            file_name: (link.href || '').split('/').pop() || 'file',
            page_path: pagePath(),
          });
          return;
        }

        // Outbound: mailto, or any link to a different hostname.
        let isOutbound = isMailto;
        if (!isOutbound && /^https?:\/\//i.test(rawHref)) {
          try {
            isOutbound = new URL(link.href).hostname !== window.location.hostname;
          } catch {
            isOutbound = false;
          }
        }
        if (isOutbound) {
          let domain = '';
          try {
            domain = isMailto ? 'email' : new URL(link.href).hostname;
          } catch {
            domain = 'unknown';
          }
          track(EVENTS.outboundClick, {
            link_url: link.href,
            link_domain: domain,
            link_type: linkType(rawHref),
            page_path: pagePath(),
          });
          return;
        }

        // Internal: clicking an insight or portfolio card (detail-page links).
        const contentMatch = rawHref.match(/^\/(insights|portfolio)\/([^/?#]+)\/?$/);
        if (contentMatch) {
          track(EVENTS.selectContent, {
            content_type: contentMatch[1] === 'insights' ? 'insight' : 'portfolio',
            item_id: contentMatch[2],
            page_path: pagePath(),
          });
          return;
        }
      }

      // Call-to-action buttons (not already handled as outbound links above).
      const cta = target.closest('.btn-primary, .btn-secondary, [class*="btn-"]') as HTMLElement | null;
      if (cta) {
        track(EVENTS.ctaClick, {
          cta_text: (cta.textContent || '').trim().slice(0, 100) || 'Button',
          page_path: pagePath(),
        });
      }
    },
    { capture: true, passive: true }
  );

  // --- Newsletter signups (Kit.com inline form) ----------------------------
  document.addEventListener(
    'submit',
    (e) => {
      const form = e.target as HTMLElement | null;
      if (form && form.matches && form.matches('form[data-sv-form]')) {
        track(EVENTS.newsletterSignup, { form_location: pagePath() });
      }
    },
    { capture: true }
  );

  // --- Scroll depth: 25 / 50 / 75 / 100%, once each, reset per page --------
  let depthHit: Record<number, boolean> = { 25: false, 50: false, 75: false, 100: false };
  const onScroll = () => {
    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;
    if (max <= 0) return;
    const percent = Math.round((window.scrollY / max) * 100);
    for (const marker of [25, 50, 75, 100]) {
      if (percent >= marker && !depthHit[marker]) {
        depthHit[marker] = true;
        track(EVENTS.scrollDepth, { percent: marker, page_path: pagePath() });
      }
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  // Astro view transitions keep the document alive — reset markers per page.
  document.addEventListener('astro:after-swap', () => {
    depthHit = { 25: false, 50: false, 75: false, 100: false };
  });
}
