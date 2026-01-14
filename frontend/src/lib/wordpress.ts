// WordPress API client for fetching data (Headless CMS)

const WP_URL = import.meta.env.PUBLIC_WP_URL || 'https://admin.ahmadkarmi.com';
const WP_USER = import.meta.env.WP_USER || 'admin';
const WP_APP_PASSWORD = import.meta.env.WP_APP_PASSWORD || '';

const SITE_URL = import.meta.env.PUBLIC_SITE_URL || 'https://www.ahmadkarmi.com';
const WP_HOST = (() => {
    try {
        return new URL(WP_URL).hostname;
    } catch {
        return null;
    }
})();

const SITE_HOST = (() => {
    try {
        return new URL(SITE_URL).hostname;
    } catch {
        return null;
    }
})();

function normalizeHost(host: string | null): string | null {
    if (!host) return null;
    return String(host).toLowerCase().replace(/^www\./, '');
}

const WP_HOST_NORMALIZED = normalizeHost(WP_HOST);
const SITE_HOST_NORMALIZED = normalizeHost(SITE_HOST);

function isAllowedContentHost(host: string | null): boolean {
    const normalized = normalizeHost(host);
    if (!normalized) return false;
    const allowedWp = WP_HOST_NORMALIZED !== null && normalized === WP_HOST_NORMALIZED;
    const allowedSite = SITE_HOST_NORMALIZED !== null && normalized === SITE_HOST_NORMALIZED;
    return allowedWp || allowedSite;
}

function isAllowedContentUrl(url: string): boolean {
    const value = String(url || '');
    if (value.startsWith('/')) return true;
    try {
        const u = new URL(value);
        return isAllowedContentHost(u.hostname);
    } catch {
        return false;
    }
}

/**
 * Transform admin domain URLs to frontend domain URLs.
 * Use this for canonical URLs, page links, and metadata.
 * DO NOT use this for media/image URLs - those should stay on admin domain.
 */
export function transformAdminUrlToFrontend(url: string | null | undefined): string | null {
    if (!url || typeof url !== 'string') return null;
    const trimmed = url.trim();
    if (!trimmed) return null;

    try {
        const parsed = new URL(trimmed);
        const normalizedHost = normalizeHost(parsed.hostname);
        
        if (normalizedHost === WP_HOST_NORMALIZED) {
            parsed.hostname = new URL(SITE_URL).hostname;
            parsed.protocol = 'https:';
            return parsed.toString();
        }
        return trimmed;
    } catch {
        if (trimmed.startsWith('/')) {
            return `${SITE_URL}${trimmed}`;
        }
        return trimmed;
    }
}

/**
 * Check if a URL is a media/asset URL that should NOT be transformed.
 * Media files should stay on the admin domain.
 */
function isMediaUrl(url: string): boolean {
    if (!url) return false;
    const mediaPatterns = [
        '/wp-content/uploads/',
        '/wp-includes/',
        '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg',
        '.pdf', '.doc', '.docx', '.mp4', '.mp3', '.wav'
    ];
    const lower = url.toLowerCase();
    return mediaPatterns.some(pattern => lower.includes(pattern));
}

/**
 * Transform URL strings in content, replacing admin domain with frontend domain.
 * Preserves media URLs on the admin domain.
 */
export function transformContentUrls(content: string | null | undefined): string | null {
    if (!content || typeof content !== 'string') return null;
    
    const wpUrlPattern = new RegExp(
        WP_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'gi'
    );
    
    return content.replace(wpUrlPattern, (match, offset, fullString) => {
        const afterMatch = fullString.slice(offset + match.length, offset + match.length + 100);
        if (isMediaUrl(afterMatch)) {
            return match;
        }
        return SITE_URL;
    });
}

function base64Encode(value: string): string {
    if (typeof btoa === 'function') {
        return btoa(value);
    }
    const buffer = (globalThis as any)?.Buffer;
    if (buffer?.from) {
        return buffer.from(value).toString('base64');
    }

    throw new Error('No base64 encoder available in this environment');
}

function getHeaders(): HeadersInit {
    const headers: HeadersInit = {
        'Content-Type': 'application/json',
    };
    if (WP_APP_PASSWORD) {
        const credentials = base64Encode(`${WP_USER}:${WP_APP_PASSWORD}`);
        headers['Authorization'] = `Basic ${credentials}`;
        headers['X-Authorization'] = `Basic ${credentials}`;
        headers['X-WP-Authorization'] = `Basic ${credentials}`;
    }
    return headers;
}

const acfCache = new Map<string, any>();
const mediaCache = new Map<number, WPMedia>();
const tagCache = new Map<number, string>();
const logoMediaLiteCache = new Map<string, Promise<Array<{ id: number; source_url: string }>>>();

type RequestCacheEntry<T> = { expiresAt: number; value: T };

const requestCache = new Map<string, RequestCacheEntry<any>>();
const requestInFlight = new Map<string, Promise<any>>();

function getDefaultRequestTtlMs(): number {
    return import.meta.env.DEV ? 60_000 : 300_000;
}

function getCachedValue<T>(key: string): T | undefined {
    const entry = requestCache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
        requestCache.delete(key);
        return undefined;
    }
    return entry.value as T;
}

async function withRequestCache<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const cached = getCachedValue<T>(key);
    if (cached !== undefined) return cached;

    const inFlight = requestInFlight.get(key);
    if (inFlight) return inFlight as Promise<T>;

    const promise = loader()
        .then((value) => {
            requestCache.set(key, { value, expiresAt: Date.now() + ttlMs });
            requestInFlight.delete(key);
            return value;
        })
        .catch((err) => {
            requestInFlight.delete(key);
            throw err;
        });

    requestInFlight.set(key, promise);
    return promise;
}

async function fetchTagNameById(id: number): Promise<string | null> {
    if (tagCache.has(id)) return tagCache.get(id)!;

    try {
        const response = await fetch(`${WP_URL}/wp-json/wp/v2/tags/${id}?_fields=id,name`, {
            headers: getHeaders(),
        });
        if (!response.ok) return null;
        const json = await response.json();
        const raw = typeof json?.name === 'string' ? json.name : null;
        const name = raw ? decodeHtmlEntities(raw) : null;
        if (name) tagCache.set(id, name);
        return name;
    } catch {
        return null;
    }
}

