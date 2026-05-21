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

                // Endpoints (rss.xml, search-index.json) are not content pages.
                if (/\.(xml|json)$/.test(path)) return undefined;

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
    image: {
        domains: ['localhost', '127.0.0.1', 'admin.ahmadkarmi.com'],
    },
});
