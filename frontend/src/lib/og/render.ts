// Build-time renderer for the per-post social share cards (og:image).
//
// Satori turns the card JSX into an SVG with every glyph converted to a path,
// so the output never depends on fonts installed on the build machine (the
// old sharp-only social card silently fell back to system fonts). sharp then
// rasterises that SVG to a palette PNG small enough for WhatsApp, which drops
// previews much over ~300 KB.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { ReactNode } from 'react';
import satori from 'satori';
import sharp from 'sharp';
import { DEFAULT_SOCIAL_CARD, OG_CARD_SIZE } from './urls';

// Builds run from frontend/ locally and on Vercel (`npm run build --prefix
// frontend`), but resolve against both so a root-level invocation still works.
const FRONTEND_DIR = existsSync(path.join(process.cwd(), 'public', 'brand'))
    ? process.cwd()
    : path.join(process.cwd(), 'frontend');

const requireFromFrontend = createRequire(path.join(FRONTEND_DIR, 'package.json'));

/** Absolute path to a file under frontend/public. */
export function publicFile(relative: string): string {
    return path.join(FRONTEND_DIR, 'public', relative.replace(/^\//, ''));
}

// ---------------------------------------------------------------------------
// Fonts and images
// ---------------------------------------------------------------------------

type SatoriFont = { name: string; data: Buffer; weight: 400 | 500 | 600 | 700; style: 'normal' | 'italic' };

// Satori reads woff/ttf/otf but not woff2; @fontsource ships .woff for each cut.
const FONT_FILES: Array<Omit<SatoriFont, 'data'> & { file: string }> = [
    { name: 'Inter', weight: 500, style: 'normal', file: '@fontsource/inter/files/inter-latin-500-normal.woff' },
    { name: 'Inter', weight: 600, style: 'normal', file: '@fontsource/inter/files/inter-latin-600-normal.woff' },
    { name: 'Playfair Display', weight: 700, style: 'normal', file: '@fontsource/playfair-display/files/playfair-display-latin-700-normal.woff' },
];

let fontsPromise: Promise<SatoriFont[]> | undefined;

function loadFonts(): Promise<SatoriFont[]> {
    fontsPromise ??= Promise.all(
        FONT_FILES.map(async ({ file, ...font }) => ({
            ...font,
            data: await readFile(requireFromFrontend.resolve(file)),
        }))
    );
    return fontsPromise;
}

export interface CardImage {
    src: string;
    /** Display size: half the rasterised size, so images stay crisp at 2x. */
    width: number;
    height: number;
}

type Box = { width: number; height: number; cover?: boolean };

async function toCardImage(input: Buffer, box: Box): Promise<CardImage> {
    const { data, info } = await sharp(input, { density: 300 })
        .resize(box.width * 2, box.height * 2, {
            fit: box.cover ? 'cover' : 'inside',
            withoutEnlargement: !box.cover,
        })
        .png()
        .toBuffer({ resolveWithObject: true });

    // Scale the display size to fit the box even when the source was smaller
    // than 2x and withoutEnlargement kept it small.
    const scale = Math.min(box.width / info.width, box.height / info.height);
    return {
        src: `data:image/png;base64,${data.toString('base64')}`,
        width: Math.round(info.width * scale),
        height: Math.round(info.height * scale),
    };
}

const localImageCache = new Map<string, Promise<CardImage>>();

/** A frontend/public image as a PNG data URI, resized once per build. */
export function localImage(relative: string, box: Box): Promise<CardImage> {
    const key = `${relative}:${box.width}x${box.height}:${box.cover ? 'c' : 'i'}`;
    let cached = localImageCache.get(key);
    if (!cached) {
        cached = readFile(publicFile(relative)).then((buf) => toCardImage(buf, box));
        localImageCache.set(key, cached);
    }
    return cached;
}

/**
 * A remote image as a PNG data URI (webp and svg logos included), or
 * undefined on any failure so the card falls back instead of breaking the build.
 */
export async function remoteImage(url: string | null | undefined, box: Box): Promise<CardImage | undefined> {
    if (!url) return undefined;
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) return undefined;
        return await toCardImage(Buffer.from(await res.arrayBuffer()), box);
    } catch {
        return undefined;
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Render a card element to a 1200x630 PNG. */
export async function renderCard(element: ReactNode): Promise<Buffer> {
    const svg = await satori(element as any, {
        width: OG_CARD_SIZE.width,
        height: OG_CARD_SIZE.height,
        fonts: await loadFonts(),
    });
    return sharp(Buffer.from(svg))
        .png({ palette: true, quality: 90, compressionLevel: 9 })
        .toBuffer();
}

/**
 * Try each card builder in turn (full card, then a variant without remote
 * images) and fall back to the static brand card, so one bad post can never
 * fail the build or publish a broken og:image.
 */
export async function renderWithFallback(label: string, builders: Array<() => Promise<ReactNode>>): Promise<Buffer> {
    for (const build of builders) {
        try {
            return await renderCard(await build());
        } catch (err) {
            console.warn(`[og] ${label}: card render failed, trying fallback.`, err);
        }
    }
    return readFile(publicFile(DEFAULT_SOCIAL_CARD));
}

export function pngResponse(png: Buffer): Response {
    return new Response(new Uint8Array(png), {
        headers: { 'Content-Type': 'image/png' },
    });
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…',
    mdash: ', ', ndash: ', ',
};

/** Plain, single-line text from WP HTML or markdown, with dashes kept out of card copy. */
export function toCardText(value?: string | null): string {
    if (!value) return '';
    return value
        .replace(/<[^>]+>/g, ' ')
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
        .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
        .replace(/[*_`#>]+/g, '')
        .replace(/\s*[–—]\s*/g, ', ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Trim to at most `max` characters on a word boundary, with an ellipsis. */
export function truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    const cut = text.slice(0, max);
    const lastSpace = cut.lastIndexOf(' ');
    return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:]+$/, '')}…`;
}

/** "Sep 2026" */
export function monthYear(value?: string): string {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}
