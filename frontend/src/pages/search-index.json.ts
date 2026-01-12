import type { APIRoute } from 'astro';

import {
    fetchAboutPage,
    fetchContactPage,
    fetchInsights,
    fetchWorks,
    getMediaUrl,
    normalizeWpRichText,
} from '../lib/wordpress';

type SearchIndexItemType = 'insight' | 'portfolio' | 'page';

type SearchIndexItem = {
    id: string;
    type: SearchIndexItemType;
    title: string;
    url: string;
    description?: string;
    image?: string;
    imageAlt?: string;
    tags?: string[];
    publishDate?: string;
    readTime?: number;
    client?: string;
    clientLogo?: string;
    status?: string;
    featured?: boolean;
    text: string;
};

export const prerender = true;

function stripHtml(input: string): string {
    return String(input || '')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]*>/g, ' ');
}

function decodeHtmlEntities(input: string): string {
    const named: Record<string, string> = {
        amp: '&',
        lt: '<',
        gt: '>',
        quot: '"',
        apos: "'",
        nbsp: ' ',
    };

    return String(input || '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
        if (!entity) return match;
        if (entity[0] === '#') {
            const isHex = entity[1]?.toLowerCase() === 'x';
            const num = isHex ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
            if (!Number.isFinite(num)) return match;
            try {
                return String.fromCodePoint(num);
            } catch {
                return match;
            }
        }

        const lower = entity.toLowerCase();
        return Object.prototype.hasOwnProperty.call(named, lower) ? named[lower] : match;
    });
}

function normalizeText(input?: string | null): string {
    if (!input) return '';
    const normalized = normalizeWpRichText(input) || input;
    return decodeHtmlEntities(stripHtml(normalized))
        .replace(/\s+/g, ' ')
        .trim();
}

function wordCount(input: string): number {
    const tokens = String(input || '')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean);
    return tokens.length;
}

function estimateReadTimeMinutes(text: string): number {
    const wpm = 200;
    const count = wordCount(text);
    return Math.max(1, Math.ceil(count / wpm));
}

export const GET: APIRoute = async () => {
    const [insights, works, aboutPage, contactPage] = await Promise.all([
        fetchInsights(),
        fetchWorks(),
        fetchAboutPage(),
        fetchContactPage(),
    ]);

    const items: SearchIndexItem[] = [];

    for (const insight of insights) {
        const imageMedia = insight.mainImage || insight.thumbnailImage;
        const image = imageMedia ? getMediaUrl(imageMedia) || undefined : undefined;
        const bodyText = normalizeText(insight.body);
        const description = normalizeText(insight.description) || bodyText.slice(0, 220);
        const tags = Array.isArray(insight.tags) ? insight.tags.filter(Boolean) : undefined;
        const combinedText = [insight.name, description, tags?.join(' '), bodyText].filter(Boolean).join(' ');

        items.push({
            id: `insight:${insight.slug}`,
            type: 'insight',
            title: insight.name,
            url: `/insights/${insight.slug}/`,
            description,
            image,
            imageAlt: imageMedia?.alt_text || insight.name,
            tags,
            publishDate: insight.publishDate,
            readTime: estimateReadTimeMinutes(combinedText),
            featured: insight.featured,
            text: combinedText,
        });
    }

    for (const work of works) {
        const heroMedia = work.coverImage || work.mainImage;
        const image = heroMedia ? getMediaUrl(heroMedia) || undefined : undefined;
        const clientLogo = work.clientLogo ? getMediaUrl(work.clientLogo) || undefined : undefined;
        const briefText = normalizeText(work.brief);
        const scopeText = normalizeText(work.scope);
        const detailsText = normalizeText(work.details);
        const description = briefText || detailsText || scopeText;
        const combinedText = [work.name, work.client, work.status, description, scopeText, detailsText].filter(Boolean).join(' ');

        items.push({
            id: `portfolio:${work.slug}`,
            type: 'portfolio',
            title: work.name,
            url: `/portfolio/${work.slug}/`,
            description: description ? description.slice(0, 260) : undefined,
            image,
            imageAlt: heroMedia?.alt_text || work.name,
            client: work.client,
            clientLogo,
            status: work.status,
            featured: work.featured,
            text: combinedText,
        });
    }

    const aboutText = [
        aboutPage?.heroTitle,
        aboutPage?.heroText,
        aboutPage?.bioName,
        aboutPage?.bioRole,
        aboutPage?.bioLocation,
    ]
        .map((v) => normalizeText(v || ''))
        .filter(Boolean)
        .join(' ');

    if (aboutText) {
        items.push({
            id: 'page:about',
            type: 'page',
            title: 'About',
            url: '/about/',
            description: normalizeText(aboutPage?.heroText || '').slice(0, 220) || undefined,
            image: '/brand/logo-mark.png',
            imageAlt: 'Ahmad Al-Karmi',
            text: aboutText,
        });
    }

    const contactText = [contactPage?.heroTitle, contactPage?.heroText, contactPage?.formTitle]
        .map((v) => normalizeText(v || ''))
        .filter(Boolean)
        .join(' ');

    if (contactText) {
        items.push({
            id: 'page:contact',
            type: 'page',
            title: 'Contact',
            url: '/contact/',
            description: normalizeText(contactPage?.heroText || '').slice(0, 220) || undefined,
            image: '/brand/logo-mark.png',
            imageAlt: 'Ahmad Al-Karmi',
            text: contactText,
        });
    }

    items.push({
        id: 'page:home',
        type: 'page',
        title: 'Home',
        url: '/',
        description: 'Ahmad Al-Karmi — Product Manager, Digital Strategist, and Creative Technologist',
        image: '/brand/logo-mark.png',
        imageAlt: 'Ahmad Al-Karmi',
        text: 'Ahmad Al-Karmi Product Manager Digital Strategist Creative Technologist Portfolio Insights Contact About',
    });

    items.push({
        id: 'page:portfolio',
        type: 'page',
        title: 'Portfolio',
        url: '/portfolio/',
        description: 'Selected product and design work.',
        image: '/brand/logo-mark.png',
        imageAlt: 'Ahmad Al-Karmi',
        text: 'Portfolio Work Projects Case studies Products',
    });

    items.push({
        id: 'page:insights',
        type: 'page',
        title: 'Insights',
        url: '/insights/',
        description: 'Articles on product strategy, AI, and digital transformation.',
        image: '/brand/logo-mark.png',
        imageAlt: 'Ahmad Al-Karmi',
        text: 'Insights Articles Product strategy AI Digital transformation',
    });

    const body = JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), items });

    return new Response(body, {
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=600',
        },
    });
};
