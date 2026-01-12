// Strapi API client for fetching data

const STRAPI_URL = import.meta.env.PUBLIC_STRAPI_URL || 'http://localhost:1337';
const API_TOKEN = import.meta.env.PUBLIC_STRAPI_API_TOKEN;

function getHeaders() {
    const headers: HeadersInit = {
        'Content-Type': 'application/json',
    };
    if (API_TOKEN) {
        headers['Authorization'] = `Bearer ${API_TOKEN}`;
    }
    return headers;
}

export interface StrapiMedia {
    id: number;
    url: string;
    alternativeText?: string;
    width?: number;
    height?: number;
    formats?: {
        thumbnail?: { url: string };
        small?: { url: string };
        medium?: { url: string };
        large?: { url: string };
    };
}

export interface SiteSettings {
    cv?: StrapiMedia;
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
    status: 'completed' | 'proposal' | 'concept' | 'in_progress';
    featured: boolean;
    brief?: string;
    scope?: string;
    details?: string;
    mainImage?: StrapiMedia;
    coverImage?: StrapiMedia;
    client?: string;
    clientLogo?: StrapiMedia;
    videoUrl?: string;
    gallery?: StrapiMedia[];
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
    mainImage?: StrapiMedia;
    thumbnailImage?: StrapiMedia;
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
    bioImage?: StrapiMedia;
}

export interface ContactPage {
    heroTitle?: string;
    heroText?: string;
    formTitle?: string;
}

interface StrapiResponse<T> {
    data: T[];
    meta: {
        pagination: {
            page: number;
            pageSize: number;
            pageCount: number;
            total: number;
        };
    };
}

interface StrapiSingleResponse<T> {
    data: T;
}

/**
 * Fetch site settings (Single Type) including CV
 */
export async function fetchSiteSettings(): Promise<SiteSettings | null> {
    try {
        const response = await fetch(`${STRAPI_URL}/api/site-setting?populate=*`, { headers: getHeaders() });

        if (!response.ok) {
            console.error('Failed to fetch site settings:', response.statusText);
            return null;
        }

        const json: StrapiSingleResponse<any> = await response.json();

        if (!json.data) return null;

        return {
            cv: json.data.cv ? {
                id: json.data.cv.id,
                url: json.data.cv.url,
                alternativeText: json.data.cv.alternativeText,
            } : undefined,
            cvButtonText: json.data.cvButtonText || 'Download CV',
            email: json.data.email,
            linkedinUrl: json.data.linkedinUrl,
            twitterUrl: json.data.twitterUrl,
            availabilityStatus: json.data.availabilityStatus || 'open',
            availabilityText: json.data.availabilityText || 'Open for Select Projects',
        };
    } catch (error) {
        console.error('Error fetching site settings:', error);
        return null;
    }
}

/**
 * Fetch all works from Strapi
 */
export async function fetchWorks(options?: {
    featured?: boolean;
    limit?: number;
}): Promise<Work[]> {
    try {
        const params = new URLSearchParams({
            'populate': '*',
            'sort': 'createdAt:desc',
        });

        if (options?.featured !== undefined) {
            params.set('filters[featured][$eq]', String(options.featured));
        }

        if (options?.limit) {
            params.set('pagination[limit]', String(options.limit));
        }

        const response = await fetch(`${STRAPI_URL}/api/works?${params}`, { headers: getHeaders() });

        if (!response.ok) {
            console.error('Failed to fetch works:', response.statusText);
            return [];
        }

        const json: StrapiResponse<Work> = await response.json();
        return json.data.map(transformWork);
    } catch (error) {
        console.error('Error fetching works:', error);
        return [];
    }
}

/**
 * Fetch a single work by slug
 */
export async function fetchWorkBySlug(slug: string): Promise<Work | null> {
    try {
        const params = new URLSearchParams({
            'filters[slug][$eq]': slug,
            'populate': '*',
        });

        const response = await fetch(`${STRAPI_URL}/api/works?${params}`, { headers: getHeaders() });

        if (!response.ok) {
            console.error('Failed to fetch work:', response.statusText);
            return null;
        }

        const json: StrapiResponse<Work> = await response.json();

        if (json.data.length === 0) return null;

        return transformWork(json.data[0]);
    } catch (error) {
        console.error('Error fetching work by slug:', error);
        return null;
    }
}

/**
 * Fetch all insights from Strapi
 */
export async function fetchInsights(options?: {
    featured?: boolean;
    limit?: number;
    tag?: string;
}): Promise<Insight[]> {
    try {
        const params = new URLSearchParams({
            'populate': '*',
            'sort': 'publishDate:desc',
        });

        if (options?.featured !== undefined) {
            params.set('filters[featured][$eq]', String(options.featured));
        }

        if (options?.limit) {
            params.set('pagination[limit]', String(options.limit));
        }

        const response = await fetch(`${STRAPI_URL}/api/insights?${params}`, { headers: getHeaders() });

        if (!response.ok) {
            console.error('Failed to fetch insights:', response.statusText);
            return [];
        }

        const json: StrapiResponse<Insight> = await response.json();
        return json.data.map(transformInsight);
    } catch (error) {
        console.error('Error fetching insights:', error);
        return [];
    }
}

