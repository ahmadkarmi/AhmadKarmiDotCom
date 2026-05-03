import { useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';

const SUGGESTED_PROMPTS = [
  "I'm thinking about adding AI to a product — where should I start?",
  'How does Ahmad think about evals for AI features?',
  "I'm prepping a strategy call — what frameworks would help?",
  'How was this chatbot built?',
  "Help me figure out if Ahmad's the right person to talk to for what I need.",
];

declare global {
  interface Window {
    trackEvent?: (eventName: string, params?: Record<string, unknown>) => void;
  }
}

function track(event: string, params: Record<string, unknown> = {}): void {
  if (typeof window !== 'undefined' && typeof window.trackEvent === 'function') {
    window.trackEvent(event, params);
  }
}

interface StatusData {
  stage: 'embedding' | 'retrieved' | 'thinking' | 'done' | 'error';
  label: string;
}

interface CitationItem {
  title: string;
  url: string;
  similarity: number;
  sourceType: string;
}

interface CitationData {
  chunks: CitationItem[];
}

interface AnyPart {
  type: string;
  text?: string;
  data?: unknown;
}

function getText(parts: AnyPart[]): string {
  return parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('');
}

function getStatus(parts: AnyPart[]): StatusData | null {
  const statuses = parts.filter((p) => p.type === 'data-status');
  const last = statuses[statuses.length - 1];
  return (last?.data as StatusData) ?? null;
}

function getCitations(parts: AnyPart[]): CitationData | null {
  const c = parts.find((p) => p.type === 'data-citations');
  return (c?.data as CitationData) ?? null;
}

function dedupeCitations(items: CitationItem[]): CitationItem[] {
  // The same article often produces multiple chunks (description + body
  // segments). Display each unique source once with its highest similarity.
  const byUrl = new Map<string, CitationItem>();
  for (const c of items) {
    const existing = byUrl.get(c.url);
    if (!existing || c.similarity > existing.similarity) {
      byUrl.set(c.url, c);
    }
  }
  return Array.from(byUrl.values()).sort((a, b) => b.similarity - a.similarity);
}

function StatusPill({ status }: { status: StatusData }) {
  const dotColor =
    status.stage === 'error'
      ? 'bg-red-500'
      : status.stage === 'done'
      ? 'bg-emerald-500'
      : 'bg-amber-500 animate-pulse';
  return (
    <div className="flex items-center gap-2 text-[11px] text-neutral-500 mb-2">
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotColor}`} />
      <span className="italic">{status.label}</span>
    </div>
  );
}

function Citations({ citations, onClick }: { citations: CitationData; onClick: (item: CitationItem) => void }) {
  const unique = dedupeCitations(citations.chunks);
  if (!unique.length) return null;
  return (
    <div className="mt-3 pt-2 border-t border-neutral-100">
      <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1.5">from ahmad&rsquo;s writing</div>
      <ul className="space-y-1">
        {unique.map((c, i) => (
          <li key={c.url} className="text-[11px] leading-snug">
            <a
              href={c.url}
              target="_blank"
              rel="noreferrer"
              onClick={() => onClick(c)}
              className="text-neutral-600 hover:text-neutral-900 hover:underline"
            >
              <span className="text-neutral-400">[{i + 1}]</span> {c.title}
            </a>
            <span className="text-neutral-400 ml-1">
              · {c.sourceType} · sim {c.similarity.toFixed(2)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Chat() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/ask-ahmad',
        body: () => ({ mode: 'anyone' }),
      }),
    []
  );

  const { messages, sendMessage, status, error, clearError } = useChat({ transport });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, status]);

  // Lock body scroll while the chat covers the screen on mobile.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const isMobile = window.matchMedia('(max-width: 767px)').matches;
    if (open && isMobile) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [open]);

  // Fire chat_received once per assistant message that finished streaming.
  const trackedReceived = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const m of messages) {
      if (m.role !== 'assistant' || trackedReceived.current.has(m.id)) continue;
      const parts = (m.parts ?? []) as AnyPart[];
      const status = getStatus(parts);
      if (status?.stage === 'done') {
        trackedReceived.current.add(m.id);
        const text = getText(parts);
        const citations = getCitations(parts);
        track('ask_ahmad_message_received', {
          message_id: m.id,
          response_length: text.length,
          citation_count: citations ? dedupeCitations(citations.chunks).length : 0,
        });
      }
    }
  }, [messages]);

  // Fire chat_error once per error.
  const trackedErrors = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!error) return;
    const key = error.message ?? 'unknown';
    if (trackedErrors.current.has(key)) return;
    trackedErrors.current.add(key);
    track('ask_ahmad_error', { message: key });
  }, [error]);

  const isStreaming = status === 'streaming' || status === 'submitted';

  function openChat() {
    setOpen(true);
    track('ask_ahmad_opened');
  }

  function closeChat() {
    setOpen(false);
    track('ask_ahmad_closed', { messages_count: messages.length });
  }

  function submit(text: string, source: 'input' | 'suggested' = 'input') {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    track('ask_ahmad_message_sent', {
      message_length: trimmed.length,
      source,
      turn_index: messages.length,
    });
    void sendMessage({ text: trimmed });
    setInput('');
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={openChat}
        className="rounded-full bg-neutral-900 text-white px-4 py-2 text-sm font-medium shadow-lg hover:bg-neutral-800 transition pointer-events-auto"
      >
        Ask Ahmad&rsquo;s AI &rarr;
      </button>
    );
  }

  // Open state: full-screen on mobile (<768px), floating panel on md+.
  return (
    <div className="fixed inset-0 md:relative md:inset-auto z-[60] pointer-events-auto">
      <div className="bg-white border-0 md:border md:border-neutral-200 rounded-none md:rounded-2xl shadow-none md:shadow-2xl overflow-hidden flex flex-col w-full h-full md:w-[420px] md:h-[640px] md:max-h-[calc(100vh-6rem)]">
        <header className="px-4 py-3 border-b border-neutral-100 flex items-center justify-between flex-shrink-0">
          <div>
            <div className="text-sm font-semibold text-neutral-900">Ahmad&rsquo;s AI Consultant</div>
            <div className="text-[10px] text-neutral-500">trained on his writing &middot; routes serious questions to him</div>
          </div>
          <button
            type="button"
            onClick={closeChat}
            aria-label="Close"
            className="text-neutral-400 hover:text-neutral-700 text-2xl leading-none p-2 -m-2"
          >
            &times;
          </button>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4 text-sm">
          {messages.length === 0 && (
            <div className="space-y-3">
              <p className="text-neutral-700">Hi &mdash; I&rsquo;m a consultant trained on Ahmad&rsquo;s writing.</p>
              <p className="text-neutral-500">
                Tell me what you&rsquo;re working on or what brought you here, and I&rsquo;ll point you to the relevant
                parts of how Ahmad thinks &mdash; and let you know when it&rsquo;s worth talking to him directly.
              </p>
              <div className="text-[10px] uppercase tracking-wider text-neutral-400 pt-2">or try one of these</div>
              <div className="flex flex-col gap-1.5">
                {SUGGESTED_PROMPTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => submit(p, 'suggested')}
                    className="text-left text-xs text-neutral-700 bg-neutral-50 hover:bg-neutral-100 active:bg-neutral-200 border border-neutral-200 rounded-lg px-3 py-2 transition"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => {
            const parts = (m.parts ?? []) as AnyPart[];
            const text = getText(parts);
            const status = m.role === 'assistant' ? getStatus(parts) : null;
            const citations = m.role === 'assistant' ? getCitations(parts) : null;

            return (
              <div key={m.id} className={m.role === 'user' ? 'text-neutral-900' : 'text-neutral-700'}>
                <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1">
                  {m.role === 'user' ? 'you' : 'consultant'}
                </div>
                {status && status.stage !== 'done' && <StatusPill status={status} />}
                {text && <div className="whitespace-pre-wrap leading-relaxed">{text}</div>}
                {citations && citations.chunks.length > 0 && status?.stage === 'done' && (
                  <Citations
                    citations={citations}
                    onClick={(c) => track('ask_ahmad_citation_clicked', { url: c.url, source_type: c.sourceType })}
                  />
                )}
              </div>
            );
          })}

          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
              {error.message || 'Something went wrong.'}
              <button type="button" onClick={clearError} className="ml-2 underline">
                dismiss
              </button>
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(input, 'input');
          }}
          className="border-t border-neutral-100 px-3 py-3 md:py-2 flex gap-2 flex-shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="What are you working on?"
            disabled={isStreaming}
            className="flex-1 text-base md:text-sm px-3 md:px-2 py-2 md:py-1.5 border border-neutral-200 rounded-md focus:outline-none focus:border-neutral-500 disabled:bg-neutral-50"
          />
          <button
            type="submit"
            disabled={isStreaming || !input.trim()}
            className="text-sm md:text-xs px-4 md:px-3 py-2 md:py-1.5 rounded-md bg-neutral-900 text-white disabled:bg-neutral-300 transition"
          >
            {isStreaming ? '…' : 'Send'}
          </button>
        </form>

        <div className="px-3 py-1.5 border-t border-neutral-100 text-[10px] text-neutral-400 flex items-center justify-between flex-shrink-0">
          <span>Sonnet 4.6 + RAG over Ahmad&rsquo;s corpus</span>
          <span>preview</span>
        </div>
      </div>
    </div>
  );
}
