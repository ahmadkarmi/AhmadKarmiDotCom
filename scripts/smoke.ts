// Smoke test: verifies API keys, env loading, and provider reachability.
//
//   npm run smoke
//
// Pings Anthropic (cheapest model, ~$0.0001), Voyage embeddings (~$0),
// and the WordPress REST API. Use this before iterating to catch a bad
// key or a typo'd env var early.

import { anthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';

type Result = { name: string; ok: boolean; detail: string };

async function checkEnv(): Promise<Result[]> {
  const required = [
    'ASK_AHMAD_ENABLED',
    'ANTHROPIC_API_KEY',
    'PUBLIC_WP_URL',
  ];
  const results: Result[] = [];
  for (const key of required) {
    const present = Boolean(process.env[key]);
    results.push({
      name: `env: ${key}`,
      ok: present,
      detail: present ? 'set' : 'MISSING',
    });
  }
  const hasVoyage = Boolean(process.env.VOYAGE_API_KEY);
  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
  results.push({
    name: 'env: embeddings provider',
    ok: hasVoyage || hasOpenAI,
    detail: hasVoyage ? 'voyage' : hasOpenAI ? 'openai' : 'NEITHER set',
  });
  return results;
}

async function checkAnthropic(): Promise<Result> {
  try {
    const { text, usage } = await generateText({
      model: anthropic('claude-haiku-4-5'),
      prompt: 'Reply with exactly: ok',
      maxOutputTokens: 5,
    });
    return {
      name: 'anthropic: claude-haiku-4-5',
      ok: true,
      detail: `reply="${text.trim()}" tokens=${usage?.totalTokens ?? '?'}`,
    };
  } catch (err) {
    return {
      name: 'anthropic: claude-haiku-4-5',
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkVoyage(): Promise<Result> {
  if (!process.env.VOYAGE_API_KEY) {
    return { name: 'voyage: embed', ok: false, detail: 'VOYAGE_API_KEY not set' };
  }
  try {
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      },
      body: JSON.stringify({
        input: 'smoke test',
        model: 'voyage-3-large',
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { name: 'voyage: voyage-3-large', ok: false, detail: `${res.status} ${body.slice(0, 200)}` };
    }
    const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
    const dim = data?.data?.[0]?.embedding?.length;
    return { name: 'voyage: voyage-3-large', ok: true, detail: `embedding dim=${dim}` };
  } catch (err) {
    return {
      name: 'voyage: voyage-3-large',
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkWordPress(): Promise<Result> {
  const url = process.env.PUBLIC_WP_URL;
  if (!url) return { name: 'wordpress: REST', ok: false, detail: 'PUBLIC_WP_URL not set' };
  try {
    const res = await fetch(`${url}/wp-json/wp/v2/posts?per_page=1`);
    if (!res.ok) {
      return { name: 'wordpress: REST', ok: false, detail: `HTTP ${res.status}` };
    }
    const posts = (await res.json()) as Array<{ id: number; title: { rendered: string } }>;
    return {
      name: 'wordpress: REST',
      ok: true,
      detail: `latest="${posts[0]?.title?.rendered?.slice(0, 60) ?? '(none)'}"`,
    };
  } catch (err) {
    return {
      name: 'wordpress: REST',
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

function render(results: Result[]): void {
  const pad = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    const status = r.ok ? '✓' : '✗';
    console.log(`  ${status}  ${r.name.padEnd(pad)}  ${r.detail}`);
  }
}

async function main() {
  console.log('\n[smoke] Ask Ahmad smoke test\n');

  console.log('Environment:');
  const env = await checkEnv();
  render(env);

  console.log('\nProviders:');
  const provs = await Promise.all([checkAnthropic(), checkVoyage(), checkWordPress()]);
  render(provs);

  const all = [...env, ...provs];
  const failed = all.filter((r) => !r.ok);
  console.log('');
  if (failed.length === 0) {
    console.log('[smoke] all checks passed. ready to wire ingestion.');
    process.exit(0);
  } else {
    console.log(`[smoke] ${failed.length} check(s) failed.`);
    process.exit(1);
  }
}

main();
