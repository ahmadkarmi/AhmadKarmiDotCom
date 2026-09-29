// Build-time share card for each portfolio work, served at
// /og/portfolio/{slug}.png and referenced as the og:image by
// pages/portfolio/[slug].astro.

import type { APIRoute, GetStaticPaths } from 'astro';
import { fetchWorks, type Work } from '../../../lib/wordpress';
import { buildWorkCard } from '../../../lib/og/WorkCard';
import { pngResponse, renderWithFallback } from '../../../lib/og/render';

export const getStaticPaths: GetStaticPaths = async () => {
    const works = await fetchWorks();
    return works.map((work) => ({
        params: { slug: work.slug },
        props: { work },
    }));
};

export const GET: APIRoute = async ({ props }) => {
    const { work } = props as { work: Work };
    const png = await renderWithFallback(`work ${work.slug}`, [
        () => buildWorkCard(work),
        () => buildWorkCard(work, { withRemote: false }),
    ]);
    return pngResponse(png);
};
