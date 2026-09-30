import fs from 'node:fs';

const EXECUTE = process.argv.includes('--execute');
const env = Object.fromEntries(
  fs.readFileSync('D:/Dev/Apps/ahmadkarmidotcom/frontend/.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; })
);
const WP = env.PUBLIC_WP_URL;
const AUTH = 'Basic ' + Buffer.from(`${env.WP_USER}:${env.WP_APP_PASSWORD}`).toString('base64');
async function call(method, path, body) {
  const r = await fetch(WP + path, { method, headers: { Authorization: AUTH, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${t.slice(0, 200)}`);
  return JSON.parse(t);
}

const TOPICS = [
  { key: 'AIPM', name: 'AI Product Management', slug: 'ai-product-management', description: 'Building AI into real products: delivery frameworks, AI in go-to-market and responsible design, and the operating models that make AI features add up.' },
  { key: 'AIS', name: 'AI & Society', slug: 'ai-and-society', description: 'How AI and big tech reshape politics, creativity, privacy and energy, and what that means for the people who build products.' },
  { key: 'PL', name: 'Product Leadership', slug: 'product-leadership', description: 'Strategy, prioritisation, metrics and decision-making for product managers, and how to grow into the role.' },
  { key: 'GTM', name: 'Growth & Go-to-Market', slug: 'growth-and-go-to-market', description: 'Launches, customer acquisition, network effects and the go-to-market choices that decide whether a product grows.' },
  { key: 'AD', name: 'Agile Delivery', slug: 'agile-delivery', description: 'The craft of shipping: backlogs, estimation, scope control, Kanban and the documentation that keeps teams aligned.' },
  { key: 'DT', name: 'Digital Transformation', slug: 'digital-transformation', description: 'Modernising organisations and industries, from airlines and banking to smart cities, and the teams that drive the change.' },
  { key: 'ME', name: 'Middle East & GCC', slug: 'middle-east-and-gcc', description: 'Building products for the Gulf and the wider Middle East: its markets, its users and why the playbook differs.' },
];

const MAP = {
  'ai-features-compound-ai-organizations-dont-a-note-on-what-ive-learned-about-ai-delivery-frameworks': ['AIPM'],
  'ai-will-not-fix-a-broken-gtm-strategy-here-is-what-it-will-do': ['AIPM', 'GTM'],
  'how-to-integrate-ai-into-your-gtm-strategy-for-maximum-impact': ['AIPM', 'GTM'],
  'ai-in-dealership-service-where-fixed-operations-leak-profit-and-how-to-stop-it': ['AIPM', 'DT'],
  'building-fair-tech-how-pms-can-mitigate-ai-bias-in-their-products': ['AIPM', 'AIS'],
  'beyond-persuasion-is-ai-engineering-a-systematic-threat-to-politics': ['AIS'],
  'the-new-divide-who-gets-to-shape-the-digital-world-and-who-gets-shaped-by-it': ['AIS'],
  'when-machines-paint-the-unfolding-debate-over-ai-generated-art': ['AIS'],
  'the-dark-side-of-big-tech-are-your-smart-devices-always-listening': ['AIS'],
  'the-energy-cost-of-artificial-intelligence': ['AIS'],
  'quantum-computing-and-ai-the-next-frontier': ['AIS'],
  'product-management-is-dead-modern-business-killed-it': ['PL'],
  'why-product-management-in-the-middle-east-needs-its-own-playbook': ['PL', 'ME'],
  'the-art-of-crafting-exceptional-product-experiences': ['PL'],
  'the-rice-framework-a-valuable-tool-but-not-the-whole-picture': ['PL'],
  'mastering-strategic-performance-indicators-in-product-management': ['PL'],
  'the-imperative-of-data-driven-decision-making-in-product-management-an-analytical-perspective': ['PL'],
  'the-unbalanced-scale-how-information-asymmetry-shapes-product-management': ['PL'],
  'paretos-principle-and-becoming-a-more-effective-product-manager': ['PL'],
  'common-product-management-mistakes-to-avoid': ['PL'],
  '5-ways-to-transition-into-product-management': ['PL'],
  'mastering-product-management-your-ultimate-beginners-guide': ['PL'],
  'the-roadmap-to-success-essential-traits-and-qualities-for-coos-in-the-years-ahead': ['PL'],
  'navigating-the-esports-industry-tips-for-professionals': ['PL'],
  'what-they-dont-tell-you-about-product-launches': ['GTM'],
  'network-effects-the-economic-engine-of-product-growth': ['GTM'],
  'customer-acquisition-cost-cac-explained': ['GTM'],
  'how-to-build-an-esports-team-on-a-shoestring-budget': ['GTM'],
  'why-gaming-influencers-are-key-players-in-the-future-of-esports': ['GTM'],
  'how-to-manage-product-scope-and-feature-creep': ['AD'],
  'leveraging-the-fibonacci-sequence-for-effective-project-estimation-in-agile-and-scrum': ['AD'],
  'best-practices-for-effective-product-backlog-management': ['AD'],
  'the-significance-of-product-documentation': ['AD'],
  'kanban-framework-overview': ['AD'],
  'digital-banking-and-product-management-lessons-from-the-kuwaiti-market': ['DT', 'ME'],
  'real-time-monitoring-and-predictive-maintenance-the-backbone-of-smart-city-operations': ['DT'],
  'airlines-iata-the-openapi-hub': ['DT'],
  'empowering-your-digital-transformation-teams': ['DT'],
};

// WordPress duplicates carry a -2 style suffix; bound to 1-2 digits so slugs
// ending in a year are left alone.
const stem = (s) => s.replace(/-\d{1,2}$/, '');

const backup = JSON.parse(fs.readFileSync('wp-tags-backup.json', 'utf8'));
const unmapped = backup.insights.filter((p) => !MAP[stem(p.slug)]);
const usedStems = new Set(backup.insights.map((p) => stem(p.slug)));
const unusedMap = Object.keys(MAP).filter((k) => !usedStems.has(k));
console.log(`posts: ${backup.insights.length}, distinct stems: ${usedStems.size}, mapping entries: ${Object.keys(MAP).length}`);
console.log(`unmapped posts: ${unmapped.length ? unmapped.map((p) => p.slug).join(', ') : 'none'} | mapping entries with no post: ${unusedMap.length ? unusedMap.join(', ') : 'none'}`);
const counts = {};
for (const k of Object.keys(MAP)) for (const t of MAP[k]) counts[t] = (counts[t] || 0) + 1;
console.log('articles per topic:', TOPICS.map((t) => `${t.name} ${counts[t.key] || 0}`).join(' | '));
if (unmapped.length || unusedMap.length) { console.log('STOP: the mapping does not cover WordPress exactly.'); process.exit(1); }
if (!EXECUTE) { console.log('Dry run only. Re-run with --execute to apply.'); process.exit(0); }

// 1. Create or update the 7 topic tags, reusing an existing tag with the same slug.
const idByKey = {};
for (const t of TOPICS) {
  const hit = backup.tags.find((e) => e.slug === t.slug);
  const res = hit
    ? await call('POST', `/wp-json/wp/v2/tags/${hit.id}`, { name: t.name, description: t.description })
    : await call('POST', '/wp-json/wp/v2/tags', { name: t.name, slug: t.slug, description: t.description });
  idByKey[t.key] = res.id;
  console.log(`${hit ? 'updated' : 'created'} tag ${res.id} ${res.name} (${res.slug})`);
}

// 2. Give every post exactly its topic tags (this replaces its existing tags).
let n = 0;
for (const p of backup.insights) {
  await call('POST', `/wp-json/wp/v2/insight/${p.id}`, { tags: MAP[stem(p.slug)].map((k) => idByKey[k]) });
  n++;
}
console.log(`retagged ${n} posts`);

// 3. Delete every old tag that is not one of the 7 topics.
const keep = new Set(Object.values(idByKey));
let d = 0;
for (const t of backup.tags) {
  if (keep.has(t.id)) continue;
  await call('DELETE', `/wp-json/wp/v2/tags/${t.id}?force=true`);
  d++;
}
console.log(`deleted ${d} old tags`);
