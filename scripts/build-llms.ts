// Builds /llms.txt and /llms-full.txt and writes them into frontend/public/
// so they ship with the Astro static build.
//
//   /llms.txt      — curated markdown index per the llmstxt.org convention.
//                    A short, human-readable map of the site for AI agents.
//   /llms-full.txt — full content of every insight + portfolio entry as
//                    plain markdown, so an agent can ingest the whole
//                    corpus in one fetch.
//
// Wired into the build lifecycle via frontend/package.json `prebuild` so
// Vercel regenerates these on every deploy. New WP articles pick up
// automatically.

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchWordPress, type NormalizedPost } from './lib/wp';
import { stripHtml } from './lib/chunk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(REPO_ROOT, 'frontend', 'public');

const SITE = 'https://www.ahmadkarmi.com';

function fmtDate(d: string): string {
  return d.slice(0, 10);
}

function buildLlmsIndex(insights: NormalizedPost[], works: NormalizedPost[]): string {
  const sorted = [...insights].sort((a, b) => b.date.localeCompare(a.date));
  const aiPicks = sorted.filter((p) => p.tags.some((t) => /ai|artificial/i.test(t))).slice(0, 6);
  const pmPicks = sorted
    .filter((p) => !p.tags.some((t) => /ai|artificial/i.test(t)))
    .filter((p) => p.tags.some((t) => /product|pm|management/i.test(t)))
    .slice(0, 6);

  const insightLines = sorted.map((p) => `- [${p.title}](${p.url}): ${fmtDate(p.date)}`);
  const workLines = works.map((p) => `- [${p.title}](${p.url})${p.workClient ? ` — ${p.workClient}` : ''}`);

  return `# Ahmad Al-Karmi

> Senior Product Manager for Loyalty and Growth Products at Al Jazeera Media Network. AI-focused product manager with 14 plus years shipping digital products from enterprise through consumer. Native English and Arabic. Based in Kuwait, commutes to Doha for the Al Jazeera role. Open to relocation.

This site documents Ahmad's product thinking through long-form articles, a working portfolio, and an AI assistant (K.AI) that surfaces his POVs on demand.

## Site map

- [About](${SITE}/about): full bio, career history, education, credentials
- [Insights](${SITE}/insights): published writing on AI product management, PM craft, digital strategy
- [Portfolio](${SITE}/portfolio): project case studies (note: portfolio is partial because much current work is under NDA)
- [Contact](${SITE}/contact): direct outreach

## Recent AI writing

${aiPicks.map((p) => `- [${p.title}](${p.url}): ${fmtDate(p.date)}`).join('\n')}

## Recent product management writing

${pmPicks.map((p) => `- [${p.title}](${p.url}): ${fmtDate(p.date)}`).join('\n')}

## Full insight catalog (${sorted.length} articles)

${insightLines.join('\n')}

## Portfolio (${works.length} projects)

${workLines.join('\n')}

## AI assistant

[K.AI](${SITE}) is an in-page chatbot that answers questions about Ahmad's work using retrieval over his published corpus. Trained on the full insights and portfolio above plus a hand-curated voice pack capturing his POVs in his own voice.

## Optional

- [Trakr](https://trakr-mobile.vercel.app/): compliance audit SAAS Ahmad shipped solo
- [Story Point Calculator](https://www.storypointcalculator.com/): agile sprint planning tool Ahmad shipped solo
- [LinkedIn](https://www.linkedin.com/in/akarmi)
- [Email](mailto:alkarmi.ahmad@gmail.com)
`;
}

function postToMarkdown(p: NormalizedPost): string {
  const body = stripHtml(p.body).trim();
  const description = p.insightDescription ? stripHtml(p.insightDescription).trim() : '';
  const tagLine = p.tags.length ? `\n*Tags: ${p.tags.join(', ')}*\n` : '';
  const dateLine = p.date ? `*Published: ${fmtDate(p.date)}*` : '';
  const lead = description && description !== body.slice(0, description.length) ? `\n> ${description}\n` : '';
  return `## ${p.title}

${dateLine}${tagLine}
URL: ${p.url}
${lead}
${body}
`;
}

