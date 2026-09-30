// Properties client scripts hang on `window`. Most are "already bound" flags
// that stop a listener being added twice across Astro client navigations.

interface Window {
  // Search.astro
  __searchModalState?: import('./lib/searchTypes').SearchModalState;
  __searchModalKeydownBound?: boolean;
  __searchModalPageLoadBound?: boolean;
  // BottomNav.astro
  __mobileSearchPageLoadBound?: boolean;
  // NewsletterForm.astro
  __newsletterFormInitBound?: boolean;
  kitScriptLoaded?: boolean;
  // Analytics helpers defined inline in BaseLayout.astro (absent until consent).
  trackEvent?: (eventName: string, params?: Record<string, unknown>) => void;
  trackSearch?: (query: string, resultsCount: number) => void;
}
