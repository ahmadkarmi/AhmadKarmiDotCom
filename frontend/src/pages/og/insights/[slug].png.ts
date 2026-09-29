// Build-time share card for each insight, served at /og/insights/{slug}.png
// and referenced as the og:image by pages/insights/[slug].astro.

import type { APIRoute, GetStaticPaths } from 'astro';
import { fetchInsights, type Insight } from '../../../lib/wordpress';
import { buildInsightCard } from '../../../lib/og/InsightCard';
import { pngResponse, renderWithFallback } from '../../../lib/og/render';

export const getStaticPaths: GetStaticPaths = async () => {
    const insights = await fetchInsights();
    return insights.map((insight) => ({
        params: { slug: insight.slug },
        props: { insight },
    }));
};

export const GET: APIRoute = async ({ props }) => {
    const { insight } = props as { insight: Insight };
    const png = await renderWithFallback(`insight ${insight.slug}`, [() => buildInsightCard(insight)]);
    return pngResponse(png);
};
