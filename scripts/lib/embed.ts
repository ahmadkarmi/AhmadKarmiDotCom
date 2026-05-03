// Voyage embeddings batch wrapper.
//
// voyage-3-large returns 1024-dim float vectors. The API accepts up to 128
// inputs per request and ~120K tokens per request; we batch on count to keep
// it simple. Falls back gracefully on transient failures.

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
const MODEL = 'voyage-3-large';
// Tuned for Voyage paid tier (300 RPM / 1M TPM). On free tier (3 RPM / 10K TPM)
// the retry-on-429 logic below kicks in automatically and slows things down to
// safe pacing — no config swap needed.
const BATCH_SIZE = 64;
const REQUEST_SPACING_MS = 250;
const MAX_RETRIES = 5;
const RATE_LIMIT_BACKOFF_MS = 25_000; // backoff for 429 (free-tier minute window)

interface VoyageResponse {
  data: { embedding: number[]; index: number }[];
  usage?: { total_tokens?: number };
  model?: string;
}

async function embedOnce(inputs: string[]): Promise<{ embeddings: number[][]; tokens: number }> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error('VOYAGE_API_KEY not set');

  const res = await fetch(VOYAGE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ input: inputs, model: MODEL, input_type: 'document' }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Voyage ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as VoyageResponse;
  // Sort by index in case API reorders.
  const sorted = [...data.data].sort((a, b) => a.index - b.index);
  return {
    embeddings: sorted.map((d) => d.embedding),
    tokens: data.usage?.total_tokens ?? 0,
  };
}

function isRateLimitErr(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /\b429\b/.test(err.message);
}

async function embedBatchWithRetry(inputs: string[]): Promise<{ embeddings: number[][]; tokens: number }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await embedOnce(inputs);
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES - 1) {
        const delay = isRateLimitErr(err) ? RATE_LIMIT_BACKOFF_MS : 500 * Math.pow(2, attempt);
        if (isRateLimitErr(err)) {
          console.log(`[embed]    rate limited, backing off ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
        }
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

export interface EmbedResult {
  embeddings: number[][];
  totalTokens: number;
  dim: number;
  model: string;
}

export async function embedAll(inputs: string[]): Promise<EmbedResult> {
  if (inputs.length === 0) {
    return { embeddings: [], totalTokens: 0, dim: 1024, model: MODEL };
  }
  const out: number[][] = [];
  let totalTokens = 0;
  const batches = Math.ceil(inputs.length / BATCH_SIZE);
  console.log(`[embed]    ${inputs.length} inputs in ${batches} batches of ${BATCH_SIZE} (~${Math.round((batches * REQUEST_SPACING_MS) / 1000)}s for free-tier pacing)`);

  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    const slice = inputs.slice(i, i + BATCH_SIZE);
    const batchIndex = Math.floor(i / BATCH_SIZE);
    if (batchIndex > 0) {
      // Space requests to stay under free-tier 3 RPM. With paid Voyage this
      // adds a few wasted seconds per batch which is fine for one-time ingest.
      await new Promise((r) => setTimeout(r, REQUEST_SPACING_MS));
    }
    process.stdout.write(`[embed]    batch ${batchIndex + 1}/${batches}… `);
    const { embeddings, tokens } = await embedBatchWithRetry(slice);
    out.push(...embeddings);
    totalTokens += tokens;
    console.log(`ok (${embeddings.length} vectors, ${tokens} tokens)`);
  }
  return { embeddings: out, totalTokens, dim: out[0]?.length ?? 1024, model: MODEL };
}

export function estimateCostUsd(tokens: number): number {
  // voyage-3-large: $0.18 / 1M tokens
  return (tokens / 1_000_000) * 0.18;
}
