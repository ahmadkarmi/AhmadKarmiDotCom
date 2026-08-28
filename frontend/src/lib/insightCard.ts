// Shared read-time logic and the slim card shape handed to the /insights filter.
//
// `Insight` carries `body`, the complete rendered article HTML, because no WP
// list endpoint passes `_fields`. Passing the full array to the `client:load`
// React island serialised all 38 bodies into a single `props` attribute:
// 538KB, 72% of the document, pushing the first card to byte 590,053 and
// making the page read as empty to anything with a byte budget.
//
// `toCardData` is the boundary: everything the card actually renders, nothing
// it does not. Read time is precomputed here so `body` never crosses over.

import type { Insight } from './wordpress';
import { getMediaUrl } from './wordpress';

export interface InsightCardData {
    id?: number;
    slug: string;
    name: string;
    description?: string;
    publishDate?: string;
    tags?: string[];
    featured?: boolean;
    imageUrl: string | null;
    readTime: number;
}

/** Words-per-minute read time from rendered HTML. */
export function calculateReadTime(text?: string): number {
    if (!text) return 1;
    const wordsPerMinute = 200;
    const words = text.replace(/<[^>]+>/g, '').split(/\s+/).length;
    return Math.max(1, Math.ceil(words / wordsPerMinute));
}

/** Reduce a full Insight to only what the card renders. */
export function toCardData(insight: Insight): InsightCardData {
    return {
        id: insight.id,
        slug: insight.slug,
        name: insight.name,
        description: insight.description,
        publishDate: insight.publishDate,
        tags: insight.tags,
        featured: insight.featured,
        imageUrl: getMediaUrl(insight.mainImage) || getMediaUrl(insight.thumbnailImage) || null,
        readTime: calculateReadTime(insight.body),
    };
}
