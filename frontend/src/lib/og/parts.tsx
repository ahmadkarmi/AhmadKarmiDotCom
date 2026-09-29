// Shared building blocks for the share cards. Satori supports a subset of CSS:
// every element with more than one child needs an explicit `display: flex`,
// and <img> needs explicit width/height.

import type { ReactNode } from 'react';
import type { CardImage } from './render';

export const BRAND = {
    paper: '#fbf9f3',
    ink: '#13151a',
    secondary: '#5b6471',
    accent: '#2664ec',
    rule: '#dcd8cf',
    chip: '#f1eee6',
} as const;

export const SANS = 'Inter';
export const SERIF = 'Playfair Display';

// The site's faint dot grid. Satori ignores repeating CSS gradients, so it is
// an SVG pattern image layered under the content instead.
const DOT_GRID = `data:image/svg+xml;base64,${Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">` +
        `<defs><pattern id="d" width="32" height="32" patternUnits="userSpaceOnUse">` +
        `<circle cx="2" cy="2" r="1.3" fill="${BRAND.ink}" fill-opacity="0.08"/></pattern></defs>` +
        `<rect width="1200" height="630" fill="url(#d)"/></svg>`
).toString('base64')}`;

/** Paper background with the dot grid and the card padding. */
export function Frame({ children }: { children: ReactNode }) {
    return (
        <div
            style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                position: 'relative',
                padding: '60px 80px 56px',
                backgroundColor: BRAND.paper,
                fontFamily: SANS,
                color: BRAND.ink,
            }}
        >
            <img src={DOT_GRID} width={1200} height={630} style={{ position: 'absolute', top: 0, left: 0 }} />
            {children}
        </div>
    );
}

/** Small letter-spaced label, e.g. "INSIGHT · 6 MIN READ · SEP 2026". */
export function Kicker({ parts }: { parts: string[] }) {
    return (
        <div
            style={{
                display: 'flex',
                fontSize: 18,
                fontWeight: 600,
                letterSpacing: 3,
                textTransform: 'uppercase',
                color: BRAND.secondary,
            }}
        >
            {parts.filter(Boolean).join('  ·  ')}
        </div>
    );
}

export function Pill({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'accent' }) {
    const accent = tone === 'accent';
    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                padding: '8px 20px',
                borderRadius: 999,
                fontSize: 20,
                fontWeight: 600,
                color: accent ? BRAND.accent : BRAND.ink,
                backgroundColor: accent ? 'rgba(38,100,236,0.08)' : BRAND.chip,
                border: `1.5px solid ${accent ? 'rgba(38,100,236,0.35)' : BRAND.rule}`,
            }}
        >
            {accent && (
                <div
                    style={{
                        width: 10,
                        height: 10,
                        borderRadius: 999,
                        backgroundColor: BRAND.accent,
                        marginRight: 10,
                    }}
                />
            )}
            {label}
        </div>
    );
}

/** Blue accent rule, then avatar + name + site. */
export function Byline({ avatar }: { avatar: CardImage }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div
                style={{
                    width: 140,
                    height: 4,
                    borderRadius: 4,
                    backgroundColor: BRAND.accent,
                    marginBottom: 24,
                }}
            />
            <div style={{ display: 'flex', alignItems: 'center' }}>
                <img
                    src={avatar.src}
                    width={56}
                    height={56}
                    style={{ borderRadius: 999, border: `2px solid ${BRAND.rule}` }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 16 }}>
                    <div style={{ fontSize: 22, fontWeight: 600, color: BRAND.ink }}>Ahmad Al-Karmi</div>
                    <div style={{ fontSize: 18, fontWeight: 500, color: BRAND.secondary, marginTop: 2 }}>
                        ahmadkarmi.com
                    </div>
                </div>
            </div>
        </div>
    );
}

export function Img({ image }: { image: CardImage }) {
    return <img src={image.src} width={image.width} height={image.height} />;
}

/** Serif headline with a line clamp so long titles end in an ellipsis. */
export function Headline({ text, fontSize, maxLines }: { text: string; fontSize: number; maxLines: number }) {
    return (
        <div
            style={{
                display: 'block',
                fontFamily: SERIF,
                fontWeight: 700,
                fontSize,
                lineHeight: 1.12,
                letterSpacing: -1,
                color: BRAND.ink,
                lineClamp: maxLines,
            }}
        >
            {text}
        </div>
    );
}
