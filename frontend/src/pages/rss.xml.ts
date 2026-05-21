// RSS 2.0 feed for the Insights blog, served at /rss.xml.
//
// The /insights page has long linked to /rss.xml, but no feed route existed,
// so the link 404'd. This endpoint generates the feed at build time from the
// same WordPress source the site uses, so it stays in sync automatically.

import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { fetchInsights } from '../lib/wordpress';

export async function GET(context: APIContext) {
  const insights = await fetchInsights();
  const site = context.site?.toString() || 'https://www.ahmadkarmi.com';

  return rss({
    title: 'Insights by Ahmad Al-Karmi',
    description:
      'Articles on AI product management, digital transformation, and building products that matter.',
    site,
    items: insights.map((insight) => ({
      title: insight.name,
      link: `/insights/${insight.slug}`,
      pubDate: insight.publishDate ? new Date(insight.publishDate) : undefined,
      description: insight.description,
      categories: insight.tags,
    })),
    customData: '<language>en-us</language>',
  });
}
