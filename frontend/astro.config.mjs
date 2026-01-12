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
        sitemap(),
    ],
    output: 'static',
    image: {
        domains: ['localhost', '127.0.0.1'],
    },
    experimental: {
        // Enable View Transitions
    },
});