/**
 * Fetch a single insight by slug
 */
export async function fetchInsightBySlug(slug: string): Promise<Insight | null> {
    try {
        const params = new URLSearchParams({
            'filters[slug][$eq]': slug,
            'populate': '*',
        });

        const response = await fetch(`${STRAPI_URL}/api/insights?${params}`, { headers: getHeaders() });

        if (!response.ok) {
            console.error('Failed to fetch insight:', response.statusText);
            return null;
        }

        const json: StrapiResponse<Insight> = await response.json();

        if (json.data.length === 0) return null;

        return transformInsight(json.data[0]);
    } catch (error) {
        console.error('Error fetching insight by slug:', error);
        return null;
    }
}

/**
 * Fetch Home Page Data
 */
export async function fetchHomePage(): Promise<HomePage | null> {
    try {
        const response = await fetch(`${STRAPI_URL}/api/home-page`, { headers: getHeaders() });
        if (!response.ok) return null;
        const json: StrapiSingleResponse<HomePage> = await response.json();
        return json.data || null;
    } catch (error) {
        console.error('Error fetching home page:', error);
        return null;
    }
}

/**
 * Fetch About Page Data
 */
export async function fetchAboutPage(): Promise<AboutPage | null> {
    try {
        const response = await fetch(`${STRAPI_URL}/api/about-page?populate=*`, { headers: getHeaders() });
        if (!response.ok) return null;
        const json: StrapiSingleResponse<any> = await response.json();
        const data = json.data;
        if (!data) return null;

        return {
            ...data,
            bioImage: (data.bioImage?.data || data.bioImage) ? transformMedia(data.bioImage?.data || data.bioImage) : undefined,
        };
    } catch (error) {
        console.error('Error fetching about page:', error);
        return null;
    }
}

/**
 * Fetch Contact Page Data
 */
export async function fetchContactPage(): Promise<ContactPage | null> {
    try {
        const response = await fetch(`${STRAPI_URL}/api/contact-page`, { headers: getHeaders() });
        if (!response.ok) return null;
        const json: StrapiSingleResponse<ContactPage> = await response.json();
        return json.data || null;
    } catch (error) {
        console.error('Error fetching contact page:', error);
        return null;
    }
}

/**
 * Get full media URL
 */
export function getMediaUrl(media?: StrapiMedia | null): string | null {
    if (!media?.url) return null;

    // If URL is already absolute, return as-is
    if (media.url.startsWith('http')) {
        return media.url;
    }

    // Otherwise, prepend Strapi URL
    return `${STRAPI_URL}${media.url}`;
}

// Transform functions to normalize Strapi responses
// Transform functions to normalize Strapi responses
function transformWork(data: any): Work {
    return {
        ...data,
        brief: processMarkdownContent(data.brief),
        scope: processMarkdownContent(data.scope),
        details: processMarkdownContent(data.details),
        mainImage: (data.mainImage?.data || data.mainImage) ? transformMedia(data.mainImage?.data || data.mainImage) : undefined,
        clientLogo: (data.clientLogo?.data || data.clientLogo) ? transformMedia(data.clientLogo?.data || data.clientLogo) : undefined,
        gallery: (data.gallery?.data || data.gallery)?.map(transformMedia) || [],
    };
}

function transformInsight(data: any): Insight {
    return {
        ...data,
        body: processMarkdownContent(data.body),
        tags: Array.isArray(data.tags) ? data.tags : [],
        mainImage: (data.mainImage?.data || data.mainImage) ? transformMedia(data.mainImage?.data || data.mainImage) : undefined,
        thumbnailImage: (data.thumbnailImage?.data || data.thumbnailImage) ? transformMedia(data.thumbnailImage?.data || data.thumbnailImage) : undefined,
    };
}

function transformMedia(data: any): StrapiMedia {
    return {
        id: data.id,
        url: data.attributes?.url || data.url,
        alternativeText: data.attributes?.alternativeText || data.alternativeText,
        width: data.attributes?.width || data.width,
        height: data.attributes?.height || data.height,
        formats: data.attributes?.formats || data.formats,
    };
}

/**
 * Process markdown content to fix relative image URLs
 */
export function processMarkdownContent(content?: string): string | undefined {
    if (!content) return undefined;

    // Replace markdown image syntax: ![alt](/uploads/...) -> ![alt](STRAPI_URL/uploads/...)
    // Also handle HTML img tags if any: src="/uploads/..."

    let processed = content;

    // Fix Markdown images
    processed = processed.replace(/!\[(.*?)\]\((\/uploads\/.*?)\)/g, (match, alt, url) => {
        return `![${alt}](${STRAPI_URL}${url})`;
    });

    // Fix HTML img tags (if turndown left any or if mixed content)
    processed = processed.replace(/src="(\/uploads\/.*?)"/g, (match, url) => {
        return `src="${STRAPI_URL}${url}"`;
    });

    return processed;
}
