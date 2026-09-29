// Share card URLs and the hero-image fallback chain, kept free of the
// satori / sharp imports in render.ts so detail pages can use them cheaply.

import type { Insight, Work } from '../wordpress';
import { getMediaUrl } from '../wordpress';

export const DEFAULT_SOCIAL_CARD = '/brand/social-card.png';

export const OG_CARD_SIZE = { width: 1200, height: 630 } as const;

// `mainImage` is already "ACF mainImage, else the WP featured image" (see
// transformInsight / transformWork), so read the resolved field, never acf.*
// or _embedded directly. Resolve each candidate to a URL separately:
// getMediaUrl rejects disallowed hosts, and an unusable main image should
// still fall through to the next slot.

/** Insight hero: main image (or featured), then thumbnail. */
export function resolveInsightHeroUrl(insight: Pick<Insight, 'mainImage' | 'thumbnailImage'>): string | null {
    return getMediaUrl(insight.mainImage) || getMediaUrl(insight.thumbnailImage) || null;
}

/** Work hero: main image (or featured), then cover. */
export function resolveWorkHeroUrl(work: Pick<Work, 'mainImage' | 'coverImage'>): string | null {
    return getMediaUrl(work.mainImage) || getMediaUrl(work.coverImage) || null;
}

/** Share card URL, versioned so LinkedIn / WhatsApp refetch after an edit. */
export function ogCardPath(type: 'insights' | 'portfolio', slug: string, version?: string): string {
    const stamp = version ? Date.parse(version) : NaN;
    const base = `/og/${type}/${slug}.png`;
    return Number.isFinite(stamp) ? `${base}?v=${Math.floor(stamp / 1000)}` : base;
}
