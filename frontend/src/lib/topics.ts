// Article topics, single source of truth.
//
// Every insight carries 1 or 2 of these tags in WordPress and nothing else.
// Keeping the taxonomy this small tells search engines which few subjects the
// site covers, instead of the 36 one-off tags it used to have.
//
// Order is the rank: an article's main topic is its highest-ranked tag, since
// WordPress does not keep tag order. Middle East & GCC is a regional lens and
// is only ever a secondary tag. Names, slugs and descriptions mirror the tags
// in WordPress; the descriptions double as the topic page intros.
//
// No import.meta here: scripts/build-llms.ts imports this file under tsx.

export interface Topic {
  name: string;
  slug: string;
  description: string;
  /** Regional lens: never an article's main topic. */
  lens?: boolean;
}

export const TOPICS: Topic[] = [
  {
    name: 'AI Product Management',
    slug: 'ai-product-management',
    description:
      'Building AI into real products: delivery frameworks, AI in go-to-market and responsible design, and the operating models that make AI features add up.',
  },
  {
    name: 'AI & Society',
    slug: 'ai-and-society',
    description:
      'How AI and big tech reshape politics, creativity, privacy and energy, and what that means for the people who build products.',
  },
  {
    name: 'Product Leadership',
    slug: 'product-leadership',
    description:
      'Strategy, prioritisation, metrics and decision-making for product managers, and how to grow into the role.',
  },
  {
    name: 'Growth & Go-to-Market',
    slug: 'growth-and-go-to-market',
    description:
      'Launches, customer acquisition, network effects and the go-to-market choices that decide whether a product grows.',
  },
  {
    name: 'Agile Delivery',
    slug: 'agile-delivery',
    description:
      'The craft of shipping: backlogs, estimation, scope control, Kanban and the documentation that keeps teams aligned.',
  },
  {
    name: 'Digital Transformation',
    slug: 'digital-transformation',
    description:
      'Modernising organisations and industries, from airlines and banking to smart cities, and the teams that drive the change.',
  },
  {
    name: 'Middle East & GCC',
    slug: 'middle-east-and-gcc',
    description:
      'Building products for the Gulf and the wider Middle East: its markets, its users and why the playbook differs.',
    lens: true,
  },
];

/** A topic gets its own page once it has at least this many articles. */
export const MIN_ARTICLES_FOR_TOPIC_PAGE = 3;

const RANK = new Map(TOPICS.map((t, i) => [t.name, i]));

export function topicByName(name: string): Topic | undefined {
  return TOPICS.find((t) => t.name === name);
}

export function topicBySlug(slug: string): Topic | undefined {
  return TOPICS.find((t) => t.slug === slug);
}

/** Tags sorted by topic rank, so tags[0] is the main topic. Unknown tags go last. */
export function sortByTopicRank(tags: string[]): string[] {
  return [...tags].sort((a, b) => (RANK.get(a) ?? 99) - (RANK.get(b) ?? 99));
}

/** The article's main topic: its highest-ranked tag. */
export function primaryTopic(tags: string[] = []): Topic | undefined {
  const first = sortByTopicRank(tags)[0];
  return first ? topicByName(first) : undefined;
}

/** Hub page path for a topic. */
export function topicPath(topic: Topic): string {
  return `/insights/topic/${topic.slug}`;
}

/** Articles tagged with the topic, main or secondary. */
export function articlesInTopic<T extends { tags?: string[] }>(items: T[], topic: Topic): T[] {
  return items.filter((item) => item.tags?.includes(topic.name));
}

/** Topics with enough articles for their own page, in rank order. */
export function topicsWithPages(items: { tags?: string[] }[]): Topic[] {
  return TOPICS.filter((t) => articlesInTopic(items, t).length >= MIN_ARTICLES_FOR_TOPIC_PAGE);
}

/**
 * Build-time guard so the taxonomy cannot drift: every article must carry 1 or
 * 2 known topic tags, and the regional lens cannot be its only tag. Throws with
 * every problem listed, which fails the build before anything is published.
 */
export function assertTopicTags(items: { slug: string; tags?: string[] }[]): void {
  const problems: string[] = [];
  for (const item of items) {
    const tags = item.tags ?? [];
    const unknown = tags.filter((t) => !RANK.has(t));
    if (tags.length === 0) problems.push(`${item.slug}: no topic tag`);
    if (tags.length > 2) problems.push(`${item.slug}: ${tags.length} tags (max 2)`);
    if (unknown.length) problems.push(`${item.slug}: unknown tag(s) ${unknown.join(', ')}`);
    if (tags.length > 0 && tags.every((t) => topicByName(t)?.lens)) {
      problems.push(`${item.slug}: only a regional tag; add a main topic`);
    }
  }
  if (problems.length) {
    throw new Error(
      `Article tags must be 1 or 2 of: ${TOPICS.map((t) => t.name).join(', ')}.\n  ` + problems.join('\n  ')
    );
  }
}
