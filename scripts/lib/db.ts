// Neon Postgres + pgvector writer for Ask Ahmad chunks.
//
// Until DATABASE_URL is provisioned (Neon installed via Vercel Marketplace),
// this module operates in dry-run mode: every method logs what it WOULD do
// and returns plausible counts so the rest of the pipeline can validate.
//
// Once DATABASE_URL exists, real writes turn on automatically.

import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

export interface ChunkRow {
  id: string; // e.g. "wp:insight:457:body:0"
  source: string; // "wp" | "voice-pack" | "portfolio-mdx"
  source_type: string; // "insight" | "work" | "voice"
  source_id: string;
  source_url: string;
  title: string;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}

const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_type TEXT,
  source_id TEXT,
  source_url TEXT,
  title TEXT,
  content TEXT NOT NULL,
  embedding VECTOR(1024) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw_idx
  ON chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS chunks_source_idx
  ON chunks (source, source_type, source_id);

CREATE INDEX IF NOT EXISTS chunks_metadata_gin_idx
  ON chunks USING gin (metadata);
`;

export class ChunkStore {
  private sql: NeonQueryFunction<false, false> | null;
  readonly dryRun: boolean;

  constructor() {
    const url = process.env.DATABASE_URL;
    if (url) {
      this.sql = neon(url);
      this.dryRun = false;
    } else {
      this.sql = null;
      this.dryRun = true;
    }
  }

  async ensureSchema(): Promise<void> {
    if (this.dryRun || !this.sql) {
      console.log('[db] DRY RUN: would create extension + chunks table + indexes');
      return;
    }
    // neon() runs each statement individually; split on semicolons.
    const stmts = SCHEMA_SQL.split(';').map((s) => s.trim()).filter(Boolean);
    for (const stmt of stmts) {
      await this.sql.query(stmt);
    }
  }

  async deleteBySource(source: string, sourceType?: string): Promise<number> {
    if (this.dryRun || !this.sql) {
      console.log(`[db] DRY RUN: would delete chunks WHERE source='${source}'${sourceType ? ` AND source_type='${sourceType}'` : ''}`);
      return 0;
    }
    const result = sourceType
      ? await this.sql.query(`DELETE FROM chunks WHERE source = $1 AND source_type = $2`, [source, sourceType])
      : await this.sql.query(`DELETE FROM chunks WHERE source = $1`, [source]);
    return (result as { rowCount?: number }).rowCount ?? 0;
  }

  async upsertMany(rows: ChunkRow[]): Promise<number> {
    if (this.dryRun || !this.sql) {
      console.log(`[db] DRY RUN: would upsert ${rows.length} chunks`);
      return rows.length;
    }
    if (rows.length === 0) return 0;
    // Insert one at a time to keep this simple and safe; switch to a single
    // bulk INSERT once volumes are large enough to matter (we're at ~hundreds,
    // not thousands).
    let written = 0;
    for (const r of rows) {
      const vec = `[${r.embedding.join(',')}]`;
      await this.sql.query(
        `INSERT INTO chunks (id, source, source_type, source_id, source_url, title, content, embedding, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector, $9::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           source_url = EXCLUDED.source_url,
           title = EXCLUDED.title,
           content = EXCLUDED.content,
           embedding = EXCLUDED.embedding,
           metadata = EXCLUDED.metadata`,
        [r.id, r.source, r.source_type, r.source_id, r.source_url, r.title, r.content, vec, JSON.stringify(r.metadata)]
      );
      written += 1;
    }
    return written;
  }
}
