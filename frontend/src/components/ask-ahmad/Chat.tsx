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

// Style guard: strip em dashes + Oxford commas before render.
function applyStyleGuard(input: string): string {
  let out = input;
  out = out.replace(/\s*—\s*/g, ', ');
  out = out.replace(/,\s*,/g, ',');
  out = out.replace(/,\s*\./g, '.');
  out = out.replace(/\(\s*,\s*/g, '(');
  out = out.replace(/\s*,\s*\)/g, ')');
  out = out.replace(/(,[^,\n]+),\s+(and|or|nor)\s+/gi, '$1 $2 ');
  return out;
}

// Special block parser: extract intent + handoff blocks from streamed text.
type ParsedAssistantText = {
  visibleText: string;
  intent?: 'project' | 'recruiter' | 'explorer';
  handoff?: string;
  handoffOpen: boolean;
};

function parseAssistantText(raw: string): ParsedAssistantText {
  let visible = raw;
  let intent: ParsedAssistantText['intent'];
  let handoff: string | undefined;
  let handoffOpen = false;

  const intentRe = /```intent\s*\n([\s\S]*?)\n?```/i;
  const im = visible.match(intentRe);
  if (im) {
    const v = im[1].trim().toLowerCase();
    if (v === 'project' || v === 'recruiter' || v === 'explorer') intent = v;
    visible = visible.replace(im[0], '').replace(/\n{3,}/g, '\n\n').trim();
  } else if (/```intent\b/i.test(visible)) {
    visible = visible.replace(/```intent[\s\S]*$/i, '').trimEnd();
  }

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

