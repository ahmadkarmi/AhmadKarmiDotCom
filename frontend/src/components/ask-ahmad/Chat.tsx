import { useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';

const STORAGE_KEY = 'ask-ahmad:messages-v1';
const CONTACT_URL = 'https://www.ahmadkarmi.com/contact';
const CONTACT_EMAIL = 'info@ahmadkarmi.com';

const QUICK_REPLIES = [
  'I have a project idea',
  "I'm hiring",
  'Just exploring',
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

function getRawText(parts: AnyPart[]): string {
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

// --- Style guard: strip em dashes + Oxford commas before render ---
function applyStyleGuard(input: string): string {
  let out = input;
  // 1. Em dashes → ", " (then collapse runs created by adjacent punctuation).
  out = out.replace(/\s*—\s*/g, ', ');
  out = out.replace(/,\s*,/g, ',');
  out = out.replace(/,\s*\./g, '.');
  out = out.replace(/\(\s*,\s*/g, '(');
  out = out.replace(/\s*,\s*\)/g, ')');
  // 2. Oxford comma in lists of 3+ items: ", and|or|nor " → " and|or|nor ".
  //    Only strip when the conjunction appears AFTER another comma in the same
  //    line (so we don't touch compound sentences whose comma+conjunction is
  //    grammatically required).
  out = out.replace(/(,[^,\n]+),\s+(and|or|nor)\s+/gi, '$1 $2 ');
  return out;
}

// --- Special block parser: extract intent + handoff blocks from streamed text ---
type ParsedAssistantText = {
  visibleText: string;
  intent?: 'project' | 'recruiter' | 'explorer';
  handoff?: string;
  handoffOpen: boolean; // true while the fence is open but not yet closed (during streaming)
};

function parseAssistantText(raw: string): ParsedAssistantText {
  let visible = raw;
  let intent: ParsedAssistantText['intent'];
  let handoff: string | undefined;
  let handoffOpen = false;

  // Extract closed intent block.
  const intentRe = /```intent\s*\n([\s\S]*?)\n?```/i;
  const im = visible.match(intentRe);
  if (im) {
    const v = im[1].trim().toLowerCase();
    if (v === 'project' || v === 'recruiter' || v === 'explorer') intent = v;
    visible = visible.replace(im[0], '').replace(/\n{3,}/g, '\n\n').trim();
  } else if (/```intent\b/i.test(visible)) {
    // Fence opened but not yet closed during streaming. Hide the partial.
    visible = visible.replace(/```intent[\s\S]*$/i, '').trimEnd();
  }

  // Extract closed handoff block.
  const handoffRe = /```handoff\s*\n([\s\S]*?)\n?```/i;
  const hm = visible.match(handoffRe);
  if (hm) {
    handoff = hm[1].trim();
    visible = visible.replace(hm[0], '').replace(/\n{3,}/g, '\n\n').trim();
  } else if (/```handoff\b/i.test(visible)) {
    handoffOpen = true;
    visible = visible.replace(/```handoff[\s\S]*$/i, '').trimEnd();
  }

  return { visibleText: visible, intent, handoff, handoffOpen };
}

function dedupeCitations(items: CitationItem[]): CitationItem[] {
  const byUrl = new Map<string, CitationItem>();
  for (const c of items) {
    const existing = byUrl.get(c.url);
    if (!existing || c.similarity > existing.similarity) byUrl.set(c.url, c);
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

function HandoffCard({
  initialContent,
  onSent,
}: {
  initialContent: string;
  onSent: (channel: 'email' | 'form') => void;
}) {
  const [draft, setDraft] = useState(initialContent);
  const subject = 'New lead from your AI assistant';

  function emailIt() {
    const url = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(draft)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    onSent('email');
  }

  function openForm() {
    window.open(CONTACT_URL, '_blank', 'noopener,noreferrer');
    onSent('form');
  }

  return (
    <div className="mt-3 rounded-lg border border-neutral-300 bg-neutral-50 p-3">
      <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">handoff summary, edit if needed</div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={Math.min(12, Math.max(4, draft.split('\n').length))}
        className="w-full text-xs leading-snug bg-white border border-neutral-200 rounded px-2 py-1.5 font-mono focus:outline-none focus:border-neutral-500"
      />
      <div className="flex gap-2 mt-2 flex-wrap">
        <button
          type="button"
          onClick={emailIt}
          className="text-xs px-3 py-1.5 bg-neutral-900 text-white rounded-md hover:bg-neutral-800 transition"
        >
          Email it to Ahmad
        </button>
        <button
          type="button"
          onClick={openForm}
          className="text-xs px-3 py-1.5 bg-white border border-neutral-300 text-neutral-700 rounded-md hover:bg-neutral-100 transition"
        >
          Use the contact form
        </button>
      </div>
    </div>
  );
}

export default function Chat() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // localStorage hydration of prior conversation.
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

  // Persist messages on change.
  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return;
    try {
      if (messages.length === 0) {
        window.localStorage.removeItem(STORAGE_KEY);
      } else {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
      }
    } catch {
      /* quota or private mode, ignore */
    }
  }, [messages, hydrated]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, status]);

  // Body scroll lock while chat covers screen on mobile.
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

  // GA: fire intent_classified once per detected intent in the conversation.
  const trackedIntents = useRef<Set<string>>(new Set());
  // GA: fire handoff_initiated once per detected handoff block.
  const trackedHandoffs = useRef<Set<string>>(new Set());
  // GA: fire message_received once per assistant message that finished streaming.
  const trackedReceived = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const m of messages) {
      if (m.role !== 'assistant') continue;
      const parts = (m.parts ?? []) as AnyPart[];
      const raw = getRawText(parts);
      const parsed = parseAssistantText(raw);

      if (parsed.intent && !trackedIntents.current.has(m.id)) {
        trackedIntents.current.add(m.id);
        track('ask_ahmad_intent_classified', { intent: parsed.intent, message_id: m.id });
      }

      if (parsed.handoff && !trackedHandoffs.current.has(m.id)) {
        trackedHandoffs.current.add(m.id);
        track('ask_ahmad_handoff_initiated', { message_id: m.id, summary_length: parsed.handoff.length });
      }

      const status = getStatus(parts);
      if (status?.stage === 'done' && !trackedReceived.current.has(m.id)) {
        trackedReceived.current.add(m.id);
        const citations = getCitations(parts);
        track('ask_ahmad_message_received', {
          message_id: m.id,
          response_length: parsed.visibleText.length,
          citation_count: citations ? dedupeCitations(citations.chunks).length : 0,
          had_intent: !!parsed.intent,
          had_handoff: !!parsed.handoff,
        });
      }
    }
  }, [messages]);

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
    track('ask_ahmad_opened', { had_prior_conversation: messages.length > 0 });
  }

  function closeChat() {
    setOpen(false);
    track('ask_ahmad_closed', { messages_count: messages.length });
  }

  function startOver() {
    setMessages([]);
    if (typeof window !== 'undefined') window.localStorage.removeItem(STORAGE_KEY);
    trackedIntents.current.clear();
    trackedHandoffs.current.clear();
    trackedReceived.current.clear();
    track('ask_ahmad_reset');
  }

  function submit(text: string, source: 'input' | 'quick_reply' = 'input') {
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

  function escapeToEmail(reason: 'header' | 'inline') {
    track('ask_ahmad_escape_hatch_used', { channel: 'email', reason });
    window.open(`mailto:${CONTACT_EMAIL}`, '_blank', 'noopener,noreferrer');
  }

  function escapeToForm(reason: 'header' | 'inline') {
    track('ask_ahmad_escape_hatch_used', { channel: 'form', reason });
    window.open(CONTACT_URL, '_blank', 'noopener,noreferrer');
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={openChat}
        className="rounded-full bg-neutral-900 text-white px-4 py-2 text-sm font-medium shadow-lg hover:bg-neutral-800 transition pointer-events-auto"
      >
        Ask Ahmad Karmi&rsquo;s AI &rarr;
      </button>
    );
  }

  const showQuickReplies = messages.length === 0;

  return (
    <div className="fixed inset-0 md:relative md:inset-auto z-[60] pointer-events-auto">
      <div className="bg-white border-0 md:border md:border-neutral-200 rounded-none md:rounded-2xl shadow-none md:shadow-2xl overflow-hidden flex flex-col w-full h-full md:w-[440px] md:h-[680px] md:max-h-[calc(100vh-6rem)]">
        <header className="px-4 py-3 border-b border-neutral-100 flex items-start justify-between flex-shrink-0 gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-neutral-900">Ahmad Karmi&rsquo;s AI</span>
              <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600 font-medium">
                AI assistant
              </span>
            </div>
            <div className="text-[10px] text-neutral-500 mt-0.5">junior, trained on his writing, routes to him when it counts</div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {messages.length > 0 && (
              <button
                type="button"
                onClick={startOver}
                title="Start over"
                className="text-[10px] px-2 py-1 text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 rounded transition"
              >
                Start over
              </button>
            )}
            <button
              type="button"
              onClick={closeChat}
              aria-label="Close"
              className="text-neutral-400 hover:text-neutral-700 text-2xl leading-none p-2 -m-1"
            >
              &times;
            </button>
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4 text-sm">
          {messages.length === 0 && (
            <div className="space-y-3">
              <p className="text-neutral-700">Hi. I&rsquo;m Ahmad Karmi&rsquo;s AI assistant.</p>
              <p className="text-neutral-500">
                What brought you here today?
              </p>
            </div>
          )}

          {messages.map((m) => {
            const parts = (m.parts ?? []) as AnyPart[];
            const raw = getRawText(parts);
            const parsed = m.role === 'assistant' ? parseAssistantText(raw) : null;
            const visibleText = parsed ? applyStyleGuard(parsed.visibleText) : (m.role === 'user' ? raw : '');
            const status = m.role === 'assistant' ? getStatus(parts) : null;
            const citations = m.role === 'assistant' ? getCitations(parts) : null;

            return (
              <div key={m.id} className={m.role === 'user' ? 'text-neutral-900' : 'text-neutral-700'}>
                <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1">
                  {m.role === 'user' ? 'you' : 'assistant'}
                </div>
                {status && status.stage !== 'done' && <StatusPill status={status} />}
                {visibleText && <div className="whitespace-pre-wrap leading-relaxed">{visibleText}</div>}
                {parsed?.handoff && (
                  <HandoffCard
                    initialContent={parsed.handoff}
                    onSent={(channel) =>
                      track('ask_ahmad_handoff_completed', { channel, message_id: m.id })
                    }
                  />
                )}
                {parsed?.handoffOpen && !parsed.handoff && (
                  <div className="mt-2 text-[11px] text-neutral-400 italic">preparing handoff summary…</div>
                )}
                {citations && citations.chunks.length > 0 && status?.stage === 'done' && (
                  <Citations
                    citations={citations}
                    onClick={(c) => track('ask_ahmad_citation_clicked', { url: c.url, source_type: c.sourceType })}
                  />
                )}
              </div>
            );
          })}

          {showQuickReplies && (
            <div className="pt-2 space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-neutral-400">quick replies</div>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_REPLIES.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => submit(q, 'quick_reply')}
                    className="text-xs text-neutral-700 bg-neutral-50 hover:bg-neutral-100 active:bg-neutral-200 border border-neutral-200 rounded-full px-3 py-1.5 transition"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

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
          className="border-t border-neutral-100 px-3 py-3 md:py-2 flex gap-2 flex-shrink-0"
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

        <div className="px-3 py-2 border-t border-neutral-100 flex items-center justify-between gap-2 text-[10px] text-neutral-400 flex-shrink-0 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <span className="leading-tight">
            Powered by Anthropic. May produce inaccurate or misleading information.
          </span>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => escapeToEmail('header')}
              className="text-neutral-500 hover:text-neutral-900 hover:underline"
            >
              email
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={() => escapeToForm('header')}
              className="text-neutral-500 hover:text-neutral-900 hover:underline"
            >
              contact form
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
