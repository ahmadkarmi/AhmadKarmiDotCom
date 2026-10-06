// Build-time treatment for <video> elements inside WordPress rich text.
//
// WordPress emits a bare native player (often with preload="auto", which pulls
// the whole file on every page view) and a full-size poster. This rewrites
// each video into a click-to-play block:
//
// - preload="none": no video bytes until the visitor asks for them.
// - The poster is re-encoded through Astro's image pipeline (WebP, capped
//   width) so the only eager cost is a small image.
// - Native controls are withheld until first play and replaced by one
//   consistent play button (ContentVideo.astro wires it up), so the tap
//   behaviour is identical on desktop and iOS.
// - Width/height/aspect-ratio are kept so the frame reserves space (no CLS).
//
// It also returns metadata for schema.org VideoObject nodes, so the videos
// are eligible for Google video indexing without relying on the player.

import { getImage, inferRemoteSize } from 'astro:assets';

export interface ContentVideo {
    src: string;
    poster?: string;
    caption?: string;
    durationSeconds?: number;
}

const POSTER_WIDTH = 1600;
const PLAY_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.96-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z" fill="currentColor"/></svg>';

export type Attrs = Map<string, string | true>;

export function parseAttrs(source: string): Attrs {
    const attrs: Attrs = new Map();
    const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) {
        const value = m[2] ?? m[3] ?? m[4];
        attrs.set(m[1].toLowerCase(), value === undefined ? true : value);
    }
    return attrs;
}

export function serializeAttrs(attrs: Attrs): string {
    return Array.from(attrs, ([name, value]) =>
        value === true ? name : `${name}="${String(value).replace(/"/g, '&quot;')}"`
    ).join(' ');
}

export function decodeAttr(value: string): string {
    return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");
}

function escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function optimizePoster(url: string): Promise<string> {
    try {
        // Scale explicitly: with inferSize and only a width, getImage keeps the
        // source height and would squash the poster.
        const source = await inferRemoteSize(url);
        const width = Math.min(POSTER_WIDTH, source.width);
        const height = Math.round((width / source.width) * source.height);
        const image = await getImage({ src: url, width, height, format: 'webp', quality: 75 });
        return image.src;
    } catch (error) {
        console.warn(`[contentVideo] Poster optimisation failed, using original: ${url}`, error);
        return url;
    }
}

// Reads the movie header (mvhd) from the first 64KB of an MP4. Web-optimised
// ("faststart") files keep moov at the front, so this is one small range
// request. Anything else just yields no duration.
async function probeMp4Duration(url: string): Promise<number | undefined> {
    if (!/\.(mp4|m4v|mov)(\?|$)/i.test(url)) return undefined;
    try {
        const res = await fetch(url, {
            headers: { Range: 'bytes=0-65535' },
            signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return undefined;
        const buf = new Uint8Array(await res.arrayBuffer());
        const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        for (let i = 4; i + 32 <= buf.length; i++) {
            if (buf[i] !== 0x6d || buf[i + 1] !== 0x76 || buf[i + 2] !== 0x68 || buf[i + 3] !== 0x64) continue; // "mvhd"
            const version = buf[i + 4];
            if (version === 1) {
                const timescale = view.getUint32(i + 24);
                const duration = Number(view.getBigUint64(i + 28));
                return timescale ? duration / timescale : undefined;
            }
            const timescale = view.getUint32(i + 16);
            const duration = view.getUint32(i + 20);
            return timescale ? duration / timescale : undefined;
        }
    } catch {
        // Network or parse failure: the schema simply omits duration.
    }
    return undefined;
}

export async function enhanceContentVideos(html: string): Promise<{ html: string; videos: ContentVideo[] }> {
    if (!html || !/<video\b/i.test(html)) return { html, videos: [] };

    const matches = Array.from(html.matchAll(/<video\b([^>]*)>([\s\S]*?)<\/video>/gi));
    const videos: ContentVideo[] = [];
    const replacements: string[] = [];

    for (const match of matches) {
        const [, rawAttrs, inner] = match;
        const attrs = parseAttrs(rawAttrs);

        let src = typeof attrs.get('src') === 'string' ? (attrs.get('src') as string) : '';
        if (!src) src = inner.match(/<source\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] || '';
        src = decodeAttr(src);

        const originalPoster = typeof attrs.get('poster') === 'string' ? decodeAttr(attrs.get('poster') as string) : '';

        // Captions sit in the surrounding figure, after the video.
        const after = html.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 600);
        const caption = after.match(/^\s*<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i)?.[1]
            ?.replace(/<[^>]*>/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        const [poster, durationSeconds] = await Promise.all([
            originalPoster ? optimizePoster(originalPoster) : Promise.resolve(''),
            src ? probeMp4Duration(src) : Promise.resolve(undefined),
        ]);

        attrs.set('preload', 'none');
        attrs.set('playsinline', true);
        attrs.delete('autoplay');
        attrs.delete('controls');
        if (poster) attrs.set('poster', poster);
        attrs.set('data-content-video', true);

        const label = caption ? `Play video: ${caption}` : 'Play video';
        replacements.push(
            `<div class="content-video">` +
            `<video ${serializeAttrs(attrs)}>${inner}</video>` +
            `<button type="button" class="content-video-play" data-content-video-play aria-label="${escapeHtml(label)}">` +
            `<span class="content-video-play__icon">${PLAY_ICON}</span></button>` +
            `</div>`
        );

        if (src) {
            videos.push({
                src,
                poster: originalPoster || undefined,
                caption: caption || undefined,
                durationSeconds,
            });
        }
    }

    let i = 0;
    const out = html.replace(/<video\b([^>]*)>([\s\S]*?)<\/video>/gi, () => replacements[i++]);
    return { html: out, videos };
}

function isoDuration(seconds: number): string {
    const total = Math.max(1, Math.round(seconds));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${s ? `${s}S` : ''}`;
}

function toIsoDate(value?: string): string | undefined {
    if (!value) return undefined;
    const time = Date.parse(value);
    return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

/**
 * schema.org VideoObject nodes for the page graph. Google requires name,
 * thumbnailUrl and uploadDate; videos without a poster are skipped because
 * they cannot qualify and would only raise Search Console warnings.
 */
export function videoObjectNodes(
    videos: ContentVideo[],
    page: { url: string; name: string; description?: string; uploadDate?: string }
): Record<string, any>[] {
    const uploadDate = toIsoDate(page.uploadDate);
    if (!uploadDate) return [];

    return videos
        .filter((video) => video.poster)
        .map((video, index) => ({
            '@type': 'VideoObject',
            '@id': `${page.url}#video-${index + 1}`,
            name: video.caption || (videos.length > 1 ? `${page.name} (video ${index + 1})` : page.name),
            description: video.caption || page.description || page.name,
            thumbnailUrl: [video.poster],
            uploadDate,
            contentUrl: video.src,
            ...(video.durationSeconds ? { duration: isoDuration(video.durationSeconds) } : {}),
            inLanguage: 'en',
        }));
}
