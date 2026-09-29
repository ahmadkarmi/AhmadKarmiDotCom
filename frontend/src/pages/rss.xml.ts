// RSS 2.0 feed for the Insights blog, served at /rss.xml.
//
// The /insights page has long linked to /rss.xml, but no feed route existed,
// so the link 404'd. This endpoint generates the feed at build time from the
// same WordPress source the site uses, so it stays in sync automatically.

import rss from '@astrojs/rss';
import { fetchInsights } from '../lib/wordpress';
import { absoluteUrl } from '../lib/urls';

export async function GET() {
  const insights = await fetchInsights();
  // The channel <link> is the blog, not the homepage. Item links below are
  // already absolute, so this base is only used for the channel itself.
  const site = absoluteUrl('/insights');

  return rss({
    title: 'Insights by Ahmad Al-Karmi',
    description:
      'Articles on AI product management, digital transformation, and building products that matter.',
    site,
    trailingSlash: false,
    items: insights.map((insight) => ({
      title: insight.name,
      // Absolute, already canonical. A relative link here gets resolved by
      // @astrojs/rss against `site`, which re-adds the trailing slash the rest
      // of the site does not use.
      link: absoluteUrl(`/insights/${insight.slug}`),
      pubDate: insight.publishDate ? new Date(insight.publishDate) : undefined,
      description: insight.description,
      categories: insight.tags,
    })),
    customData: '<language>en-us</language>',
  });
}
