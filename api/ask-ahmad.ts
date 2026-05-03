import type { VercelRequest, VercelResponse } from '@vercel/node';
import { anthropic } from '@ai-sdk/anthropic';
import {
  convertToModelMessages,
  createUIMessageStream,
  pipeUIMessageStreamToResponse,
  streamText,
  type UIMessage,
} from 'ai';

import { isAskAhmadEnabled } from './_lib/feature-flag';
import { retrieve } from './_lib/retrieve';
import { buildSystemPrompt, isValidMode, type Mode } from './_lib/system-prompt';
import { checkRateLimit } from './_lib/rate-limit';

// Default function timeout is 300s on Vercel Fluid Compute — plenty for chat.

const MODEL = 'claude-sonnet-4-6';

interface ChatBody {
  messages?: UIMessage[];
  mode?: Mode;
}

function envCheck(): { missing: string[]; present: string[] } {
  const required = ['ANTHROPIC_API_KEY', 'VOYAGE_API_KEY', 'DATABASE_URL', 'KV_REST_API_URL', 'KV_REST_API_TOKEN'];
  const missing: string[] = [];
  const present: string[] = [];
  for (const k of required) {
    if (process.env[k]) present.push(k);
    else missing.push(k);
  }
  return { missing, present };
}

function hashStr(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

function uiMessageToText(m: UIMessage): string {
  if (!Array.isArray((m as { parts?: unknown }).parts)) {
    return String((m as { content?: unknown }).content ?? '');
  }
  return (m.parts as Array<{ type: string; text?: string }>)
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('\n')
    .trim();
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const t0 = Date.now();
  const log = (msg: string) => console.log(`[ask-ahmad +${Date.now() - t0}ms] ${msg}`);
  log(`handler entry method=${req.method}`);

  if (!isAskAhmadEnabled()) {
    res.status(503).json({ error: 'feature_disabled' });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const env = envCheck();
  log(`env present=[${env.present.join(',')}] missing=[${env.missing.join(',')}]`);

  // @vercel/node auto-parses JSON bodies when Content-Type is application/json,
  // populating req.body as the parsed object. Fall back to manual parse if it's
  // a string for any reason.
  let body: ChatBody;
  try {
    if (typeof req.body === 'string') {
      body = JSON.parse(req.body);
    } else if (req.body && typeof req.body === 'object') {
      body = req.body as ChatBody;
    } else {
      throw new Error(`unexpected body type: ${typeof req.body}`);
    }
  } catch (err) {
    log(`body parse FAILED: ${err instanceof Error ? err.message : String(err)}`);
    res.status(400).json({ error: 'invalid_json' });
    return;
  }

  const messages = body.messages ?? [];
  const mode: Mode = isValidMode(body.mode) ? body.mode : 'anyone';
  if (messages.length === 0) {
    res.status(400).json({ error: 'no_messages' });
    return;
  }
  log(`body parsed: ${messages.length} message(s), mode=${mode}`);

  const fwd = (req.headers['x-forwarded-for'] as string | undefined) ?? '';
  const ip = fwd.split(',')[0]?.trim() || (req.headers['x-real-ip'] as string | undefined) || 'anon';
  const ua = (req.headers['user-agent'] as string | undefined) ?? '';
  const identifier = `${ip}:${hashStr(ua)}`;

  log('about to checkRateLimit…');
  let rl: { ok: boolean; limit: number; remaining: number; reset: number };
  try {
    rl = await Promise.race([
      checkRateLimit(identifier),
      new Promise<typeof rl>((resolve) =>
        setTimeout(() => resolve({ ok: true, limit: 20, remaining: 20, reset: Date.now() + 3600_000 }), 3000)
      ),
    ]);
  } catch (err) {
    log(`rate limit error (failing open): ${err instanceof Error ? err.message : String(err)}`);
    rl = { ok: true, limit: 20, remaining: 20, reset: Date.now() + 3600_000 };
  }
  log(`rate limit done ok=${rl.ok} remaining=${rl.remaining}`);

  if (!rl.ok) {
    res.status(429).json({
      error: 'rate_limited',
      limit: rl.limit,
      remaining: rl.remaining,
      reset: rl.reset,
      message: `You've hit the hourly limit of ${rl.limit} questions. Email Ahmad directly: https://www.ahmadkarmi.com/contact`,
    });
    return;
  }

  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUser) {
    res.status(400).json({ error: 'no_user_message' });
    return;
  }
  const lastUserText = uiMessageToText(lastUser);

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      log('stream execute start');
      writer.write({
        type: 'data-status',
        id: 'status',
        data: { stage: 'embedding', label: 'Embedding your question…' },
      });

      let chunks;
      try {
        log('calling retrieve…');
        chunks = await retrieve(lastUserText, 5);
        log(`retrieve done (${chunks.length} chunks)`);
      } catch (err) {
        log(`retrieve FAILED: ${err instanceof Error ? err.message : String(err)}`);
        writer.write({
          type: 'data-status',
          id: 'status',
          data: { stage: 'error', label: `Retrieval failed: ${err instanceof Error ? err.message : 'unknown'}` },
        });
        throw err;
      }

      writer.write({
        type: 'data-status',
        id: 'status',
        data: {
          stage: 'retrieved',
          label: `Found ${chunks.length} relevant chunk${chunks.length === 1 ? '' : 's'} from the corpus.`,
        },
      });

      writer.write({
        type: 'data-citations',
        id: 'citations',
        data: {
          chunks: chunks.map((c) => ({
            title: c.title,
            url: c.source_url,
            similarity: Number(c.similarity.toFixed(3)),
            sourceType: c.source_type,
          })),
        },
      });

      writer.write({
        type: 'data-status',
        id: 'status',
        data: { stage: 'thinking', label: 'Thinking with Claude Sonnet 4.6…' },
      });

      log('building system prompt + converting messages…');
      const system = buildSystemPrompt(mode, chunks);
      const modelMessages = await convertToModelMessages(messages);
      log('calling streamText…');

      const result = streamText({
        model: anthropic(MODEL),
        system,
        messages: modelMessages,
        maxOutputTokens: 600,
        temperature: 0.4,
        onFinish: () => {
          log('streamText finished');
          writer.write({
            type: 'data-status',
            id: 'status',
            data: { stage: 'done', label: 'Done.' },
          });
        },
      });

      log('merging stream…');
      writer.merge(result.toUIMessageStream());
      log('writer.merge returned');
    },
    onError: (err) => {
      log(`stream onError: ${err instanceof Error ? err.message : String(err)}`);
      return err instanceof Error ? err.message : String(err);
    },
  });

  res.setHeader('x-ratelimit-limit', String(rl.limit));
  res.setHeader('x-ratelimit-remaining', String(rl.remaining));
  res.setHeader('x-ratelimit-reset', String(rl.reset));
  log('piping stream to response…');
  pipeUIMessageStreamToResponse({ response: res, stream });
}
