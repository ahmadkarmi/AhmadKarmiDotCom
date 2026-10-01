// Responsive sizes for WordPress images, so a phone never downloads the
// 1280px desktop file. Widths above the source's own width are dropped
// (never upscale); the source width is the fallback when all are.

import { getImage } from 'astro:assets';

/** Insight cards: 1 column on phones, 2 on tablets, 3 on desktop (max ~400px). */
export const CARD_WIDTHS = [400, 800];
export const CARD_SIZES = '(min-width: 1280px) 400px, (min-width: 768px) 50vw, 90vw';

/** Article hero: full width up to the max-w-4xl (896px) column. */
export const HERO_WIDTHS = [640, 960, 1280];
export const HERO_SIZES = '(min-width: 960px) 896px, 100vw';

export function widthsFor(sourceWidth: number, widths: number[]): number[] {
  const fit = widths.filter((w) => w <= sourceWidth);
  return fit.length ? fit : [sourceWidth];
}

/**
 * Card image as plain attributes, for the React card on /insights, which
 * cannot use <Image>. Returns null when there is no usable image.
 */
export async function cardImageAttrs(
  url: string | null,
  sourceWidth = 800,
  sourceHeight = 400
): Promise<{ src: string; srcset: string; sizes: string; width: number; height: number } | null> {
  if (!url) return null;
  const widths = widthsFor(sourceWidth, CARD_WIDTHS);
  const width = widths[widths.length - 1];
  const height = Math.round((width / sourceWidth) * sourceHeight);
  const img = await getImage({ src: url, width, height, widths, sizes: CARD_SIZES, format: 'webp' });
  return { src: img.src, srcset: img.srcSet.attribute, sizes: CARD_SIZES, width, height };
}
