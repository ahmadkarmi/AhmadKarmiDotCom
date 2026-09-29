import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
    site: 'https://www.ahmadkarmi.com',
    integrations: [
        tailwind(),
        react(),
        sitemap({
            // Give every URL a build-time `lastmod` (the whole static site is
            // rebuilt whenever WordPress content changes, so build time is an
            // honest freshness signal) plus path-based priority/changefreq so
            // crawlers know which pages matter most.
            serialize(item) {
                const path = new URL(item.url).pathname.replace(/\/$/, '') || '/';

                // Endpoints (rss.xml, search-index.json, og/*.png share
                // cards) and the /og card preview grid are not content pages.
                if (/\.(xml|json|png)$/.test(path)) return undefined;
                if (path === '/og' || path.startsWith('/og/')) return undefined;

                // The site canonicalises on the no-trailing-slash form, so the
                // sitemap must emit that form too. Previously `path` was used
                // only for the priority matching below and the emitted <loc>
                // kept its slash, which disagreed with every internal link and
                // left Google unable to settle on one URL per page.
                item.url = new URL(path, item.url).toString();

                item.lastmod = new Date().toISOString();

                if (path === '/') {
                    item.priority = 1.0;
                    item.changefreq = 'weekly';
                } else if (['/insights', '/portfolio', '/about'].includes(path)) {
                    item.priority = 0.8;
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
    },
    image: {
        domains: ['localhost', '127.0.0.1', 'admin.ahmadkarmi.com'],
    },
});
