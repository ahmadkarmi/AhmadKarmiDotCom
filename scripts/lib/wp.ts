// WordPress source adapter for Ask Ahmad ingestion.
//
// Fetches both `insight` (blog posts) and `work` (portfolio projects), resolves
// tag IDs to names, dedupes by slug-stem (the WP migration ran twice and
// produced `slug-2` duplicates of every entry), and filters obvious test data.

const WP = process.env.PUBLIC_WP_URL;
if (!WP) throw new Error('PUBLIC_WP_URL not set');

const PER_PAGE = 100;

export type WpPostType = 'insight' | 'work';

export interface RawWpPost {
  id: number;
  date: string;
  modified: string;
  slug: string;
  status: string;
  title: { rendered: string };
  content: { rendered: string };
  tags?: number[];
  acf?: Record<string, unknown>;
  link?: string;
}

export interface NormalizedPost {
  type: WpPostType;
  id: number;
  slug: string;
  slugStem: string;
  title: string;
  date: string;
  url: string; // canonical frontend URL
  tags: string[];
  body: string; // raw HTML, stripped downstream
  // Per-type rich fields, all raw HTML or plain strings:
  insightDescription?: string;
  workBrief?: string;
  workScope?: string;
  workDetails?: string;
  workClient?: string;
  featured?: boolean;
}

async function fetchAllPages<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  let page = 1;
  while (true) {
    const res = await fetch(`${WP}${path}${path.includes('?') ? '&' : '?'}per_page=${PER_PAGE}&page=${page}`);
    if (res.status === 400) break; // WP returns 400 past the last page
    if (!res.ok) throw new Error(`WP fetch ${path} page=${page} -> ${res.status}`);
    const batch = (await res.json()) as T[];
    out.push(...batch);
    const totalPages = Number(res.headers.get('x-wp-totalpages') ?? '1');
    if (page >= totalPages) break;
    page += 1;
  }
  return out;
}

async function fetchTagMap(): Promise<Map<number, string>> {
  const tags = await fetchAllPages<{ id: number; name: string }>(
    '/wp-json/wp/v2/tags?_fields=id,name'
  );
  return new Map(tags.map((t) => [t.id, t.name]));
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function frontendUrl(type: WpPostType, slugStemValue: string): string {
  // Live site uses plural paths: /insights/<slug> and /portfolio/<slug>.
  // The WP REST `link` field returns the singular type slug (/insight/, /work/),
  // so we ignore it and build the canonical frontend URL from the deduped stem.
  const segment = type === 'insight' ? 'insights' : 'portfolio';
  return `https://www.ahmadkarmi.com/${segment}/${slugStemValue}`;
}

function slugStem(slug: string): string {
  // Strip trailing -N (the WP duplicate suffix). E.g., "story-point-calculator-2" -> "story-point-calculator".
  return slug.replace(/-\d+$/, '');
}

const TEST_PATTERNS = [/\bacf-?test\b/i, /\btest[-_]?client\b/i];

function isTestData(p: RawWpPost): boolean {
  if (TEST_PATTERNS.some((re) => re.test(p.slug))) return true;
  if (TEST_PATTERNS.some((re) => re.test(decodeEntities(p.title?.rendered ?? '')))) return true;
  const client = (p.acf as { client?: string } | undefined)?.client ?? '';
  if (TEST_PATTERNS.some((re) => re.test(client))) return true;
  return false;
}

function normalize(type: WpPostType, p: RawWpPost, tagMap: Map<number, string>): NormalizedPost {
  const tags = (p.tags ?? []).map((id) => tagMap.get(id)).filter((s): s is string => Boolean(s));
  const acf = (p.acf ?? {}) as Record<string, unknown>;
  const link = frontendUrl(type, slugStem(p.slug));

  const base: NormalizedPost = {
    type,
    id: p.id,
    slug: p.slug,
    slugStem: slugStem(p.slug),
    title: decodeEntities(p.title?.rendered ?? ''),
    date: p.date,
    url: link,
    tags,
    body: p.content?.rendered ?? '',
    featured: Boolean(acf.featured),
  };

  if (type === 'insight') {
    base.insightDescription = stringField(acf.description);
  } else {
    base.workBrief = stringField(acf.brief);
    base.workScope = stringField(acf.scope);
    base.workDetails = stringField(acf.details);
    base.workClient = stringField(acf.client);
  }
  return base;
}

function stringField(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// Dedupe: group by slugStem, keep the entry with the highest ID
// (the more-recent migration run usually wrote -2 with a higher ID).
function dedupe(posts: NormalizedPost[]): { kept: NormalizedPost[]; dropped: NormalizedPost[] } {
  const byStem = new Map<string, NormalizedPost[]>();
  for (const p of posts) {
    const arr = byStem.get(p.slugStem) ?? [];
    arr.push(p);
    byStem.set(p.slugStem, arr);
  }
  const kept: NormalizedPost[] = [];
  const dropped: NormalizedPost[] = [];
  for (const arr of byStem.values()) {
    arr.sort((a, b) => b.id - a.id);
    kept.push(arr[0]);
    dropped.push(...arr.slice(1));
  }
  return { kept, dropped };
}

export interface FetchResult {
  posts: NormalizedPost[];
  stats: {
    type: WpPostType;
    raw: number;
    afterTestFilter: number;
    afterDedupe: number;
    droppedDuplicates: number;
    droppedTest: number;
  }[];
}

// Single-post fetch for the incremental webhook path. Returns null when the
// post is missing, not published, or test data — the caller treats null as
// "nothing to ingest" (and, for the webhook, falls back to a delete).
export async function fetchWordPressPostById(
  type: WpPostType,
  id: number
): Promise<NormalizedPost | null> {
  const res = await fetch(
    `${WP}/wp-json/wp/v2/${type}/${id}?_fields=id,date,modified,slug,status,title,content,tags,acf,link`
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`WP fetch ${type}/${id} -> ${res.status}`);
  const raw = (await res.json()) as RawWpPost;
  if (raw.status !== 'publish') return null;
  if (isTestData(raw)) return null;
  const tagMap = await fetchTagMap();
  return normalize(type, raw, tagMap);
}

export async function fetchWordPress(
  types: WpPostType[] = ['insight', 'work'],
  opts: { onlyPublished?: boolean } = { onlyPublished: true }
): Promise<FetchResult> {
  const tagMap = await fetchTagMap();
  const stats: FetchResult['stats'] = [];
  const all: NormalizedPost[] = [];

  for (const type of types) {
    const raw = await fetchAllPages<RawWpPost>(
      `/wp-json/wp/v2/${type}?_fields=id,date,modified,slug,status,title,content,tags,acf,link`
    );
    const live = opts.onlyPublished ? raw.filter((p) => p.status === 'publish') : raw;
    const nonTest = live.filter((p) => !isTestData(p));
    const droppedTest = live.length - nonTest.length;

    const normalized = nonTest.map((p) => normalize(type, p, tagMap));
    const { kept, dropped } = dedupe(normalized);

    stats.push({
      type,
      raw: raw.length,
      afterTestFilter: nonTest.length,
      afterDedupe: kept.length,
      droppedDuplicates: dropped.length,
      droppedTest,
    });
    all.push(...kept);
  }

  return { posts: all, stats };
}