async function fetchTagNamesByIds(ids: number[]): Promise<string[]> {
    const names = await Promise.all(ids.map((id) => fetchTagNameById(id)));
    return names.filter((n): n is string => Boolean(n));
}

function isAcfObject(value: any): value is Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value);
}

function toMediaId(value: any): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
    if (isAcfObject(value)) {
        const maybe = value.ID ?? value.id;
        if (typeof maybe === 'number' && Number.isFinite(maybe)) return maybe;
        if (typeof maybe === 'string' && /^\d+$/.test(maybe)) return Number(maybe);
    }
    return null;
}

function parseAcfBoolean(value: any): boolean {
    if (value === true) return true;
    if (value === false) return false;
    if (value === 1 || value === '1') return true;
    if (value === 0 || value === '0') return false;
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === '' || value === null || value === undefined) return false;
    return Boolean(value);
}

function toPlainText(value: any): string | undefined {
    if (typeof value !== 'string') return undefined;
    const stripped = value
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const decoded = decodeHtmlEntities(stripped);
    return decoded.length > 0 ? decoded : undefined;
}

function decodeHtmlEntities(value: string): string {
    const named: Record<string, string> = {
        amp: '&',
        lt: '<',
        gt: '>',
        quot: '"',
        apos: "'",
        nbsp: ' ',
    };

    return String(value || '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
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

function tokenize(value: any): string[] {
    return String(value || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 3);
}

function scoreLogoCandidate(filename: string, tokens: string[]): number {
    const lower = filename.toLowerCase();
    let score = 0;
    if (lower.includes('logo')) score += 10;
    for (const token of tokens) {
        if (token && lower.includes(token)) score += 3;
    }
    return score;
}

async function fetchAllLogoMediaLite(): Promise<Array<{ id: number; source_url: string }>> {
    const cacheKey = 'all';
    if (logoMediaLiteCache.has(cacheKey)) return logoMediaLiteCache.get(cacheKey)!;

    const promise = (async () => {
        const all: Array<{ id: number; source_url: string }> = [];
        let page = 1;

        while (true) {
            try {
                const response = await fetch(
                    `${WP_URL}/wp-json/wp/v2/media?per_page=100&page=${page}&search=${encodeURIComponent('logo')}&_fields=id,source_url`,
                    { headers: getHeaders() }
                );
                if (!response.ok) break;
                const media = await response.json();
                if (!Array.isArray(media) || media.length === 0) break;

                for (const item of media) {
                    if (item?.id && typeof item?.source_url === 'string') {
                        all.push({ id: item.id, source_url: item.source_url });
                    }
                }

                page += 1;
            } catch {
                break;
            }
        }

        return all;
    })();

    logoMediaLiteCache.set(cacheKey, promise);
    return promise;
}

async function guessClientLogo(work: Work): Promise<WPMedia | undefined> {
    try {
        if (work.clientLogo) return work.clientLogo;
        const slugBase = stripWpDuplicateSuffix(work.slug);
        const tokens = Array.from(new Set([...tokenize(work.client), ...tokenize(slugBase)]));
        if (tokens.length === 0) return undefined;

        const logos = await fetchAllLogoMediaLite();
        if (logos.length === 0) return undefined;

        let best: { id: number; source_url: string; score: number } | null = null;
        for (const logo of logos) {
            const filename = logo.source_url.split('/').pop() || '';
            const score = scoreLogoCandidate(filename, tokens);
            if (!best || score > best.score) {
                best = { ...logo, score };
            }
        }

        if (!best || best.score < 10) return undefined;

        return {
            id: best.id,
            source_url: best.source_url,
        };
    } catch {
        return undefined;
    }
}

function stripWpDuplicateSuffix(slug: string): string {
    const match = slug.match(/^(.*)-(\d{1,2})$/);
    if (!match) return slug;
    const n = Number(match[2]);
    if (!Number.isFinite(n) || n < 2 || n > 99) return slug;
    return match[1];
}

function isWpDuplicateSlug(slug: string): boolean {
    return stripWpDuplicateSuffix(slug) !== slug;
}

function pickPreferredBySlug<T extends { slug: string }>(a: T, b: T): T {
    const aIsDup = isWpDuplicateSlug(a.slug);
    const bIsDup = isWpDuplicateSlug(b.slug);
    if (aIsDup !== bIsDup) return aIsDup ? b : a;

    const aDate = (a as any)?.date ? Date.parse((a as any).date) : NaN;
    const bDate = (b as any)?.date ? Date.parse((b as any).date) : NaN;
    if (Number.isFinite(aDate) && Number.isFinite(bDate) && aDate !== bDate) {
        return aDate > bDate ? a : b;
    }

    const aId = Number((a as any)?.id);
    const bId = Number((b as any)?.id);
    if (Number.isFinite(aId) && Number.isFinite(bId) && aId !== bId) {
        return aId > bId ? a : b;
    }

    return a;
}

function dedupeBySlug<T extends { slug: string }>(items: T[]): T[] {
    const map = new Map<string, T>();
    for (const item of items) {
        const key = stripWpDuplicateSuffix(item.slug);
        const existing = map.get(key);
        if (!existing) {
            map.set(key, item);
            continue;
        }

        map.set(key, pickPreferredBySlug(existing, item));
    }
    return Array.from(map.values());
}

async function fetchWpPaged(endpoint: string, params: URLSearchParams): Promise<any[]> {
    const normalized = new URLSearchParams(params);
    const perPage = Math.min(100, Number(normalized.get('per_page') || 100) || 100);
    normalized.set('per_page', String(perPage));
    normalized.delete('page');

    const cacheKey = `wpPaged:${endpoint}?${normalized.toString()}`;
    return withRequestCache(cacheKey, getDefaultRequestTtlMs(), async () => {
        const results: any[] = [];
        let page = 1;
        let totalPages = 1;

        while (page <= totalPages) {
            const loopParams = new URLSearchParams(normalized);
            loopParams.set('page', String(page));
            const response = await fetch(`${WP_URL}/wp-json/wp/v2/${endpoint}?${loopParams.toString()}`, {
                headers: getHeaders(),
            });

            if (!response.ok) break;

            const batch = (await response.json()) as any[];
            if (!Array.isArray(batch) || batch.length === 0) break;
            results.push(...batch);

            const headerTotalPages = Number(response.headers.get('x-wp-totalpages'));
            if (Number.isFinite(headerTotalPages) && headerTotalPages > 0) {
                totalPages = headerTotalPages;
            }

            if (batch.length < perPage) break;
            page += 1;
        }

        return results;
    });
}

function isLikelyTestPost(post: any): boolean {
    const slug = String(post?.slug || '').toLowerCase();
    const title = String(post?.title?.rendered || '').toLowerCase();
    return (slug.includes('acf') && title.includes('acf'));
}

async function fetchAcfForPost(postType: string, id: number): Promise<Record<string, any> | null> {
    const key = `${postType}:${id}`;
    if (acfCache.has(key)) return acfCache.get(key);

    try {
        const response = await fetch(`${WP_URL}/wp-json/acf/v3/${postType}/${id}`, {
            headers: getHeaders(),
        });
        if (!response.ok) {
            acfCache.set(key, null);
            return null;
        }

        const json = await response.json();
        const acf = isAcfObject(json?.acf) ? json.acf : null;
        acfCache.set(key, acf);
        return acf;
    } catch {
        acfCache.set(key, null);
        return null;
    }
}

async function fetchMediaById(id: number): Promise<WPMedia | null> {
    if (mediaCache.has(id)) return mediaCache.get(id)!;

    try {
        const response = await fetch(`${WP_URL}/wp-json/wp/v2/media/${id}?_fields=id,source_url,alt_text,media_details`, {
            headers: getHeaders(),
        });
        if (!response.ok) return null;
        const media = await response.json();
        if (!media?.id || !media?.source_url) return null;

        const transformed = transformEmbeddedMedia(media);
        if (transformed) {
            mediaCache.set(id, transformed);
            return transformed;
        }
        return null;
    } catch {
        return null;
    }
}

async function hydrateAcfMedia(acf: Record<string, any>): Promise<Record<string, any>> {
    const out: Record<string, any> = { ...acf };
    const mediaFields = ['mainImage', 'coverImage', 'clientLogo', 'thumbnailImage'];

    for (const field of mediaFields) {
        const value = out[field];
        if (isAcfObject(value) && (value.source_url || value.url)) {
            out[field] = transformAcfImage(value) || value;
            continue;
        }

        const id = toMediaId(value);
        if (id) {
            out[field] = await fetchMediaById(id);
        }
    }

    const gallery = out.gallery;
    if (Array.isArray(gallery)) {
        out.gallery = (await Promise.all(
            gallery.map(async (v: any) => {
                if (isAcfObject(v) && (v.source_url || v.url)) {
                    return transformAcfImage(v) || v;
                }
                const id = toMediaId(v);
                if (id) return await fetchMediaById(id);
                return v;
            })
        )).filter(Boolean);
    }

    return out;
}

// ============ INTERFACES ============

export interface WPMedia {
    id: number;
    source_url: string;
    alt_text?: string;
    width?: number;
    height?: number;
    alternativeText?: string;
    media_details?: {
        width?: number;
        height?: number;
        sizes?: {
            thumbnail?: { source_url: string };
            medium?: { source_url: string };
            large?: { source_url: string };
        };
    };
}

export interface SiteSettings {
    cv?: WPMedia;
    cvButtonText?: string;
    email?: string;
    linkedinUrl?: string;
    twitterUrl?: string;
    availabilityStatus?: 'open' | 'limited' | 'busy';
    availabilityText?: string;
}

export interface Work {
    id: number;
    documentId: string;
    name: string;
    slug: string;
    status: 'completed' | 'proposal' | 'concept' | 'in_progress' | 'backlog';
    featured: boolean;
    publishDate?: string;
    brief?: string;
    scope?: string;
    details?: string;
    mainImage?: WPMedia;
    coverImage?: WPMedia;
    client?: string;
    clientLogo?: WPMedia;
    videoUrl?: string;
    gallery?: WPMedia[];
}

export interface Insight {
    id: number;
    documentId: string;
    name: string;
    slug: string;
    featured: boolean;
    tags?: string[];
    publishDate?: string;
    description?: string;
    body?: string;
    mainImage?: WPMedia;
    thumbnailImage?: WPMedia;
}

export interface HomePage {
    heroTitle?: string;
    heroSubtitle?: string;
    heroButtonText?: string;
}

export interface AboutPage {
    heroTitle?: string;
    heroText?: string;
    bioName?: string;
    bioRole?: string;
    bioLocation?: string;
    bioEmail?: string;
    bioImage?: WPMedia;
}

export interface ContactPage {
    heroTitle?: string;
    heroText?: string;
    formTitle?: string;
}

// ============ FETCH FUNCTIONS ============

/**
 * Fetch a WordPress page by slug and extract ACF fields
 */
async function fetchPageBySlug(slug: string): Promise<any | null> {
    const cacheKey = `pageBySlug:${slug}`;
    return withRequestCache(cacheKey, getDefaultRequestTtlMs(), async () => {
        try {
            const response = await fetch(`${WP_URL}/wp-json/wp/v2/pages?slug=${slug}&_fields=id,slug,title,acf`, {
                headers: getHeaders(),
            });
            if (!response.ok) return null;
            const pages = await response.json();
            return pages && pages.length > 0 ? pages[0] : null;
        } catch (error) {
            console.error('Error fetching page:', error);
            return null;
        }
    });
}

/**
 * Fetch site settings from ACF Options Page
 */
export async function fetchSiteSettings(): Promise<SiteSettings | null> {
    const cacheKey = 'siteSettings';
    return withRequestCache(cacheKey, getDefaultRequestTtlMs(), async () => {
        try {
            const response = await fetch(`${WP_URL}/wp-json/acf/v3/options/options`, {
                headers: getHeaders(),
            });
            if (!response.ok) {
                console.warn('Site settings not found or ACF Options not configured.');
                return null;
            }
            const json = await response.json();
            const acf = json.acf || {};

            return {
                cv: acf.cv ? { id: acf.cv.ID, source_url: acf.cv.url, alt_text: acf.cv.alt } : undefined,
                cvButtonText: acf.cvButtonText || 'Download CV',
                email: acf.email,
                linkedinUrl: acf.linkedinUrl,
                twitterUrl: acf.twitterUrl,
                availabilityStatus: acf.availabilityStatus || 'open',
                availabilityText: acf.availabilityText || 'Open for Select Projects',
            };
        } catch (error) {
            console.error('Error fetching site settings:', error);
            return null;
        }
    });
}

/**
 * Fetch Home Page content
 */
export async function fetchHomePage(): Promise<HomePage | null> {
    const page = await fetchPageBySlug('home');
    if (!page?.acf) return null;
    return {
        heroTitle: page.acf.heroTitle,
        heroSubtitle: page.acf.heroSubtitle,
        heroButtonText: page.acf.heroButtonText,
    };
}

/**
 * Fetch About Page content
 */
export async function fetchAboutPage(): Promise<AboutPage | null> {
    const page = await fetchPageBySlug('about');
    if (!page?.acf) return null;
    const acf = page.acf;
    return {
        heroTitle: acf.heroTitle,
        heroText: acf.heroText,
        bioName: acf.bioName,
        bioRole: acf.bioRole,
        bioLocation: acf.bioLocation,
        bioEmail: acf.bioEmail,
        bioImage: acf.bioImage ? {
            id: acf.bioImage.ID,
            source_url: acf.bioImage.url,
            alt_text: acf.bioImage.alt,
        } : undefined,
    };
}

/**
 * Fetch Contact Page content
 */
export async function fetchContactPage(): Promise<ContactPage | null> {
    const page = await fetchPageBySlug('contact');
    if (!page?.acf) return null;
    return {
        heroTitle: page.acf.heroTitle,
        heroText: page.acf.heroText,
        formTitle: page.acf.formTitle,
    };
}

/**
 * Fetch Works (Custom Post Type)
 */
export async function fetchWorks(options?: { featured?: boolean; limit?: number }): Promise<Work[]> {
    const cacheKey = `works:featured=${String(options?.featured)}:limit=${String(options?.limit)}`;
    return withRequestCache(cacheKey, getDefaultRequestTtlMs(), async () => {
        try {
            const wantsFeatured = options?.featured !== undefined;
            const perPage = wantsFeatured ? 100 : (options?.limit || 100);
            const params = new URLSearchParams({
                per_page: String(perPage),
                _embed: 'true',
                status: 'publish',
            });

            const response = await fetch(`${WP_URL}/wp-json/wp/v2/work?${params}`, {
                headers: getHeaders(),
            });

            if (!response.ok) {
                console.warn('Works endpoint not found. Returning empty array.');
                return [];
            }

            const posts = (await response.json()) as any[];

            const hydratedPosts = await Promise.all(
                posts
                    .filter((p) => !isLikelyTestPost(p))
                    .map(async (post) => {
                        const acfFromV2 = isAcfObject(post.acf) ? post.acf : null;
                        const acfFromV3 = acfFromV2 || await fetchAcfForPost('work', post.id);
                        const acfHydrated = acfFromV3 ? await hydrateAcfMedia(acfFromV3) : undefined;

                        const featuredMediaEmbedded = post._embedded?.['wp:featuredmedia']?.[0];
                        let featuredMediaResolved = transformEmbeddedMedia(featuredMediaEmbedded);
                        const featuredId = Number(post?.featured_media);
                        if (!featuredMediaResolved && Number.isFinite(featuredId) && featuredId > 0) {
                            featuredMediaResolved = (await fetchMediaById(featuredId)) || undefined;
                        }

                        return { ...post, acf: acfHydrated, __featuredMedia: featuredMediaResolved };
                    })
            );

            let works = dedupeBySlug(hydratedPosts.map(transformWork));

            // Sort by publishDate descending (most recent first)
            works.sort((a, b) => {
                const dateA = a.publishDate ? new Date(a.publishDate).getTime() : 0;
                const dateB = b.publishDate ? new Date(b.publishDate).getTime() : 0;
                return dateB - dateA;
            });

            if (options?.featured !== undefined) {
                works = works.filter((w: Work) => w.featured === options.featured);
            }

            if (options?.limit) {
                works = works.slice(0, options.limit);
            }

            works = await Promise.all(
                works.map(async (w) => {
                    if (w.clientLogo) return w;
                    const guessed = await guessClientLogo(w);
                    return guessed ? { ...w, clientLogo: guessed } : w;
                })
            );

            return works;
        } catch (error) {
            console.error('Error fetching works:', error);
            return [];
        }
    });
}

/**
 * Fetch a single Work by slug
 */
export async function fetchWorkBySlug(slug: string): Promise<Work | null> {
    const cacheKey = `workBySlug:${slug}`;
    return withRequestCache(cacheKey, getDefaultRequestTtlMs(), async () => {
        try {
            const trySlugs = [slug];
            const stripped = stripWpDuplicateSuffix(slug);
            if (stripped !== slug) trySlugs.push(stripped);

            for (const s of trySlugs) {
                const response = await fetch(`${WP_URL}/wp-json/wp/v2/work?slug=${encodeURIComponent(s)}&_embed=true&status=publish`, {
                    headers: getHeaders(),
                });
                if (!response.ok) continue;
                const posts = (await response.json()) as any[];
                if (!Array.isArray(posts) || posts.length === 0) continue;

                const post = posts[0];
                const acfFromV2 = isAcfObject(post.acf) ? post.acf : null;
                const acfFromV3 = acfFromV2 || await fetchAcfForPost('work', post.id);
                const acfHydrated = acfFromV3 ? await hydrateAcfMedia(acfFromV3) : undefined;

                const featuredMediaEmbedded = post._embedded?.['wp:featuredmedia']?.[0];
                let featuredMediaResolved = transformEmbeddedMedia(featuredMediaEmbedded);
                const featuredId = Number(post?.featured_media);
                if (!featuredMediaResolved && Number.isFinite(featuredId) && featuredId > 0) {
                    featuredMediaResolved = (await fetchMediaById(featuredId)) || undefined;
                }

                let work = transformWork({ ...post, acf: acfHydrated, __featuredMedia: featuredMediaResolved });
                if (!work.clientLogo) {
                    const guessed = await guessClientLogo(work);
                    if (guessed) work = { ...work, clientLogo: guessed };
                }

                return work;
            }

            return null;
        } catch (error) {
            console.error('Error fetching work by slug:', error);
            return null;
        }
    });
}

/**
 * Fetch Insights (Posts or Custom Post Type)
 */
export async function fetchInsights(options?: { featured?: boolean; limit?: number; tag?: string }): Promise<Insight[]> {
    const cacheKey = `insights:featured=${String(options?.featured)}:limit=${String(options?.limit)}:tag=${String(options?.tag)}`;
    return withRequestCache(cacheKey, getDefaultRequestTtlMs(), async () => {
        try {
            const perPage = 100;
            const params = new URLSearchParams({
                per_page: String(perPage),
                _embed: 'true',
                status: 'publish',
            });

            if (options?.tag) {
                params.set('tag', options.tag);
            }

            let posts = await fetchWpPaged('insight', new URLSearchParams(params));
            if (!Array.isArray(posts) || posts.length === 0) {
                posts = await fetchWpPaged('posts', new URLSearchParams(params));
            }

            if (!Array.isArray(posts) || posts.length === 0) return [];

            const hydratedPosts = await Promise.all(
                posts
                    .filter((p) => !isLikelyTestPost(p))
                    .map(async (post) => {
                        const postType = post.type || 'insight';
                        const acfFromV2 = isAcfObject(post.acf) ? post.acf : null;
                        const acfFromV3 = acfFromV2 || await fetchAcfForPost(postType, post.id);
                        const acfHydrated = acfFromV3 ? await hydrateAcfMedia(acfFromV3) : undefined;

                        const termGroups = post._embedded?.['wp:term'] || [];
                        const allTerms = Array.isArray(termGroups) ? termGroups.flat() : [];
                        const embeddedTagNames = allTerms
                            .filter((t: any) => t?.taxonomy === 'post_tag')
                            .map((t: any) => decodeHtmlEntities(String(t?.name || '')))
                            .filter((n: string) => n.length > 0);

                        const tagIds = Array.isArray(post.tags) ? post.tags : [];
                        const tagNames = embeddedTagNames.length > 0
                            ? embeddedTagNames
                            : (tagIds.length > 0 ? await fetchTagNamesByIds(tagIds) : []);

                        const featuredMediaEmbedded = post._embedded?.['wp:featuredmedia']?.[0];
                        let featuredMediaResolved = transformEmbeddedMedia(featuredMediaEmbedded);
                        const featuredId = Number(post?.featured_media);
                        if (!featuredMediaResolved && Number.isFinite(featuredId) && featuredId > 0) {
                            featuredMediaResolved = (await fetchMediaById(featuredId)) || undefined;
                        }

                        return { ...post, acf: acfHydrated, __tagNames: tagNames, __featuredMedia: featuredMediaResolved };
                    })
            );

            let insights = dedupeBySlug(hydratedPosts.map(transformInsight));
            insights = insights.sort((a, b) => {
                const ad = a.publishDate ? Date.parse(a.publishDate) : NaN;
                const bd = b.publishDate ? Date.parse(b.publishDate) : NaN;
                if (Number.isFinite(ad) && Number.isFinite(bd) && ad !== bd) return bd - ad;
                return (b.id || 0) - (a.id || 0);
            });

            if (options?.featured !== undefined) {
                insights = insights.filter((i: Insight) => i.featured === options.featured);
            }

            if (options?.limit) {
                insights = insights.slice(0, options.limit);
            }

            return insights;
        } catch (error) {
            console.error('Error fetching insights:', error);
            return [];
        }
    });
}

/**
 * Fetch a single Insight by slug
 */
export async function fetchInsightBySlug(slug: string): Promise<Insight | null> {
    const cacheKey = `insightBySlug:${slug}`;
    return withRequestCache(cacheKey, getDefaultRequestTtlMs(), async () => {
        try {
            const trySlugs = [slug];
            const stripped = stripWpDuplicateSuffix(slug);
            if (stripped !== slug) trySlugs.push(stripped);

            for (const s of trySlugs) {
                let response = await fetch(`${WP_URL}/wp-json/wp/v2/insight?slug=${encodeURIComponent(s)}&_embed=true&status=publish`, {
                    headers: getHeaders(),
                });

                if (!response.ok) {
                    response = await fetch(`${WP_URL}/wp-json/wp/v2/posts?slug=${encodeURIComponent(s)}&_embed=true&status=publish`, {
                        headers: getHeaders(),
                    });
                }

                if (!response.ok) continue;
                const posts = (await response.json()) as any[];
                if (!Array.isArray(posts) || posts.length === 0) continue;
                const post = posts[0];

                const postType = post.type || 'insight';
                const acfFromV2 = isAcfObject(post.acf) ? post.acf : null;
                const acfFromV3 = acfFromV2 || await fetchAcfForPost(postType, post.id);
                const acfHydrated = acfFromV3 ? await hydrateAcfMedia(acfFromV3) : undefined;

                const termGroups = post._embedded?.['wp:term'] || [];
                const allTerms = Array.isArray(termGroups) ? termGroups.flat() : [];
                const embeddedTagNames = allTerms
                    .filter((t: any) => t?.taxonomy === 'post_tag')
                    .map((t: any) => decodeHtmlEntities(String(t?.name || '')))
                    .filter((n: string) => n.length > 0);

                const tagIds = Array.isArray(post.tags) ? post.tags : [];
                const tagNames = embeddedTagNames.length > 0
                    ? embeddedTagNames
                    : (tagIds.length > 0 ? await fetchTagNamesByIds(tagIds) : []);

                const featuredMediaEmbedded = post._embedded?.['wp:featuredmedia']?.[0];
                let featuredMediaResolved = transformEmbeddedMedia(featuredMediaEmbedded);
                const featuredId = Number(post?.featured_media);
                if (!featuredMediaResolved && Number.isFinite(featuredId) && featuredId > 0) {
                    featuredMediaResolved = (await fetchMediaById(featuredId)) || undefined;
                }

                return transformInsight({ ...post, acf: acfHydrated, __tagNames: tagNames, __featuredMedia: featuredMediaResolved });
            }

            return null;
        } catch (error) {
            console.error('Error fetching insight by slug:', error);
            return null;
        }
    });
}

// ============ UTILITY FUNCTIONS ============

/**
 * Get full media URL (WordPress URLs are already absolute)
 */
export function getMediaUrl(media?: WPMedia | null): string | null {
    const raw = media?.source_url || (media as any)?.url || null;
    if (!raw || typeof raw !== 'string') return null;

    if (raw.startsWith('/')) {
        return `${WP_URL}${raw}`;
    }

    try {
        const u = new URL(raw);
        return isAllowedContentHost(u.hostname) ? raw : null;
    } catch {
        return null;
    }
}

/**
 * Process markdown content (fix relative URLs if needed)
 */
export function processMarkdownContent(content?: string): string | undefined {
    if (!content) return undefined;
    // WordPress typically returns absolute URLs, but handle relative just in case
    let processed = content.replace(/src="\/wp-content/g, `src="${WP_URL}/wp-content`);
    return processed;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

}

function recoverFlatTgTable(html: string): string {
    if (typeof html !== 'string') return html;

    const headerConfigs: Array<{ columns: number; expectedHeader: string[] }> = [
        { columns: 4, expectedHeader: ['variable', 'category', 'subcategory', 'details'] },
        { columns: 3, expectedHeader: ['key metrics', 'category', 'details'] },
    ];

    function normalizeHeaderText(text: string): string {
        return String(text || '')
            .replace(/[\s\u00A0]+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function isIgnorableBetween(text: string): boolean {
        const stripped = String(text || '')
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/<\s*br\s*\/?\s*>/gi, '')
            .replace(/<\/?span\b[^>]*>/gi, '')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;|&#160;|&#xA0;|&ZeroWidthSpace;/gi, '')
            .replace(/[\s\u00A0\u200B\u200C\u200D\uFEFF]+/g, '');
        return stripped.length === 0;
    }

    function formatCellHtml(text: string): string {
        const safe = escapeHtml(String(text || ''));
        return safe.replace(/\n{2,}/g, '\n').replace(/\n/g, '<br/>');
    }

    function splitRowTokens(text: string): string[] | null {
        const raw = String(text || '');
        const hasNewline = raw.includes('\n');
        const hasPipes = raw.includes('|');
        if (!hasNewline && !hasPipes) return null;

        const parts = (hasPipes ? raw.split('|') : raw.split(/\n+/))
            .map((p) => p.replace(/[\s\u00A0]+/g, ' ').trim())
            .filter(Boolean);

        if (parts.length < 2) return null;
        if (parts.length > 6) return null;
        return parts;
    }

    function recoverOnce(inputHtml: string): { changed: boolean; html: string } {
        const pRegex = /<p\b[^>]*>[\s\S]*?<\/p>/gi;
        const matches: Array<{ start: number; end: number; inner: string; text: string }> = [];
        let m: RegExpExecArray | null;
        while ((m = pRegex.exec(inputHtml)) !== null) {
            const full = m[0];
            const start = m.index;
            const end = start + full.length;
            const inner = full.replace(/^<p\b[^>]*>/i, '').replace(/<\/p>$/i, '');
            const text = decodeHtmlEntities(inner)
                .replace(/<\s*br\s*\/?\s*>/gi, '\n')
                .replace(/<[^>]+>/g, '')
                .replace(/&nbsp;|&#160;|&#xA0;/gi, ' ')
                .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
                .trim();
            matches.push({ start, end, inner, text });
        }

        if (matches.length < 6) return { changed: false, html: inputHtml };

        let headerIndex = -1;
        let headerConfig: { columns: number; expectedHeader: string[] } | null = null;
        let headerFromSingleParagraph: string[] | null = null;

        for (let i = 0; i < matches.length; i++) {
            const t0 = normalizeHeaderText(matches[i].text);
            if (!t0 || t0 === '‍') continue;

            const maybeRow = splitRowTokens(matches[i].text);
            if (maybeRow) {
                for (const cfg of headerConfigs) {
                    if (maybeRow.length !== cfg.columns) continue;
                    const ok = maybeRow.every((p, idx) => normalizeHeaderText(p) === cfg.expectedHeader[idx]);
                    if (ok) {
                        headerIndex = i;
                        headerConfig = cfg;
                        headerFromSingleParagraph = maybeRow;
                        break;
                    }
                }
            }

            if (headerIndex !== -1) break;

            for (const cfg of headerConfigs) {
                if (t0 !== cfg.expectedHeader[0]) continue;

                let j = i + 1;
                let k = 1;
                while (j < matches.length && k < cfg.expectedHeader.length) {
                    const t = normalizeHeaderText(matches[j].text);
                    if (!t || t === '‍') {
                        j += 1;
                        continue;
                    }
                    if (t !== cfg.expectedHeader[k]) {
                        k = -1;
                        break;
                    }
                    k += 1;
                    j += 1;
                }

                if (k === cfg.expectedHeader.length) {
                    headerIndex = i;
                    headerConfig = cfg;
                    break;
                }
            }

            if (headerIndex !== -1) break;
        }

        if (headerIndex === -1 || !headerConfig) return { changed: false, html: inputHtml };

        const columns = headerConfig.columns;
        const expectedHeader = headerConfig.expectedHeader;

        const cells: string[] = [];
        let blankStreak = 0;
        const start = matches[headerIndex].start;
        let lastEnd = matches[headerIndex].start;
        let endIndex = headerIndex - 1;

        let startI = headerIndex;
        if (headerFromSingleParagraph) {
            cells.push(...headerFromSingleParagraph);
            lastEnd = matches[headerIndex].end;
            endIndex = headerIndex;
            startI = headerIndex + 1;
        }

        for (let i = startI; i < matches.length; i++) {
            const between = inputHtml.slice(lastEnd, matches[i].start);
            if (!isIgnorableBetween(between)) break;

            const text = matches[i].text;
            if (!text || text === '‍') {
                blankStreak += 1;
                if (blankStreak >= 2 && cells.length >= columns * 2) break;
                lastEnd = matches[i].end;
                endIndex = i;
                continue;
            }
            blankStreak = 0;
            if (/^#{1,6}\s+/.test(text)) break;

            const betweenWithTags = inputHtml.slice(lastEnd, matches[i].start);
            if (/<\s*h[1-6]\b/i.test(betweenWithTags)) break;

            const maybeRow = splitRowTokens(text);
            const atRowStart = cells.length % columns === 0;
            if (atRowStart && maybeRow && maybeRow.length === columns) {
                cells.push(...maybeRow);
            } else {
                cells.push(text);
            }
            lastEnd = matches[i].end;
            endIndex = i;
        }

        if (cells.length < columns * 2) return { changed: false, html: inputHtml };

        const header = cells.slice(0, columns);
        const headerMatches = header.every((h, i) => normalizeHeaderText(h) === expectedHeader[i]);
        if (!headerMatches) return { changed: false, html: inputHtml };

        const rows = cells.slice(columns);
        const rowCount = Math.floor(rows.length / columns);
        if (rowCount < 1) return { changed: false, html: inputHtml };

        const rowsNormalized = rows.slice(0, rowCount * columns);
        const thead = `<thead><tr>${header.map((h) => `<th>${formatCellHtml(h)}</th>`).join('')}</tr></thead>`;
        const tbodyRows = new Array(rowCount).fill(0).map((_, i) => {
            const row = rowsNormalized.slice(i * columns, i * columns + columns);
            return `<tr>${row.map((c) => `<td>${formatCellHtml(c)}</td>`).join('')}</tr>`;
        });
        const table = `<table>${thead}<tbody>${tbodyRows.join('')}</tbody></table>`;

        const end = matches[Math.max(headerIndex, endIndex)].end;
        const output = `${inputHtml.slice(0, start)}${table}${inputHtml.slice(end)}`;
        return { changed: true, html: output };
    }

    let current = html;
    for (let i = 0; i < 5; i++) {
        const res = recoverOnce(current);
        if (!res.changed) break;
        current = res.html;
    }
    return current;
}

export function normalizeWpRichText(content?: any): string | undefined {
    if (typeof content !== 'string') return undefined;
    let value = content.trim();
    if (!value) return undefined;

    // Transform admin domain URLs to frontend domain for non-media hrefs
    // This preserves media URLs (images, uploads) on the admin domain
    value = value.replace(
        /href=(["'])(https?:\/\/admin\.ahmadkarmi\.com)(\/[^"']*)?(\1)/gi,
        (match, quote, _domain, path, endQuote) => {
            const urlPath = path || '';
            // Keep media URLs on admin domain
            if (/\/wp-content\/uploads\//i.test(urlPath)) {
                return match;
            }
            return `href=${quote}${SITE_URL}${urlPath}${endQuote}`;
        }
    );

    const containsHtml = /<\s*[a-z][\s\S]*>/i.test(value);
    const hasComplexHtml = /<\s*(img|iframe|figure|video|audio|table|pre|code|ul|ol|blockquote|h[1-6])\b/i.test(value);

    const asTextForMarkdown = value
        .replace(/<\s*br\s*\/?\s*>/gi, '\n')
        .replace(/<\s*\/\s*p\s*>/gi, '\n\n')
        .replace(/<\s*p\b[^>]*>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    let markdownCandidate = decodeHtmlEntities(asTextForMarkdown)
        .replace(/\u00A0/g, ' ')
        .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    if (markdownCandidate.includes('.modern-btn')) {
        markdownCandidate = markdownCandidate
            .replace(/\bVisit Button\b\s*(?=\.modern-btn\b)/gi, '')
            .replace(/\.modern-btn[^\{]*\{[\s\S]*?\}\s*/gi, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    if (markdownCandidate.includes('.tg')) {
        markdownCandidate = markdownCandidate
            .replace(/\.tg[^\{]*\{[\s\S]*?\}\s*/gi, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    const looksLikeMarkdown =
        /(^|\n|\s)#{1,6}\s+\S/.test(markdownCandidate)
        || /(^|\n)\s*[-*+]\s+\S/.test(markdownCandidate)
        || /(^|\n)\s*\d{1,2}\.\s+\S/.test(markdownCandidate)
        || /\*\*[^*\n]{2,}\*\*/.test(markdownCandidate)
        || /__[^_\n]{2,}__/.test(markdownCandidate)
        || /!\[[^\]]*\]\([^)]+\)/.test(markdownCandidate)
        || /\[[^\]]+\]\([^)]+\)/.test(markdownCandidate);

    const isWrappedMarkdown = containsHtml && !hasComplexHtml && looksLikeMarkdown;

    if (isWrappedMarkdown) {
        const fixedMarkdown = markdownCandidate
            .replace(/\]\(\/wp-content\//g, `](${WP_URL}/wp-content/`)
            .replace(/\]\(\/wp-includes\//g, `](${WP_URL}/wp-includes/`);

        const normalizedMarkdown = fixedMarkdown
            .replace(/(^|[^\n])\s(#{1,6})\s+(?=[0-9A-Za-z*])/g, '$1\n\n$2 ')
            .replace(/(^|[^\n#])\s(\d{1,2}\.)\s+(?=\*\*|__|[A-Za-z0-9])/g, '$1\n\n$2 ')
            .replace(/^\s{4,}(#{1,6}\s+)/gm, '$1')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        const bulletSeparatorMatches = normalizedMarkdown.match(/\s-\s+(?=(\*\*|__|\[))/g) || [];
        const normalizedMarkdownWithBullets = bulletSeparatorMatches.length >= 2
            ? normalizedMarkdown.replace(/\s-\s+(?=(\*\*|__|\[))/g, '\n- ')
            : normalizedMarkdown;

        const withoutExternalImages = normalizedMarkdownWithBullets.replace(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/gi, (match, url) => {
            return isAllowedContentUrl(url) ? match : '';
        });

        return withoutExternalImages;
    }

    if (!containsHtml && looksLikeMarkdown) {
        const fixedMarkdown = markdownCandidate
            .replace(/\]\(\/wp-content\//g, `](${WP_URL}/wp-content/`)
            .replace(/\]\(\/wp-includes\//g, `](${WP_URL}/wp-includes/`);

        const normalizedMarkdown = fixedMarkdown
            .replace(/(^|[^\n])\s(#{1,6})\s+(?=[0-9A-Za-z*])/g, '$1\n\n$2 ')
            .replace(/(^|[^\n#])\s(\d{1,2}\.)\s+(?=\*\*|__|[A-Za-z0-9])/g, '$1\n\n$2 ')
            .replace(/^\s{4,}(#{1,6}\s+)/gm, '$1')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        const bulletSeparatorMatches = normalizedMarkdown.match(/\s-\s+(?=(\*\*|__|\[))/g) || [];
        const normalizedMarkdownWithBullets = bulletSeparatorMatches.length >= 2
            ? normalizedMarkdown.replace(/\s-\s+(?=(\*\*|__|\[))/g, '\n- ')
            : normalizedMarkdown;

        const withoutExternalImages = normalizedMarkdownWithBullets.replace(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/gi, (match, url) => {
            return isAllowedContentUrl(url) ? match : '';
        });

        return withoutExternalImages;
    }

    const fixedHtml = value
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/\bVisit Button\b\s*(?=\.modern-btn\b)/gi, '')
        .replace(/\.modern-btn[^\{]*\{[\s\S]*?\}\s*/gi, '')
        .replace(/\.tg[^\{]*\{[\s\S]*?\}\s*/gi, '')
        .replace(/(src|href)="\/wp-content\//gi, `$1="${WP_URL}/wp-content/`)
        .replace(/(src|href)='\/wp-content\//gi, `$1='${WP_URL}/wp-content/`)
        .replace(/(src|href)="\/wp-includes\//gi, `$1="${WP_URL}/wp-includes/`)
        .replace(/(src|href)='\/wp-includes\//gi, `$1='${WP_URL}/wp-includes/`)
        .replace(/(<figure\b[^>]*?)\sstyle=(['"])[^'">]*\2([^>]*>)/gi, '$1$3')
        .replace(/(<img\b[^>]*?)\sstyle=(['"])[^'">]*\2([^>]*>)/gi, '$1$3')
        .replace(/\ssrcset=(['"])([^'"<>]+)\1/gi, (match, _q, value) => {
            const raw = String(value || '');
            if (!raw.includes('http')) return match;
            const urls = raw
                .split(',')
                .map((part) => String(part).trim().split(/\s+/)[0])
                .filter(Boolean);
            const hasExternal = urls.some((u) => /^https?:\/\//i.test(u) && !isAllowedContentUrl(u));
            return hasExternal ? '' : match;
        })
        .replace(
            /<p\b[^>]*>(?:\s|&nbsp;|&#160;|&#xA0;|&ZeroWidthSpace;|\u00A0|\u200B|\u200C|\u200D|\uFEFF|‍|<br\s*\/?\s*>|<\/?span\b[^>]*>)*<\/p>/gi,
            ''
        )
        .replace(/<img\b[^>]*\bsrc=(['"])(https?:\/\/[^'"]+)\1[^>]*>/gi, (match, _q, url) => {
            return isAllowedContentUrl(url) ? match : '';
        })
        .replace(/<img\b(?![^>]*\bloading=)([^>]*?)>/gi, '<img loading="lazy"$1>')
        .replace(/<img\b(?![^>]*\bdecoding=)([^>]*?)>/gi, '<img decoding="async"$1>');

    return recoverFlatTgTable(fixedHtml);
}

// ============ TRANSFORM FUNCTIONS ============

function transformEmbeddedMedia(media?: any): WPMedia | undefined {
    if (!media?.id || !media?.source_url) return undefined;
    return {
        id: media.id,
        source_url: media.source_url,
        alt_text: media.alt_text,
        width: media.media_details?.width,
        height: media.media_details?.height,
        alternativeText: media.alt_text,
        media_details: media.media_details,
    };
}

function transformAcfImage(image?: any): WPMedia | undefined {
    if (!image) return undefined;

    const id = image.ID ?? image.id;
    const sourceUrl = image.url ?? image.source_url;
    if (!id || !sourceUrl) return undefined;

    const altText = image.alt ?? image.alt_text ?? image.alternativeText;
    const width = image.width ?? image.media_details?.width;
    const height = image.height ?? image.media_details?.height;

    return {
        id,
        source_url: sourceUrl,
        alt_text: altText,
        width,
        height,
        alternativeText: altText,
    };
}

function transformWork(post: any): Work {
    const acf = post.acf || {};
    const featuredMedia = post._embedded?.['wp:featuredmedia']?.[0];

    const mainImageFromAcf = transformAcfImage(acf.mainImage);
    const coverImageFromAcf = transformAcfImage(acf.coverImage);
    const clientLogoFromAcf = transformAcfImage(acf.clientLogo);
    const featuredMediaTransformed = post.__featuredMedia || transformEmbeddedMedia(featuredMedia);

    const gallery = Array.isArray(acf.gallery)
        ? acf.gallery
            .map((img: any) => transformAcfImage(img))
            .filter((img: any): img is WPMedia => Boolean(img?.source_url))
        : [];

    return {
        id: post.id,
        documentId: String(post.id),
        name: decodeHtmlEntities(post.title?.rendered || ''),
        slug: post.slug,
        status: acf.status || 'backlog',
        featured: parseAcfBoolean(acf.featured),
        publishDate: post.date || post.date_gmt,
        brief: processMarkdownContent(acf.brief),
        scope: processMarkdownContent(acf.scope),
        details: processMarkdownContent(acf.details || post.content?.rendered),
        mainImage: mainImageFromAcf || featuredMediaTransformed,
        coverImage: coverImageFromAcf,
        client: typeof acf.client === 'string' ? decodeHtmlEntities(acf.client) : acf.client,
        clientLogo: clientLogoFromAcf,
        videoUrl: acf.videoUrl,
        gallery,
    };
}

function transformInsight(post: any): Insight {
    const acf = post.acf || {};
    const featuredMedia = post._embedded?.['wp:featuredmedia']?.[0];
    const tags = Array.isArray(post.__tagNames)
        ? post.__tagNames
        : [];

    const bodyFromAcf = typeof acf.body === 'string' ? acf.body.trim() : '';
    const bodyFromContent = typeof post.content?.rendered === 'string' ? post.content.rendered.trim() : '';
    const contentHasTable = /<\s*table\b/i.test(bodyFromContent) || /wp-block-table/i.test(bodyFromContent);
    const acfHasTable = /<\s*table\b/i.test(bodyFromAcf) || /wp-block-table/i.test(bodyFromAcf);
    const bodySource = (contentHasTable && !acfHasTable)
        ? bodyFromContent
        : (bodyFromAcf || bodyFromContent);

    const descriptionFromAcf = toPlainText(acf.description);
    const descriptionFromExcerpt = toPlainText(post.excerpt?.rendered);
    const descriptionFromContent = toPlainText(post.content?.rendered);
    const descriptionFromContentSnippet = descriptionFromContent
        ? descriptionFromContent.slice(0, 220)
        : undefined;

    const mainImageFromAcf = transformAcfImage(acf.mainImage);
    const thumbnailImageFromAcf = transformAcfImage(acf.thumbnailImage);
    const featuredMediaTransformed = post.__featuredMedia || transformEmbeddedMedia(featuredMedia);

    return {
        id: post.id,
        documentId: String(post.id),
        name: decodeHtmlEntities(post.title?.rendered || ''),
        slug: post.slug,
        featured: parseAcfBoolean(acf.featured),
        tags: tags,
        publishDate: post.date,
        description: descriptionFromAcf
            || descriptionFromExcerpt
            || descriptionFromContentSnippet,
        body: normalizeWpRichText(bodySource),
        mainImage: mainImageFromAcf || featuredMediaTransformed,
        thumbnailImage: thumbnailImageFromAcf,
    };
}
