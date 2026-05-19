// Per-post ingestion helpers.
//
// Shared by the full-rebuild orchestrator (scripts/ingest.ts) and the
// incremental webhook (api/wp-webhook.ts). The chunk builders are pure
// functions over a single NormalizedPost; ingestPostById / deletePostChunks
// wrap them with fetch + embed + DB write for the webhook path.

import { fetchWordPressPostById, type NormalizedPost, type WpPostType } from './wp';
import { stripHtml, chunkText } from './chunk';
import { embedAll } from './embed';
import { ChunkStore, type ChunkRow } from './db';

export interface PendingChunk {
  id: string;
  source: string;
  source_type: string;
  source_id: string;
  source_url: string;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
}

export function chunksFromInsight(p: NormalizedPost): PendingChunk[] {
  const out: PendingChunk[] = [];
  // 1. Description goes in as a high-priority single chunk (when present).
  if (p.insightDescription) {
    const text = stripHtml(p.insightDescription);
    if (text) {
      out.push({
        id: `wp:insight:${p.id}:description:0`,
        source: 'wp',
        source_type: 'insight',
        source_id: String(p.id),
        source_url: p.url,
        title: p.title,
        content: text,
        metadata: { field: 'description', tags: p.tags, date: p.date, featured: p.featured },
      });
    }
  }
  // 2. Body chunked semantically.
  const bodyText = stripHtml(p.body);
  for (const c of chunkText(bodyText)) {
    out.push({
      id: `wp:insight:${p.id}:body:${c.index}`,
      source: 'wp',
      source_type: 'insight',
      source_id: String(p.id),
      source_url: p.url,
      title: p.title,
      content: c.text,
      metadata: { field: 'body', position: c.index, tags: p.tags, date: p.date, featured: p.featured },
    });
  }
  return out;
}

export function chunksFromWork(p: NormalizedPost): PendingChunk[] {
  const out: PendingChunk[] = [];
  const richFields: Array<['brief' | 'scope' | 'details', string | undefined]> = [
    ['brief', p.workBrief],
    ['scope', p.workScope],
    ['details', p.workDetails],
  ];
  for (const [name, raw] of richFields) {
    if (!raw) continue;
    const text = stripHtml(raw);
    if (!text) continue;
    // Brief/scope/details usually short — keep as single chunks unless big.
    for (const c of chunkText(text)) {
      out.push({
        id: `wp:work:${p.id}:${name}:${c.index}`,
        source: 'wp',
        source_type: 'work',
        source_id: String(p.id),
        source_url: p.url,
        title: p.title,
        content: c.text,
        metadata: { field: name, position: c.index, client: p.workClient, tags: p.tags, date: p.date, featured: p.featured },
      });
    }
  }
  // Body, if present.
  const bodyText = stripHtml(p.body);
  for (const c of chunkText(bodyText)) {
    out.push({
      id: `wp:work:${p.id}:body:${c.index}`,
      source: 'wp',
      source_type: 'work',
      source_id: String(p.id),
      source_url: p.url,
      title: p.title,
      content: c.text,
      metadata: { field: 'body', position: c.index, client: p.workClient, tags: p.tags, date: p.date, featured: p.featured },
    });
  }
  return out;
}

export function chunksFromPost(p: NormalizedPost): PendingChunk[] {
  return p.type === 'insight' ? chunksFromInsight(p) : chunksFromWork(p);
}

export type IngestSingleResult =
  | { action: 'ingested'; written: number; deleted: number }
  | { action: 'deleted'; written: 0; deleted: number };

// Re-embed one post: fetch it, chunk it, embed it, replace its chunks in Neon.
// If the post is gone / unpublished / test data, falls through to a delete so
// the index never keeps a stale copy.
export async function ingestPostById(postId: number, postType: WpPostType): Promise<IngestSingleResult> {
  const post = await fetchWordPressPostById(postType, postId);
  if (!post) {
    const deleted = await deletePostChunks(postId, postType);
    return { action: 'deleted', written: 0, deleted };
  }

  const chunks = chunksFromPost(post);
  const store = new ChunkStore();
  await store.ensureSchema();

  // Drop the post's existing chunks first so renamed/removed fields don't
  // linger (e.g. a body that got shorter leaves no orphan body:N chunks).
  const deleted = await store.deleteBySourceIdAndType('wp', postType, String(postId));

  if (chunks.length === 0) {
    return { action: 'ingested', written: 0, deleted };
  }

  const { embeddings } = await embedAll(chunks.map((c) => c.content));
  if (embeddings.length !== chunks.length) {
    throw new Error(`embedding count mismatch: ${embeddings.length} vs ${chunks.length}`);
  }
  const rows: ChunkRow[] = chunks.map((c, i) => ({
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
  const written = await store.upsertMany(rows);
  return { action: 'ingested', written, deleted };
}

// Remove every chunk for one post (used on unpublish / delete).
export async function deletePostChunks(postId: number, postType: WpPostType): Promise<number> {
  const store = new ChunkStore();
  await store.ensureSchema();
  return store.deleteBySourceIdAndType('wp', postType, String(postId));
}
