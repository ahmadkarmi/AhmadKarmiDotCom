import { neon } from '@neondatabase/serverless';

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
const EMBED_MODEL = 'voyage-3-large';

export interface RetrievedChunk {
  id: string;
  source: string;
  source_type: string;
  source_id: string;
  source_url: string;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
}

async function embedQuery(text: string): Promise<number[]> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error('VOYAGE_API_KEY not set');
  const res = await fetch(VOYAGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ input: [text], model: EMBED_MODEL, input_type: 'query' }),
  });
  if (!res.ok) throw new Error(`Voyage embed query ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { data: { embedding: number[] }[] };
  return data.data[0].embedding;
}

export async function retrieve(query: string, topK = 5): Promise<RetrievedChunk[]> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const sql = neon(url);
  const embedding = await embedQuery(query);
  const vec = `[${embedding.join(',')}]`;

  // Cosine distance via the <=> operator. similarity = 1 - distance.
  const rows = (await sql(
    `SELECT id, source, source_type, source_id, source_url, title, content, metadata,
            1 - (embedding <=> $1::vector) AS similarity
     FROM chunks
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [vec, topK]
  )) as RetrievedChunk[];

  return rows;
}
