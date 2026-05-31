// Full-page K.AI experience for /ask — an editorial "fill in the blank" hero
// that reflows into a conversation thread on first message. Shares the same
// /api/ask-ahmad endpoint and localStorage conversation as the floating
// widget, so a conversation started here continues in the widget on other
// pages and vice versa. Voice, citations, and handoff UI are intentionally
// scoped to the widget — /ask is the focused destination experience.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';

// Same key as Chat.tsx — keeps the two surfaces in sync.
const STORAGE_KEY = 'ask-ahmad:messages-v1';

const SUGGESTIONS = [
  'what does Ahmad actually do',
  'why loyalty and growth',
  'about the Al Jazeera role',
  'if Ahmad is open to opportunities',
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
  const heroInputRef = useRef<HTMLInputElement | null>(null);
  const chatInputRef = useRef<HTMLInputElement | null>(null);

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
    requestAnimationFrame(() => {
      (hasMessages ? chatInputRef : heroInputRef).current?.focus();
    });
  }

  function reset() {
    setMessages([]);
    setInput('');
    track('ask_ahmad_reset', { surface: 'ask_page' });
    requestAnimationFrame(() => heroInputRef.current?.focus());
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit(input);
    }
  }

  return (
    <div className="relative flex min-h-[100dvh] flex-col text-white">
      {/* Soft off-center backdrop. Restrained, not centered, so type leads. */}
      <div className="ask-glow" aria-hidden="true" />

      {/* Editorial wordmark — brand stamp in the corner */}
      <div className="absolute top-6 left-6 sm:top-8 sm:left-10 font-display text-[11px] tracking-[0.32em] uppercase text-white/35 select-none z-10">
        K · AI
      </div>
      <div className="absolute top-6 right-6 sm:top-8 sm:right-10 font-mono text-[10px] tracking-[0.2em] uppercase text-white/30 select-none z-10">
        Ahmad's assistant
      </div>

      {/* Reset button — only when there's a conversation to clear */}
      {hasMessages && (
        <div className="absolute top-5 right-24 sm:right-32 z-10">
          <button
            type="button"
            onClick={reset}
            aria-label="Start a new conversation"
            title="New chat"
            className="flex h-8 items-center gap-1.5 rounded-full px-3 text-[11px] uppercase tracking-[0.2em] text-white/50 hover:text-white hover:bg-white/5 transition-colors"
          >
            New
          </button>
        </div>
      )}

      {/* Hero state — the prompt completes a sentence the visitor finishes */}
      {!hasMessages && (
        <div className="relative z-[1] flex flex-1 flex-col justify-center px-6 sm:px-10 py-24">
          <div className="mx-auto w-full max-w-3xl">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit(input);
              }}
              className="flex flex-wrap items-baseline gap-x-4 gap-y-2 border-b border-white/15 pb-3 focus-within:border-accent transition-colors"
            >
              <span className="font-display italic text-white/65 text-[1.7rem] sm:text-4xl md:text-[2.6rem] leading-none shrink-0 select-none">
                I want to know
              </span>
              <input
                ref={heroInputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="…"
                disabled={isStreaming}
                autoFocus
                className="flex-1 min-w-[8rem] bg-transparent text-white text-[1.6rem] sm:text-[2rem] md:text-[2.4rem] focus:outline-none placeholder:text-white/25 disabled:opacity-50 leading-tight py-1"
              />
              <button
                type="submit"
                disabled={!input.trim() || isStreaming}
                className="font-medium text-accent text-sm sm:text-base uppercase tracking-[0.2em] shrink-0 hover:opacity-80 disabled:opacity-25 disabled:cursor-not-allowed transition-opacity py-2"
              >
                {isStreaming ? 'Asking…' : 'Ask →'}
              </button>
            </form>

            {/* Editorial numbered list — Ahmad's voice continues the sentence */}
            <ol className="mt-14 sm:mt-16 space-y-3 sm:space-y-3.5">
              {SUGGESTIONS.map((s, i) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => submit(s, 'suggestion')}
                    className="group w-full flex items-baseline gap-5 text-left text-white/60 hover:text-white transition-colors py-1 -mx-2 px-2 rounded-sm"
                  >
                    <span className="font-mono text-[11px] text-white/30 group-hover:text-accent transition-colors w-6 shrink-0 tabular-nums">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="font-display italic text-white/40 text-base sm:text-lg shrink-0 select-none">
                      …
                    </span>
                    <span className="text-base sm:text-lg leading-snug">{s}</span>
                    <span className="ml-auto pl-2 text-accent opacity-0 group-hover:opacity-100 transition-opacity">
                      →
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}

      {/* Chat state — conversation thread + same thin-underline input docked */}
      {hasMessages && (
        <>
          <div
            ref={scrollRef}
            className="relative z-[1] flex-1 overflow-y-auto px-4 sm:px-10 pt-20 pb-6"
          >
            <div className="mx-auto max-w-3xl space-y-7">
              {messages.map((m) => {
                const text = getText(m);
                if (m.role === 'user') {
                  return (
                    <div key={m.id} className="space-y-1.5">
                      <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-accent/80">
                        You asked
                      </div>
                      <div className="min-w-0 font-display italic text-white text-xl sm:text-2xl leading-snug break-words [overflow-wrap:anywhere]">
                        {text}
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={m.id} className="space-y-1.5">
                    <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/40">
                      K.AI
                    </div>
                    <div className="min-w-0 text-[15px] sm:text-base leading-relaxed text-white/90 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                      {text || (isStreaming ? <span className="text-white/40">…</span> : '')}
                    </div>
                  </div>
                );
              })}

              {error && (
                <div className="border-l-2 border-red-500/60 bg-red-500/5 pl-3 py-2 text-sm text-red-200">
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

          <div className="sticky bottom-0 z-[1] px-4 sm:px-10 pb-5 pt-3 bg-gradient-to-t from-[#0a0a0c] via-[#0a0a0c]/95 to-transparent">
            <div className="mx-auto max-w-3xl">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submit(input);
                }}
                className="flex items-baseline gap-3 border-b border-white/15 pb-2 focus-within:border-accent transition-colors"
              >
                <input
                  ref={chatInputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Ask another…"
                  disabled={isStreaming}
                  className="flex-1 min-w-0 bg-transparent text-white text-lg focus:outline-none placeholder:text-white/30 disabled:opacity-50 py-2"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || isStreaming}
                  className="font-medium text-accent text-xs uppercase tracking-[0.2em] shrink-0 hover:opacity-80 disabled:opacity-25 disabled:cursor-not-allowed transition-opacity"
                >
                  {isStreaming ? 'Asking…' : 'Ask →'}
                </button>
              </form>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