function workToMarkdown(p: NormalizedPost): string {
  const lines: string[] = [];
  lines.push(`## ${p.title}`);
  if (p.workClient) lines.push(`*Client: ${p.workClient}*`);
  lines.push(`URL: ${p.url}`);
  lines.push('');
  if (p.workBrief) {
    lines.push('### Brief');
    lines.push(stripHtml(p.workBrief).trim());
    lines.push('');
  }
  if (p.workScope) {
    lines.push('### Scope');
    lines.push(stripHtml(p.workScope).trim());
    lines.push('');
  }
  if (p.workDetails) {
    lines.push('### Details');
    lines.push(stripHtml(p.workDetails).trim());
    lines.push('');
  }
  const body = stripHtml(p.body).trim();
  if (body) {
    lines.push(body);
    lines.push('');
  }
  return lines.join('\n');
}

function buildLlmsFull(insights: NormalizedPost[], works: NormalizedPost[]): string {
  const header = `# Ahmad Al-Karmi — Full Corpus

> Senior Product Manager for Loyalty and Growth Products at Al Jazeera Media Network. This file contains every published article and portfolio entry in full, intended for AI agents that want to ingest the entire corpus in a single fetch.

Site: ${SITE}
Articles: ${insights.length}
Portfolio entries: ${works.length}
Generated: ${new Date().toISOString().slice(0, 19)}Z

---

# Insights

`;

  const sortedInsights = [...insights].sort((a, b) => b.date.localeCompare(a.date));
  const insightSections = sortedInsights.map(postToMarkdown).join('\n\n---\n\n');

  const portfolioHeader = '\n\n---\n\n# Portfolio\n\n';
  const workSections = works.map(workToMarkdown).join('\n\n---\n\n');

  return header + insightSections + portfolioHeader + workSections;
}

async function main() {
  console.log('[build-llms] fetching WordPress (insight + work)…');
  let result;
  try {
    result = await fetchWordPress(['insight', 'work']);
  } catch (err) {
    // Don't fail the build if WP is unreachable — emit minimal placeholders.
    console.warn('[build-llms] WP fetch failed, writing placeholder llms files:', err instanceof Error ? err.message : err);
    await mkdir(PUBLIC_DIR, { recursive: true });
    const placeholder = `# Ahmad Al-Karmi\n\nSee ${SITE} for content.\n`;
    await writeFile(path.join(PUBLIC_DIR, 'llms.txt'), placeholder);
    await writeFile(path.join(PUBLIC_DIR, 'llms-full.txt'), placeholder);
    return;
  }

  const insights = result.posts.filter((p) => p.type === 'insight');
  const works = result.posts.filter((p) => p.type === 'work');
  for (const s of result.stats) {
    console.log(`[build-llms]   ${s.type.padEnd(7)} raw=${s.raw} test_filtered=${s.droppedTest} deduped=${s.droppedDuplicates} kept=${s.afterDedupe}`);
  }

  const indexMd = buildLlmsIndex(insights, works);
  const fullMd = buildLlmsFull(insights, works);

  await mkdir(PUBLIC_DIR, { recursive: true });
  await writeFile(path.join(PUBLIC_DIR, 'llms.txt'), indexMd, 'utf8');
  await writeFile(path.join(PUBLIC_DIR, 'llms-full.txt'), fullMd, 'utf8');

  console.log(`[build-llms] wrote llms.txt (${indexMd.length.toLocaleString()} chars)`);
  console.log(`[build-llms] wrote llms-full.txt (${fullMd.length.toLocaleString()} chars)`);
}

main().catch((err) => {
  console.error('[build-llms] failed:', err);
  process.exit(1);
});
