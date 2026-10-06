// Build-time treatment for <img> elements inside WordPress rich text.
//
// Featured and card images already go through Astro's image pipeline, but
// body images used to ship exactly as WordPress emitted them: PNG/JPEG
// renditions served from the CMS host with no CDN. WordPress's own resized
// PNGs are often larger than the upload (its encoder is weaker than the
// tool that made the original), so a 132KB chart reached phones as 124KB
// and desktops as 194KB.
//
// This re-encodes every body image from the original upload:
//
// - WebP at quality 90, which is visually lossless for charts and photos.
//   Truly lossless WebP was tested and came out larger than already-tight
//   PNGs, so it is not used.
// - Responsive widths sized to the article column, never upscaled.
// - A large rendition in data-full-src for the lightbox, so zooming still
//   shows full detail (BodyImageLightbox.tsx prefers it).
// - Width/height are kept so the image reserves space (no CLS).
//
// The original in WordPress is never modified. Anything that cannot be
// processed (other hosts, SVG, GIF, fetch failures) keeps its original tag.
//
// optimizeWpImage() is the same treatment for templates that render CMS
// media directly (portfolio hero, gallery, client logo), so every image the
// CMS supplies is served the same way regardless of how it was uploaded.

import { getImage, inferRemoteSize } from 'astro:assets';
import { decodeAttr, parseAttrs, serializeAttrs } from './contentVideo';

const WP_HOST = new URL(import.meta.env.PUBLIC_WP_URL || 'https://admin.ahmadkarmi.com').hostname;

const QUALITY = 90;
const WIDTHS = [640, 960, 1280, 1536, 1920, 2560];
const LIGHTBOX_MAX_WIDTH = 2400;

/** Article bodies sit in a max-w-3xl (768px) column. */
export const INSIGHT_BODY_COLUMN = 768;
/** Portfolio sections share the row with a sidebar from lg up. */
export const WORK_BODY_COLUMN = 800;

// WordPress inserts scaled renditions like "chart-1024x726.png"; the
// original lives at "chart.png". Mirrors fullSizeSrc in BodyImageLightbox.
function originalUrl(src: string): string {
    return src.replace(/-\d+x\d+(?=\.(?:jpe?g|png|webp|avif)$)/i, '');
}

function isOptimizable(src: string): boolean {
    try {
        const url = new URL(src);
        return url.hostname === WP_HOST && /\.(jpe?g|png|webp|avif)$/i.test(url.pathname);
    } catch {
        return false;
    }
}

async function sourceFor(src: string): Promise<{ url: string; width: number; height: number }> {
    const original = originalUrl(src);
    if (original !== src) {
        try {
            const size = await inferRemoteSize(original);
            return { url: original, width: size.width, height: size.height };
        } catch {
            // Original missing or renamed: fall back to the rendition in the post.
        }
    }
    const size = await inferRemoteSize(src);
    return { url: src, width: size.width, height: size.height };
}

export interface OptimizedImage {
    src: string;
    srcset: string;
    sizes: string;
    width: number;
    height: number;
    /** Large rendition for lightbox zoom, when requested. */
    fullSrc?: string;
}

export interface OptimizeOptions {
    /** Widest the image is ever shown, in CSS px. Defaults to the source width. */
    displayWidth?: number;
    /** Fixed display height in CSS px (logos); the width follows the aspect ratio. */
    displayHeight?: number;
    /** `sizes` attribute; defaults to the display width (full width below it, unless height-fixed). */
    sizes?: string;
    /** Also produce a large rendition for a lightbox. */
    full?: boolean;
}

/**
 * Responsive WebP renditions of a WordPress-hosted image, built from the
 * original upload. Returns null when the URL cannot be processed (other
 * hosts, SVG, GIF, fetch failure); callers then use the original URL.
 */
export async function optimizeWpImage(url: string | null | undefined, options: OptimizeOptions = {}): Promise<OptimizedImage | null> {
    if (!url || !isOptimizable(url)) return null;
    try {
        const source = await sourceFor(url);
        const scale = (w: number) => Math.round((w / source.width) * source.height);

        const requested = options.displayHeight
            ? Math.round((options.displayHeight * source.width) / source.height)
            : options.displayWidth ?? source.width;
        const displayWidth = Math.min(requested, source.width);

        // Enough widths for a 2x screen at the display size, never upscaled.
        // Small images (logos, thumbnails) get exact 1x and 2x renditions.
        const fit = WIDTHS.filter((w) => w <= source.width && w <= displayWidth * 2);
        const widths = displayWidth < WIDTHS[0] || !fit.length
            ? Array.from(new Set([displayWidth, Math.min(source.width, displayWidth * 2)]))
            : fit;
        const width = Math.min(displayWidth, widths[widths.length - 1]);
        const sizes = options.sizes
            ?? (options.displayHeight ? `${displayWidth}px` : `(min-width: ${displayWidth + 32}px) ${displayWidth}px, 100vw`);

        const fullWidth = Math.min(source.width, LIGHTBOX_MAX_WIDTH);
        const [image, full] = await Promise.all([
            getImage({ src: source.url, width, height: scale(width), widths, sizes, format: 'webp', quality: QUALITY }),
            options.full
                ? getImage({ src: source.url, width: fullWidth, height: scale(fullWidth), format: 'webp', quality: QUALITY })
                : undefined,
        ]);

        return { src: image.src, srcset: image.srcSet.attribute, sizes, width, height: scale(width), fullSrc: full?.src };
    } catch (error) {
        console.warn(`[contentImages] Optimisation failed, using original: ${url}`, error);
        return null;
    }
}

async function optimizeImg(tag: string, rawAttrs: string, column: number): Promise<string> {
    const attrs = parseAttrs(rawAttrs);
    const rawSrc = attrs.get('src');
    if (typeof rawSrc !== 'string') return tag;

    // The width the author inserted (e.g. WordPress "large" = 1024) caps how
    // wide the image displays; the column caps it further.
    const attrWidth = Number(attrs.get('width')) || column;
    const image = await optimizeWpImage(decodeAttr(rawSrc), { displayWidth: Math.min(attrWidth, column), full: true });
    if (!image) return tag;

    attrs.set('src', image.src);
    attrs.set('srcset', image.srcset);
    attrs.set('sizes', image.sizes);
    attrs.set('width', String(image.width));
    attrs.set('height', String(image.height));
    if (image.fullSrc) attrs.set('data-full-src', image.fullSrc);
    if (!attrs.has('loading')) attrs.set('loading', 'lazy');
    if (!attrs.has('decoding')) attrs.set('decoding', 'async');
    return `<img ${serializeAttrs(attrs)} />`;
}

/** Re-encode every WordPress-hosted <img> in rich text as responsive WebP. */
export async function optimizeContentImages(html: string, column = INSIGHT_BODY_COLUMN): Promise<string> {
    if (!html || !/<img\b/i.test(html)) return html;
    const matches = Array.from(html.matchAll(/<img\b([^>]*?)\/?>/gi));
    const replacements = await Promise.all(matches.map(([tag, rawAttrs]) => optimizeImg(tag, rawAttrs, column)));
    let i = 0;
    return html.replace(/<img\b([^>]*?)\/?>/gi, () => replacements[i++]);
}
