import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import fs from 'node:fs';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST_DIR = fileURLToPath(new URL('./dist/', import.meta.url));

// Map of canonical path -> YYYY-MM-DD content-modified date, read back from
// the article:modified_time meta each built detail page declares (sourced
// from WordPress `modified`), or og:updated_time on topic hubs. The sitemap runs at astro:build:done, after
// every page is written, so the pages are the single source of truth.
// Date-only because WordPress `modified` carries no timezone and <lastmod>
// requires one when a time is given.
let modifiedByPath;
function pageModifiedDates() {
    if (modifiedByPath) return modifiedByPath;
    modifiedByPath = new Map();
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = nodePath.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.name === 'index.html') {
                const html = fs.readFileSync(full, 'utf8');
                const match = html.match(/<meta property="(?:article:modified_time|og:updated_time)" content="(\d{4}-\d{2}-\d{2})/);
                if (match) {
                    const rel = nodePath.relative(DIST_DIR, nodePath.dirname(full)).split(nodePath.sep).join('/');
                    modifiedByPath.set(`/${rel}`, match[1]);
                }
            }
        }
    };
    walk(DIST_DIR);
    return modifiedByPath;
}

/** Latest modified date among pages under `prefix` (all pages when omitted). */
function latestModified(prefix = '') {
    let latest;
    for (const [p, date] of pageModifiedDates()) {
        if (p.startsWith(prefix) && (!latest || date > latest)) latest = date;
    }
    return latest;
}

// https://astro.build/config
export default defineConfig({
    site: 'https://www.ahmadkarmi.com',
    integrations: [
        tailwind(),
        react(),
        sitemap({
            // `lastmod` is each page's real content-modified date (see
            // pageModifiedDates above). It used to be the build time for every
            // URL, which told Google all 59 pages changed on every deploy, so
            // it learned to ignore the field. Hubs take their newest child's
            // date; pages with no CMS date omit lastmod rather than guess.
            serialize(item) {
                const path = new URL(item.url).pathname.replace(/\/$/, '') || '/';

                // Endpoints (rss.xml, search-index.json, og/*.png share
                // cards) and the /og card preview grid are not content pages.
                // /links is a noindex link-in-bio page.
                if (/\.(xml|json|png)$/.test(path)) return undefined;
                if (path === '/og' || path.startsWith('/og/')) return undefined;
                if (path === '/links') return undefined;

                // The site canonicalises on the no-trailing-slash form, so the
                // sitemap must emit that form too. Previously `path` was used
                // only for the priority matching below and the emitted <loc>
                // kept its slash, which disagreed with every internal link and
                // left Google unable to settle on one URL per page.
                item.url = new URL(path, item.url).toString();

                const lastmod =
                    path === '/' ? latestModified()
                    : path === '/insights' || path === '/portfolio' ? latestModified(`${path}/`)
                    : pageModifiedDates().get(path);
                if (lastmod) item.lastmod = lastmod;
                else delete item.lastmod;

                if (path === '/') {
                    item.priority = 1.0;
                    item.changefreq = 'weekly';
                } else if (['/insights', '/portfolio', '/about'].includes(path)) {
                    item.priority = 0.8;
                    item.changefreq = 'weekly';
                } else if (path.startsWith('/insights/topic/')) {
                    item.priority = 0.7;
                    item.changefreq = 'weekly';
                } else if (path.startsWith('/insights/') || path.startsWith('/portfolio/')) {
                    item.priority = 0.6;
                    item.changefreq = 'monthly';
                } else if (path === '/privacy' || path === '/terms') {
                    item.priority = 0.3;
                    item.changefreq = 'yearly';
                } else {
                    item.priority = 0.5;
                    item.changefreq = 'monthly';
                }

                return item;
            },
        }),
    ],
    output: 'static',
    // Keep 'directory' output (about/index.html) so Vercel's clean-URL
    // resolution keeps working. `trailingSlash` is deliberately left at the
    // default: @astrojs/sitemap applies it AFTER serialize(), and 'never'
    // stripped the root slash too, emitting a bare-origin <loc> for the
    // homepage while its canonical stayed `/`. The no-slash form is enforced
    // by lib/urls.ts and by serialize() above, both of which special-case `/`.
    build: {
        format: 'directory',
        // CSS goes inline in each page instead of separate render-blocking
        // files: on mobile those cost a full round trip (~1s in PageSpeed)
        // before the first paint. Costs ~17KB gzipped per page, uncached.
        inlineStylesheets: 'always',
    },
    image: {
        domains: ['localhost', '127.0.0.1', 'admin.ahmadkarmi.com'],
    },
});
