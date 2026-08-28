// Canonical URL construction, single source of truth.
//
// The site standardises on the NO-trailing-slash form. Astro builds with
// `build.format: 'directory'`, so `Astro.url.pathname` is `/about/` at build
// time, while every internal link, the RSS feed, the JSON-LD and llms.txt all
// use `/about`. Left unreconciled that produced two independently-live 200s
// per page and stalled indexing: Google crawled the linked no-slash form, read
// a canonical pointing at the slash form, and deferred.
//
// Normalising explicitly here rather than relying on `trailingSlash` config
// keeps the emitted form independent of Astro's internal pathname derivation.

import { SITE_URL } from './schema';

export { SITE_URL };

/**
 * Strip a trailing slash from a path, except from the site root.
 * `/about/` -> `/about`, `/` -> `/`, `''` -> `/`
 */
export function canonicalPath(pathname: string): string {
    if (!pathname) return '/';
    const trimmed = pathname.replace(/\/+$/, '');
    return trimmed === '' ? '/' : trimmed;
}

/** Absolute canonical URL for a path, in the no-trailing-slash form. */
export function absoluteUrl(pathname: string): string {
    return new URL(canonicalPath(pathname), SITE_URL).toString();
}
