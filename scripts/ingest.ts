// Ask Ahmad ingestion orchestrator.
//
//   npm run ingest                    # full pipeline (DB write only if DATABASE_URL set)
//   npm run ingest -- --dry-run       # fetch + chunk + embed; skip DB write entirely
//   npm run ingest -- --no-embed      # fetch + chunk only; skip embeddings (free)
//   npm run ingest -- --no-wp         # skip WordPress (use only Voice Pack)
//   npm run ingest -- --no-voice      # skip Voice Pack
//
// Sources, in order:
//   1. WordPress: insight + work post types (with slug-stem dedupe, test filter)
//   2. content/voice-pack.yaml
//   (Portfolio MDX adapter slot reserved; not yet implemented since the live
//    portfolio pulls from WP work post type.)

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import yaml from 'js-yaml';

import { fetchWordPress } from './lib/wp';
import { embedAll, estimateCostUsd } from './lib/embed';
import { ChunkStore, type ChunkRow } from './lib/db';
import { chunksFromInsight, chunksFromWork, type PendingChunk } from './lib/ingest-single';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

interface Args {
  dryRun: boolean;
  noEmbed: boolean;
  noWp: boolean;
  noVoice: boolean;
}

function parseArgs(): Args {
  const set = new Set(process.argv.slice(2).map((s) => s.replace(/^--/, '')));
  return {
    dryRun: set.has('dry-run'),
    noEmbed: set.has('no-embed') || set.has('dry-run'),
    noWp: set.has('no-wp'),
    noVoice: set.has('no-voice'),
  };
}

interface VoicePackEntry {
  topic: string;
  question: string;
  answer: string;
  tags?: string[];
}

async function chunksFromVoicePack(): Promise<PendingChunk[]> {
  const file = path.join(REPO_ROOT, 'content', 'voice-pack.yaml');
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return [];
  }
  const entries = yaml.load(raw) as VoicePackEntry[] | null;
  if (!Array.isArray(entries)) return [];
  return entries.map((e, i) => ({
    id: `voice:${e.topic}:${i}`,
    source: 'voice-pack',
    source_type: 'voice',
    source_id: String(i),
    source_url: 'https://www.ahmadkarmi.com/about',
    title: e.topic,
    // Combined Q+A in a single chunk so retrieval can match either side.
    content: `Q: ${e.question}\n\nA: ${e.answer.trim()}`,
    metadata: { topic: e.topic, tags: e.tags ?? [], pack: 'voice' },
  }));
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(2)}MB`;
}

async function main() {
  const args = parseArgs();
  console.log('\n[ingest] Ask Ahmad ingestion');
  console.log(`[ingest] mode: ${args.dryRun ? 'DRY RUN (no DB write, no embeddings)' : args.noEmbed ? 'no-embed' : 'full'}`);
  console.log('');

  const all: PendingChunk[] = [];

  if (!args.noWp) {
    console.log('[ingest] -> fetching WordPress (insight + work)…');
    const { posts, stats } = await fetchWordPress(['insight', 'work']);
    for (const s of stats) {
      console.log(
        `[ingest]    ${s.type.padEnd(7)} raw=${s.raw}  test_filtered=${s.droppedTest}  deduped=${s.droppedDuplicates}  kept=${s.afterDedupe}`
      );
    }
    let insightChunks = 0;
    let workChunks = 0;
    for (const p of posts) {
      const chunks = p.type === 'insight' ? chunksFromInsight(p) : chunksFromWork(p);
      if (p.type === 'insight') insightChunks += chunks.length;
      else workChunks += chunks.length;
      all.push(...chunks);
    }
    console.log(`[ingest]    insight chunks: ${insightChunks}`);
    console.log(`[ingest]    work chunks:    ${workChunks}`);
  }

  if (!args.noVoice) {
    console.log('[ingest] -> loading Voice Pack…');
    const voice = await chunksFromVoicePack();
    console.log(`[ingest]    voice entries: ${voice.length}`);
    all.push(...voice);
  }

  console.log('');
  console.log(`[ingest] total chunks: ${all.length}`);
  const totalChars = all.reduce((s, c) => s + c.content.length, 0);
  const estTokens = Math.ceil(totalChars / 4);
  console.log(`[ingest] total content: ${fmtBytes(totalChars)} (~${estTokens.toLocaleString()} tokens)`);

  if (args.noEmbed) {
    console.log('');
    console.log('[ingest] --no-embed / --dry-run set, skipping embeddings.');
    console.log(`[ingest] would-be cost @ Voyage 3 large: ~$${estimateCostUsd(estTokens).toFixed(4)}`);
    if (all.length > 0) {
      console.log('');
      console.log('[ingest] sample chunk:');
      const s = all[0];
      console.log(`  id:       ${s.id}`);
      console.log(`  title:    ${s.title}`);
      console.log(`  url:      ${s.source_url}`);
      console.log(`  metadata: ${JSON.stringify(s.metadata)}`);
      console.log(`  preview:  ${s.content.slice(0, 200).replace(/\n/g, ' ')}…`);
    }
    process.exit(0);
  }

  console.log('');
  console.log('[ingest] -> embedding via Voyage 3 large…');
  const { embeddings, totalTokens, dim, model } = await embedAll(all.map((c) => c.content));
  console.log(`[ingest]    model=${model}  dim=${dim}  tokens=${totalTokens.toLocaleString()}  cost~$${estimateCostUsd(totalTokens).toFixed(4)}`);

  if (embeddings.length !== all.length) {
    throw new Error(`embedding count mismatch: ${embeddings.length} vs ${all.length}`);
  }

  const rows: ChunkRow[] = all.map((c, i) => ({
    id: c.id,
    source: c.source,
    source_type: c.source_type,
    source_id: c.source_id,
    source_url: c.source_url,
    title: c.title,
    content: c.content,
    embedding: embeddings[i],
    metadata: c.metadata,
  }));

  const store = new ChunkStore();
  console.log('');
  console.log(`[ingest] -> ${store.dryRun ? 'DRY RUN (no DATABASE_URL)' : 'writing to Neon'}`);
  await store.ensureSchema();
  const deleted = await store.deleteBySource('wp');
  if (!store.dryRun) console.log(`[ingest]    deleted ${deleted} stale wp chunks`);
  const written = await store.upsertMany(rows);
  console.log(`[ingest]    wrote ${written} chunks`);
  console.log('[ingest] done.');
}

main().catch((err) => {
  console.error('[ingest] failed:', err);
  process.exit(1);
});
