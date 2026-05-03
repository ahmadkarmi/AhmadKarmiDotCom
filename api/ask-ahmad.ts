import { anthropic } from '@ai-sdk/anthropic';
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type UIMessage,
} from 'ai';

import { isAskAhmadEnabled, disabledResponse } from './_lib/feature-flag';
import { retrieve } from './_lib/retrieve';
import { buildSystemPrompt, isValidMode, type Mode } from './_lib/system-prompt';
import { checkRateLimit, clientIdentifier } from './_lib/rate-limit';

// Default function timeout is 300s on Vercel Fluid Compute — plenty for chat.

const MODEL = 'claude-sonnet-4-6';

interface ChatBody {
  messages?: UIMessage[];
  mode?: Mode;
}

function jsonError(status: number, payload: Record<string, unknown>, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export default async function handler(request: Request): Promise<Response> {
  if (!isAskAhmadEnabled()) return disabledResponse();

  if (request.method !== 'POST') {
    return jsonError(405, { error: 'method_not_allowed' });
  }

  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return jsonError(400, { error: 'invalid_json' });
  }

  const messages = body.messages ?? [];
  const mode: Mode = isValidMode(body.mode) ? body.mode : 'anyone';
  if (messages.length === 0) {
    return jsonError(400, { error: 'no_messages' });
  }

  const rl = await checkRateLimit(clientIdentifier(request));
  if (!rl.ok) {
    return jsonError(
      429,
      {
        error: 'rate_limited',
        limit: rl.limit,
        remaining: rl.remaining,
        reset: rl.reset,
        message: `You've hit the hourly limit of ${rl.limit} questions. Email Ahmad directly: https://www.ahmadkarmi.com/contact`,
      },
      {
        'x-ratelimit-limit': String(rl.limit),
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(rl.reset),
      }
    );
  }

  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUser) {
    return jsonError(400, { error: 'no_user_message' });
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
        console.error('[ask-ahmad] retrieve failed:', err);
        writer.write({
          type: 'data-status',
          id: 'status',
          data: { stage: 'error', label: 'Retrieval failed. Try again in a moment.' },
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

      const system = buildSystemPrompt(mode, chunks);
      const modelMessages = await convertToModelMessages(messages);

      const result = streamText({
        model: anthropic(MODEL),
        system,
        messages: modelMessages,
        maxOutputTokens: 600,
        temperature: 0.4,
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
    onError: (err) => {
      console.error('[ask-ahmad] stream error:', err);
      return err instanceof Error ? err.message : String(err);
    },
  });

  return createUIMessageStreamResponse({
    stream,
    headers: {
      'x-ratelimit-limit': String(rl.limit),
      'x-ratelimit-remaining': String(rl.remaining),
      'x-ratelimit-reset': String(rl.reset),
    },
  });
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