// Only show citations actually referenced via [^N] markers in the answer text.
function citationsActuallyUsed(visibleText: string, citations: CitationData | null): CitationItem[] {
  if (!citations || citations.chunks.length === 0) return [];
  const used = new Set<number>();
  const re = /\[\^(\d+)\]/g;
  let m;
  while ((m = re.exec(visibleText)) !== null) used.add(Number(m[1]));
  if (used.size === 0) return [];
  const filtered = citations.chunks.filter((_, i) => used.has(i + 1));
  const byUrl = new Map<string, CitationItem>();
  for (const c of filtered) {
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
      : 'bg-accent animate-pulse';
  return (
    <div className="flex items-center gap-2 text-xs text-foreground-muted">
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotColor}`} />
      <span>{status.label}</span>
    </div>
  );
}

function AssistantAvatar() {
  return (
    <div className="w-7 h-7 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center flex-shrink-0">
      <span className="text-[10px] font-display font-semibold text-accent leading-none">AK</span>
    </div>
  );
}

function Citations({ items, onClick }: { items: CitationItem[]; onClick: (item: CitationItem) => void }) {
  if (!items.length) return null;
  return (
    <div className="mt-4 rounded-xl bg-background-secondary/60 border border-border/60 p-3">
      <div className="text-[10px] uppercase tracking-wider text-foreground-muted mb-2 font-medium">
        Sources cited
      </div>
      <ul className="space-y-1.5">
        {items.map((c, i) => (
          <li key={c.url} className="text-xs leading-snug">
            <a
              href={c.url}
              target="_blank"
              rel="noreferrer"
              onClick={() => onClick(c)}
              className="text-foreground-secondary hover:text-accent hover:underline"
            >
              <span className="text-foreground-muted">[{i + 1}]</span> {c.title}
            </a>
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
    <div className="mt-4 rounded-xl bg-accent/5 border border-accent/20 p-4">
      <div className="text-[10px] uppercase tracking-wider text-accent mb-2 font-semibold">
        Handoff summary &middot; edit if needed
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={Math.min(12, Math.max(4, draft.split('\n').length))}
        className="w-full text-xs leading-relaxed bg-background border border-border rounded-lg px-3 py-2 font-sans text-foreground focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 resize-none"
      />
      <div className="flex gap-2 mt-3 flex-wrap">
        <button
          type="button"
          onClick={emailIt}
          className="text-xs px-3.5 py-2 bg-accent text-accent-foreground rounded-lg hover:bg-accent-hover transition font-medium"
        >
          Email it to Ahmad
        </button>
        <button
          type="button"
          onClick={openForm}
          className="text-xs px-3.5 py-2 bg-background border border-border text-foreground-secondary rounded-lg hover:border-foreground-muted transition"
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

  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return;
    try {
      if (messages.length === 0) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      /* ignore */
    }
  }, [messages, hydrated]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, status]);

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

  const trackedIntents = useRef<Set<string>>(new Set());
  const trackedHandoffs = useRef<Set<string>>(new Set());
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
        const used = citationsActuallyUsed(parsed.visibleText, citations);
        track('ask_ahmad_message_received', {
          message_id: m.id,
          response_length: parsed.visibleText.length,
          citation_count: used.length,
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
        className="rounded-full bg-foreground text-background px-5 py-3 text-sm font-medium shadow-lg hover:bg-accent hover:text-accent-foreground transition pointer-events-auto"
      >
        Ask Ahmad Karmi&rsquo;s AI &rarr;
      </button>
    );
  }

  const showQuickReplies = messages.length === 0;

  return (
    <div className="fixed inset-0 md:relative md:inset-auto z-[60] pointer-events-auto">
      <div className="bg-background border-0 md:border md:border-border rounded-none md:rounded-2xl shadow-none md:shadow-2xl overflow-hidden flex flex-col w-full h-full md:w-[460px] md:h-[700px] md:max-h-[calc(100vh-6rem)]">
        {/* Header */}
        <header className="px-5 py-4 border-b border-border/60 flex items-start justify-between flex-shrink-0 gap-3 bg-background">
          <div className="flex items-start gap-3 min-w-0">
            <AssistantAvatar />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-display text-base font-semibold text-foreground leading-tight">
                  Ahmad Karmi&rsquo;s AI
                </span>
                <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-accent/10 text-accent font-semibold border border-accent/20">
                  AI assistant
                </span>
              </div>
              <div className="text-xs text-foreground-muted mt-0.5 leading-snug">
                junior, trained on his writing
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {messages.length > 0 && (
              <button
                type="button"
                onClick={startOver}
                title="Start over"
                className="text-xs px-2.5 py-1.5 text-foreground-muted hover:text-foreground hover:bg-background-secondary rounded-md transition"
              >
                Start over
              </button>
            )}
            <button
              type="button"
              onClick={closeChat}
              aria-label="Close"
              className="text-foreground-muted hover:text-foreground p-2 -m-1 rounded-md hover:bg-background-secondary transition"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </header>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-6 space-y-6">
          {messages.length === 0 && (
            <div className="flex items-start gap-3">
              <AssistantAvatar />
              <div className="space-y-2 pt-0.5">
                <p className="text-sm text-foreground leading-relaxed">
                  Hi. I&rsquo;m Ahmad Karmi&rsquo;s AI assistant.
                </p>
                <p className="text-sm text-foreground-secondary leading-relaxed">What brought you here today?</p>
              </div>
            </div>
          )}

          {messages.map((m) => {
            const parts = (m.parts ?? []) as AnyPart[];
            const raw = getRawText(parts);
            const parsed = m.role === 'assistant' ? parseAssistantText(raw) : null;
            const visibleText = parsed ? applyStyleGuard(parsed.visibleText) : (m.role === 'user' ? raw : '');
            const status = m.role === 'assistant' ? getStatus(parts) : null;
            const citations = m.role === 'assistant' ? getCitations(parts) : null;
            const usedCitations = parsed && citations ? citationsActuallyUsed(visibleText, citations) : [];

            if (m.role === 'user') {
              return (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] bg-background-secondary text-foreground rounded-2xl rounded-tr-md px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
                    {visibleText}
                  </div>
                </div>
              );
            }

            return (
              <div key={m.id} className="flex items-start gap-3">
                <AssistantAvatar />
                <div className="flex-1 min-w-0 space-y-2 pt-0.5">
                  {status && status.stage !== 'done' && <StatusPill status={status} />}
                  {visibleText && (
                    <div className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                      {visibleText}
                    </div>
                  )}
                  {parsed?.handoff && (
                    <HandoffCard
                      initialContent={parsed.handoff}
                      onSent={(channel) =>
                        track('ask_ahmad_handoff_completed', { channel, message_id: m.id })
                      }
                    />
                  )}
                  {parsed?.handoffOpen && !parsed.handoff && (
                    <div className="text-xs text-foreground-muted italic">preparing handoff summary…</div>
                  )}
                  {usedCitations.length > 0 && status?.stage === 'done' && (
                    <Citations
                      items={usedCitations}
                      onClick={(c) => track('ask_ahmad_citation_clicked', { url: c.url, source_type: c.sourceType })}
                    />
                  )}
                </div>
              </div>
            );
          })}

          {showQuickReplies && (
            <div className="flex flex-wrap gap-2 pt-2 pl-10">
              {QUICK_REPLIES.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => submit(q, 'quick_reply')}
                  className="text-xs text-foreground-secondary bg-background hover:bg-background-secondary border border-border hover:border-foreground-muted rounded-full px-3.5 py-2 transition"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-3">
              <AssistantAvatar />
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 flex-1">
                {error.message || 'Something went wrong.'}
                <button type="button" onClick={clearError} className="ml-2 underline">
                  dismiss
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(input, 'input');
          }}
          className="border-t border-border/60 px-4 py-3 flex gap-2 flex-shrink-0 bg-background"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="What are you working on?"
            disabled={isStreaming}
            className="flex-1 text-base md:text-sm px-4 py-2.5 md:py-2 bg-background-secondary border border-transparent rounded-full focus:outline-none focus:border-accent focus:bg-background focus:ring-1 focus:ring-accent/30 disabled:opacity-50 transition placeholder:text-foreground-muted"
          />
          <button
            type="submit"
            disabled={isStreaming || !input.trim()}
            aria-label="Send"
            className="px-4 md:px-3.5 rounded-full bg-foreground text-background hover:bg-accent disabled:bg-background-tertiary disabled:text-foreground-muted transition flex items-center justify-center"
          >
            {isStreaming ? (
              <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                <path d="M12 2 a 10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="13 6 19 12 13 18" />
              </svg>
            )}
          </button>
        </form>

        {/* Footer: disclaimer + escape hatches */}
        <div className="px-4 py-2.5 border-t border-border/60 text-[10px] text-foreground-muted flex-shrink-0 pb-[max(0.625rem,env(safe-area-inset-bottom))] bg-background-secondary/40">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="leading-snug">
              Powered by Anthropic. May produce inaccurate or misleading information.
            </span>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => escapeToEmail('header')}
                className="hover:text-foreground hover:underline"
              >
                email
              </button>
              <span>&middot;</span>
              <button
                type="button"
                onClick={() => escapeToForm('header')}
                className="hover:text-foreground hover:underline"
              >
                contact form
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
