import { anthropic } from '@ai-sdk/anthropic';
import { convertToModelMessages, streamText, type UIMessage } from 'ai';

import { isAskAhmadEnabled, disabledResponse } from './_lib/feature-flag';
import { retrieve } from './_lib/retrieve';
import { buildSystemPrompt, isValidMode, type Mode } from './_lib/system-prompt';
import { checkRateLimit, clientIdentifier } from './_lib/rate-limit';

export const config = {
  maxDuration: 60,
};

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

  // Rate limit BEFORE any expensive call.
  const rl = await checkRateLimit(clientIdentifier(request));
  if (!rl.ok) {
    return jsonError(
      429,
      {
        error: 'rate_limited',
        limit: rl.limit,
        remaining: rl.remaining,
        reset: rl.reset,
        message: `You've hit the hourly limit of ${rl.limit} questions. It resets at ${new Date(rl.reset).toISOString()}. Email Ahmad directly: https://www.ahmadkarmi.com/contact`,
      },
      {
        'x-ratelimit-limit': String(rl.limit),
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(rl.reset),
      }
    );
  }

  // Pull the most recent user turn for retrieval.
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUser) {
    return jsonError(400, { error: 'no_user_message' });
  }
  const lastUserText = uiMessageToText(lastUser);

  let chunks;
  try {
    chunks = await retrieve(lastUserText, 5);
  } catch (err) {
    console.error('[ask-ahmad] retrieve failed:', err);
    return jsonError(500, { error: 'retrieve_failed' });
  }

  const system = buildSystemPrompt(mode, chunks);

  const modelMessages = await convertToModelMessages(messages);
  const result = streamText({
    model: anthropic(MODEL),
    system,
    messages: modelMessages,
    maxOutputTokens: 600,
    temperature: 0.4,
  });

  return result.toUIMessageStreamResponse({
    headers: {
      'x-ratelimit-limit': String(rl.limit),
      'x-ratelimit-remaining': String(rl.remaining),
      'x-ratelimit-reset': String(rl.reset),
    },
  });
}

function uiMessageToText(m: UIMessage): string {
  // UIMessage v6 stores parts as an array of typed parts. Concatenate text parts.
  if (!Array.isArray((m as { parts?: unknown }).parts)) {
    // Fallback for legacy shapes.
    return String((m as { content?: unknown }).content ?? '');
  }
  return (m.parts as Array<{ type: string; text?: string }>)
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('\n')
    .trim();
}
