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

const MODEL = 'claude-sonnet-4-6';

interface ChatBody {
  messages?: UIMessage[];
  mode?: Mode;
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
  if (!isAskAhmadEnabled()) {
    res.status(503).json({ error: 'feature_disabled' });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  let body: ChatBody;
  try {
    if (typeof req.body === 'string') {
      body = JSON.parse(req.body);
    } else if (req.body && typeof req.body === 'object') {
      body = req.body as ChatBody;
    } else {
      throw new Error(`unexpected body type: ${typeof req.body}`);
    }
  } catch {
    res.status(400).json({ error: 'invalid_json' });
    return;
  }

  const messages = body.messages ?? [];
  const mode: Mode = isValidMode(body.mode) ? body.mode : 'anyone';
  if (messages.length === 0) {
    res.status(400).json({ error: 'no_messages' });
    return;
  }

  const fwd = (req.headers['x-forwarded-for'] as string | undefined) ?? '';
  const ip = fwd.split(',')[0]?.trim() || (req.headers['x-real-ip'] as string | undefined) || 'anon';
  const ua = (req.headers['user-agent'] as string | undefined) ?? '';
  const identifier = `${ip}:${hashStr(ua)}`;

  // Race rate limit against a 3s timeout — if Upstash is slow/unreachable we
  // fail open rather than hang the entire request. The platform-level cap on
  // Anthropic spend remains the hard ceiling.
  let rl: { ok: boolean; limit: number; remaining: number; reset: number };
  try {
    rl = await Promise.race([
      checkRateLimit(identifier),
      new Promise<typeof rl>((resolve) =>
        setTimeout(() => resolve({ ok: true, limit: 20, remaining: 20, reset: Date.now() + 3600_000 }), 3000)
      ),
    ]);
  } catch {
    rl = { ok: true, limit: 20, remaining: 20, reset: Date.now() + 3600_000 };
  }

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
      writer.write({
        type: 'data-status',
        id: 'status',
        data: { stage: 'embedding', label: 'Embedding your question…' },
      });

      let chunks;
      try {
        chunks = await retrieve(lastUserText, 5);
      } catch (err) {
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
          label: `Found ${chunks.length} relevant chunk${chunks.length === 1 ? '' : 's'} from Ahmad's writing.`,
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

      const system = buildSystemPrompt(mode, chunks);
      const modelMessages = await convertToModelMessages(messages);

      const result = streamText({
        model: anthropic(MODEL),
        system,
        messages: modelMessages,
        maxOutputTokens: 700,
        temperature: 0.5,
        onFinish: () => {
          writer.write({
            type: 'data-status',
            id: 'status',
            data: { stage: 'done', label: 'Done.' },
          });
        },
      });

      writer.merge(result.toUIMessageStream());
    },
    onError: (err) => (err instanceof Error ? err.message : String(err)),
  });

  res.setHeader('x-ratelimit-limit', String(rl.limit));
  res.setHeader('x-ratelimit-remaining', String(rl.remaining));
  res.setHeader('x-ratelimit-reset', String(rl.reset));
  pipeUIMessageStreamToResponse({ response: res, stream });
}
