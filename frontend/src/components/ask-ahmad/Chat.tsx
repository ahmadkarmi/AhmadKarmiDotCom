import { useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';

const SUGGESTED_PROMPTS = [
  "I'm thinking about adding AI to a product — where should I start?",
  'How does Ahmad think about evals for AI features?',
  "I'm prepping a strategy call — what frameworks would help?",
  "Help me figure out if Ahmad's the right person to talk to for what I need.",
];

interface StatusData {
  stage: 'embedding' | 'retrieved' | 'thinking' | 'done' | 'error';
  label: string;
}

interface CitationData {
  chunks: Array<{
    title: string;
    url: string;
    similarity: number;
    sourceType: string;
  }>;
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

function Citations({ citations }: { citations: CitationData }) {
  if (!citations.chunks.length) return null;
  return (
    <div className="mt-3 pt-2 border-t border-neutral-100">
      <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1.5">from ahmad&rsquo;s writing</div>
      <ul className="space-y-1">
        {citations.chunks.map((c, i) => (
          <li key={`${c.url}-${i}`} className="text-[11px] leading-snug">
            <a
              href={c.url}
              target="_blank"
              rel="noreferrer"
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

  const isStreaming = status === 'streaming' || status === 'submitted';

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    void sendMessage({ text: trimmed });
    setInput('');
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full bg-neutral-900 text-white px-4 py-2 text-sm font-medium shadow-lg hover:bg-neutral-800 transition"
      >
        Ask Ahmad&rsquo;s AI &rarr;
      </button>
    );
  }

  return (
    <div className="w-[420px] max-w-[calc(100vw-3rem)] h-[640px] max-h-[calc(100vh-6rem)] bg-white border border-neutral-200 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
      <header className="px-4 py-3 border-b border-neutral-100 flex items-center justify-between flex-shrink-0">
        <div>
          <div className="text-sm font-semibold text-neutral-900">Ahmad&rsquo;s AI Consultant</div>
          <div className="text-[10px] text-neutral-500">trained on his writing &middot; routes serious questions to him</div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="text-neutral-400 hover:text-neutral-700 text-xl leading-none"
        >
          &times;
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4 text-sm">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-neutral-700">
              Hi &mdash; I&rsquo;m a consultant trained on Ahmad&rsquo;s writing.
            </p>
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
                  onClick={() => submit(p)}
                  className="text-left text-xs text-neutral-700 bg-neutral-50 hover:bg-neutral-100 border border-neutral-200 rounded-lg px-3 py-2 transition"
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
                <Citations citations={citations} />
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
          submit(input);
        }}
        className="border-t border-neutral-100 px-3 py-2 flex gap-2 flex-shrink-0"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="What are you working on?"
          disabled={isStreaming}
          className="flex-1 text-sm px-2 py-1.5 border border-neutral-200 rounded-md focus:outline-none focus:border-neutral-500 disabled:bg-neutral-50"
        />
        <button
          type="submit"
          disabled={isStreaming || !input.trim()}
          className="text-xs px-3 py-1.5 rounded-md bg-neutral-900 text-white disabled:bg-neutral-300 transition"
        >
          {isStreaming ? '…' : 'Send'}
        </button>
      </form>

      <div className="px-3 py-1.5 border-t border-neutral-100 text-[10px] text-neutral-400 flex items-center justify-between flex-shrink-0">
        <span>Sonnet 4.6 + RAG over Ahmad&rsquo;s corpus</span>
        <span>preview</span>
      </div>
    </div>
  );
}
