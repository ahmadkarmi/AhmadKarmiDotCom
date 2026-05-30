// Full-page K.AI experience for /ask — a Gemini-style hero that reflows into
// a conversation thread on first message. Shares the same /api/ask-ahmad
// endpoint and localStorage conversation as the floating widget, so a
// conversation started here continues in the widget on other pages and vice
// versa. Voice input, citations, and handoff UI are intentionally NOT included
// here — the floating widget remains the full-featured surface; /ask is the
// focused destination experience.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';

// Same key as Chat.tsx — keeps the two surfaces in sync.
const STORAGE_KEY = 'ask-ahmad:messages-v1';

const SUGGESTIONS = [
  'What does Ahmad do?',
  'Why loyalty and growth?',
  'Tell me about the Al Jazeera role',
  'Is Ahmad available for work?',
];

function track(event: string, params: Record<string, unknown> = {}) {
  if (typeof window !== 'undefined' && typeof window.trackEvent === 'function') {
    window.trackEvent(event, params);
  }
}

type AnyPart = { type: string; text?: string };
function getText(m: UIMessage): string {
  const parts = (m.parts ?? []) as AnyPart[];
  return parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text || '')
    .join('');
}

export default function AskHero() {
  const [input, setInput] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const initialMessages = useMemo<UIMessage[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as UIMessage[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, []);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/ask-ahmad',
        body: () => ({ mode: 'anyone' }),
        // Guard against non-stream responses (HTML 404 pages, proxy errors)
        // being silently parsed and dumped as a message bubble. Throw on a
        // bad content type so useChat surfaces a clean error instead.
        fetch: async (input, init) => {
          const res = await fetch(input, init);
          const ct = res.headers.get('content-type') || '';
          if (!res.ok || !/event-stream|application\/json|text\/plain/i.test(ct)) {
            throw new Error(
              res.status === 503
                ? 'K.AI is temporarily unavailable. Please try again later.'
                : `K.AI is unreachable (HTTP ${res.status}). Please try again in a moment.`
            );
          }
          return res;
        },
      }),
    []
  );

  const { messages, sendMessage, setMessages, status, error, clearError } = useChat({
    transport,
    messages: initialMessages,
  });

  useEffect(() => {
    setHydrated(true);
  }, []);

  // Persist conversation so it carries between /ask and the floating widget.
  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return;
    try {
      if (messages.length === 0) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      /* ignore */
    }
  }, [messages, hydrated]);

  // Auto-scroll thread to the bottom on new content.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const streaming = status === 'streaming' || status === 'submitted';
    el.scrollTo({ top: el.scrollHeight, behavior: streaming ? 'auto' : 'smooth' });
  }, [messages, status]);

  const isStreaming = status === 'streaming' || status === 'submitted';
  const hasMessages = messages.length > 0;

  function submit(text: string, source: 'input' | 'suggestion' = 'input') {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    track('ask_ahmad_message_sent', {
      source,
      surface: 'ask_page',
      length: trimmed.length,
    });
    setInput('');
    void sendMessage({ text: trimmed });
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function reset() {
    setMessages([]);
    setInput('');
    track('ask_ahmad_reset', { surface: 'ask_page' });
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit(input);
    }
  }

  // The input bar is rendered identically in both layouts so its DOM identity
  // (and focus/IME state) survives the hero -> chat transition.
  const Bar = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(input);
      }}
      className="relative flex items-end gap-2 rounded-[28px] border border-white/10 bg-white/5 px-4 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-md focus-within:border-white/20 transition-colors"
    >
      <span
        aria-hidden="true"
        className="text-white/50 text-xl leading-none select-none mb-1.5"
      >
        +
      </span>
      <textarea
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={hasMessages ? 'Ask another question…' : 'Ask anything…'}
        rows={1}
        disabled={isStreaming}
        className="flex-1 resize-none bg-transparent text-white text-[16px] placeholder:text-white/40 focus:outline-none disabled:opacity-60 leading-relaxed py-1 min-h-[28px] max-h-40"
        autoFocus={!hasMessages}
      />
      <button
        type="submit"
        disabled={!input.trim() || isStreaming}
        aria-label="Send message"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black transition-opacity disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90"
      >
        {isStreaming ? (
          <span
            aria-hidden="true"
            className="h-3 w-3 rounded-full bg-black animate-pulse"
          />
        ) : (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 19V5" />
            <path d="m5 12 7-7 7 7" />
          </svg>
        )}
      </button>
    </form>
  );

  return (
    <div className="relative flex min-h-[100dvh] flex-col text-white">
      {/* Pulsating radial glow — pure CSS, see ask.astro for keyframes */}
      <div className="ask-glow" aria-hidden="true" />

      {/* Reset button — only when there's a conversation to clear */}
      {hasMessages && (
        <div className="absolute top-4 right-4 z-10">
          <button
            type="button"
            onClick={reset}
            aria-label="Start a new conversation"
            title="New chat"
            className="flex h-9 w-9 items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </button>
        </div>
      )}

      {/* Hero state */}
      {!hasMessages && (
        <div className="relative z-[1] flex flex-1 flex-col items-center justify-center gap-10 px-6 py-16">
          <div className="text-center">
            <h1 className="font-display text-4xl sm:text-5xl md:text-6xl tracking-tight text-white">
              Ask K.AI anything
            </h1>
            <p className="mt-4 text-white/60 text-base sm:text-lg">
              Trained on Ahmad's writing and projects.
            </p>
          </div>

          <div className="w-full max-w-2xl">{Bar}</div>

          <div className="flex flex-wrap justify-center gap-2 max-w-2xl">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => submit(s, 'suggestion')}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 hover:text-white hover:border-white/20 hover:bg-white/10 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Chat state */}
      {hasMessages && (
        <>
          <div
            ref={scrollRef}
            className="relative z-[1] flex-1 overflow-y-auto px-4 sm:px-6 pt-16 pb-6"
          >
            <div className="mx-auto max-w-3xl space-y-6">
              {messages.map((m) => {
                const text = getText(m);
                if (m.role === 'user') {
                  return (
                    <div key={m.id} className="flex justify-end">
                      <div className="max-w-[82%] min-w-0 rounded-2xl rounded-tr-md bg-white text-black px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                        {text}
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={m.id} className="flex min-w-0">
                    <div className="min-w-0 text-[15px] leading-relaxed text-white/90 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                      {text || (isStreaming ? <span className="text-white/40">…</span> : '')}
                    </div>
                  </div>
                );
              })}

              {error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                  {error.message || 'Something went wrong.'}
                  <button
                    type="button"
                    onClick={clearError}
                    className="ml-2 underline opacity-80 hover:opacity-100"
                  >
                    dismiss
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="sticky bottom-0 z-[1] px-4 sm:px-6 pb-4 pt-2">
            <div className="mx-auto max-w-3xl">{Bar}</div>
          </div>
        </>
      )}
    </div>
  );
}
