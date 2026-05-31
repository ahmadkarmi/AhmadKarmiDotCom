import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';

const STORAGE_KEY = 'ask-ahmad:messages-v1';
const CONTACT_URL = 'https://www.ahmadkarmi.com/contact';
const CONTACT_EMAIL = 'alkarmi.ahmad@gmail.com';

const QUICK_REPLIES: { topic: string; label: string; message: string }[] = [
  { topic: 'Project', label: 'I have a project idea', message: 'I have a project idea' },
  { topic: 'Hiring', label: "I'm hiring", message: "I'm hiring" },
  { topic: 'Browse', label: 'Just exploring', message: 'Just exploring' },
  { topic: 'Meta', label: 'How K.AI was built', message: 'How was this assistant built?' },
];

// Minimal Web Speech API type shims (not in lib.dom by default).
interface SRAlternative {
  readonly transcript: string;
  readonly confidence: number;
}
interface SRResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SRAlternative;
}
interface SRResultList {
  readonly length: number;
  [index: number]: SRResult;
}
interface SREvent extends Event {
  readonly resultIndex: number;
  readonly results: SRResultList;
}
interface SRErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}
interface SRInstance extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onstart: ((this: SRInstance, ev: Event) => unknown) | null;
  onend: ((this: SRInstance, ev: Event) => unknown) | null;
  onerror: ((this: SRInstance, ev: SRErrorEvent) => unknown) | null;
  onresult: ((this: SRInstance, ev: SREvent) => unknown) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SRConstructor = new () => SRInstance;

declare global {
  interface Window {
    trackEvent?: (eventName: string, params?: Record<string, unknown>) => void;
    SpeechRecognition?: SRConstructor;
    webkitSpeechRecognition?: SRConstructor;
  }
}

type VoiceState = 'unsupported' | 'idle' | 'listening' | 'processing';

type SRErrorKind = 'no-speech' | 'audio-capture' | 'not-allowed' | 'network' | 'aborted' | 'other';

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
    <div className="flex items-center gap-2 text-xs text-foreground-muted motion-safe:animate-fade-in-fast">
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotColor}`} />
      <span>{status.label}</span>
    </div>
  );
}

function AssistantAvatar({ size = 'sm' }: { size?: 'sm' | 'lg' | 'xl' } = {}) {
  const dim =
    size === 'xl'
      ? 'w-14 h-14 text-[1.75rem]'
      : size === 'lg'
        ? 'w-10 h-10 text-base'
        : 'w-7 h-7 text-xs';
  const ring = size === 'xl' ? 'ring-4 ring-accent/15 shadow-md shadow-accent/20' : 'shadow-sm';
  return (
    <div
      className={`${dim} ${ring} rounded-full bg-accent text-accent-foreground flex items-center justify-center flex-shrink-0`}
    >
      <span className="font-display font-semibold leading-none tracking-tight">K</span>
    </div>
  );
}

function Citations({ items, onClick }: { items: CitationItem[]; onClick: (item: CitationItem) => void }) {
  if (!items.length) return null;
  return (
    <div className="mt-3 pt-3 border-t border-border/40">
      <div className="text-[10px] uppercase tracking-wider text-foreground-muted mb-2 font-semibold">
        From Ahmad&rsquo;s writing
      </div>
      <ul className="space-y-1">
        {items.map((c, i) => (
          <li key={c.url} className="text-[13px] leading-snug flex items-baseline gap-2">
            <span className="text-foreground-muted text-[11px] font-mono mt-0.5">{i + 1}</span>
            <a
              href={c.url}
              target="_blank"
              rel="noreferrer"
              onClick={() => onClick(c)}
              className="text-foreground-secondary hover:text-accent hover:underline truncate"
            >
              {c.title}
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
    <div className="mt-4 rounded-xl bg-accent/5 border border-accent/20 p-4 motion-safe:animate-fade-up">
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
  const inputRef = useRef<HTMLInputElement>(null);
  const prevStatusRef = useRef<string>('ready');

  // --- Voice input state ---
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [voiceErrorMessage, setVoiceErrorMessage] = useState<string | null>(null);
  const recognitionRef = useRef<SRInstance | null>(null);
  const voiceStartTimeRef = useRef<number>(0);
  const voiceFinalTranscriptRef = useRef<string>('');
  const voiceInterimRef = useRef<string>('');

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
        // Guard against non-stream responses (HTML error pages, proxy errors)
        // being silently parsed and dumped as a message bubble. Throw on a bad
        // content type so useChat surfaces a clean error instead.
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
    const el = scrollRef.current;
    if (!el) return;
    // Smooth on user-initiated turns. While streaming, jump (smooth scroll
    // gets visibly stuck behind rapid token deltas).
    const streaming = status === 'streaming' || status === 'submitted';
    el.scrollTo({ top: el.scrollHeight, behavior: streaming ? 'auto' : 'smooth' });
  }, [messages, status]);

  // Auto-focus the input when streaming finishes so the user can keep typing
  // without having to click back into the textarea. Only fires on the
  // streaming -> ready transition (not on initial mount, which would pop the
  // keyboard on mobile before the user has even opened the chat themselves).
  useEffect(() => {
    const wasStreaming = prevStatusRef.current === 'streaming' || prevStatusRef.current === 'submitted';
    const isReady = status !== 'streaming' && status !== 'submitted';
    if (wasStreaming && isReady && open) {
      // Defer to the next tick so the input's `disabled` flag is fully
      // cleared before we try to focus it.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
    prevStatusRef.current = status;
  }, [status, open]);

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

  // --- Voice input: feature detect + cleanup ---
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setVoiceState('unsupported');
      return;
    }
    return () => {
      try {
        recognitionRef.current?.abort();
      } catch {
        /* noop */
      }
    };
  }, []);

  const stopRecognition = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      /* noop */
    }
  }, []);

  const startRecognition = useCallback(() => {
    if (voiceState === 'unsupported' || voiceState === 'listening' || voiceState === 'processing') return;
    if (status === 'streaming' || status === 'submitted') return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setVoiceState('unsupported');
      return;
    }
    setVoiceErrorMessage(null);
    voiceFinalTranscriptRef.current = '';
    voiceInterimRef.current = '';
    setInterimTranscript('');
    voiceStartTimeRef.current = Date.now();

    const rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = true;
    // Hands-free: keep listening until the user taps stop (or recognition
    // is auto-aborted on unmount). With continuous=false, Safari ends the
    // session as soon as it detects a brief pause — that defeats hands-free.
    rec.continuous = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      setVoiceState('listening');
      track('ask_ahmad_voice_input_started');
    };
    rec.onresult = (event: SREvent) => {
      let interim = '';
      let finalText = voiceFinalTranscriptRef.current;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      voiceFinalTranscriptRef.current = finalText;
      voiceInterimRef.current = interim;
      setInterimTranscript(interim);
    };
    rec.onerror = (event: SRErrorEvent) => {
      const knownKinds: SRErrorKind[] = ['no-speech', 'audio-capture', 'not-allowed', 'network', 'aborted'];
      const kind: SRErrorKind = knownKinds.includes(event.error as SRErrorKind)
        ? (event.error as SRErrorKind)
        : 'other';
      track('ask_ahmad_voice_input_error', { error_kind: kind });
      // 'aborted' is the normal stop path triggered by us; don't surface it as an error.
      if (kind !== 'aborted') {
        const msg =
          kind === 'not-allowed'
            ? 'Microphone access was blocked. Enable it in your browser to use voice input.'
            : kind === 'no-speech'
            ? "Couldn't hear that — try again or type your question."
            : kind === 'audio-capture'
            ? "Couldn't access the microphone. Check your device settings."
            : kind === 'network'
            ? 'Network issue with voice recognition. Try again.'
            : "Couldn't transcribe — try again or type your question.";
        setVoiceErrorMessage(msg);
      }
    };
    rec.onend = () => {
      const final = voiceFinalTranscriptRef.current.trim();
      const interim = voiceInterimRef.current.trim();
      // Some browsers (Safari) fire onend without ever marking results as final.
      // Fall back to whatever interim was captured at the time of stop.
      const captured = final || interim;
      if (captured) {
        setInput((prev) => (prev.trim() ? `${prev.trim()} ${captured}` : captured));
        const durationMs = Date.now() - voiceStartTimeRef.current;
        track('ask_ahmad_voice_input_completed', {
          transcript_length: captured.length,
          duration_ms: durationMs,
        });
        // Defer focus so the input is editable before we drop the cursor.
        requestAnimationFrame(() => {
          const el = inputRef.current;
          if (el) {
            el.focus();
            el.setSelectionRange(el.value.length, el.value.length);
          }
        });
      }
      setInterimTranscript('');
      setVoiceState('idle');
      recognitionRef.current = null;
    };

    recognitionRef.current = rec;
    try {
      rec.start();
    } catch (err) {
      console.warn('[ask-ahmad] recognition start failed', err);
      setVoiceState('idle');
      track('ask_ahmad_voice_input_error', { error_kind: 'other' });
    }
  }, [voiceState, status]);

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
        className="group rounded-full bg-foreground text-background pl-2 pr-5 py-2 text-sm font-medium shadow-lg hover:shadow-xl hover:-translate-y-0.5 hover:bg-accent transition-all duration-200 pointer-events-auto flex items-center gap-2.5 motion-safe:animate-fade-up"
      >
        <span className="w-7 h-7 rounded-full bg-background/10 flex items-center justify-center font-display text-xs font-semibold tracking-tight">
          K
        </span>
        <span>Ask K.AI</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="opacity-70 group-hover:opacity-100 group-hover:translate-x-0.5 transition-transform">
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="13 6 19 12 13 18" />
        </svg>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 md:relative md:inset-auto z-[60] pointer-events-auto motion-safe:animate-fade-in-fast">
      <div className="bg-background border-0 md:border md:border-border rounded-none md:rounded-2xl shadow-none md:shadow-2xl overflow-hidden flex flex-col w-full h-full md:w-[460px] md:h-[700px] md:max-h-[calc(100vh-6rem)] motion-safe:animate-panel-in origin-bottom-right">
        {/* Header */}
        <header className="px-5 py-4 border-b border-border/60 flex items-center justify-between flex-shrink-0 gap-3 bg-background">
          <div className="flex items-center gap-3 min-w-0">
            <AssistantAvatar size="lg" />
            <div className="min-w-0">
              <div className="font-display text-xl font-semibold text-foreground leading-none tracking-tight">
                K.AI
              </div>
              <div className="text-[11px] text-foreground-muted mt-1 leading-snug">
                Ahmad Al-Karmi&rsquo;s AI Assistant
              </div>
            </div>
          </div>
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {messages.length > 0 && (
              <button
                type="button"
                onClick={startOver}
                title="Start over"
                className="text-[11px] px-2.5 py-1.5 text-foreground-muted hover:text-foreground hover:bg-background-secondary rounded-md transition-all duration-150 font-medium"
              >
                Start over
              </button>
            )}
            <button
              type="button"
              onClick={closeChat}
              aria-label="Close"
              className="text-foreground-muted hover:text-foreground p-2 rounded-md hover:bg-background-secondary transition"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </header>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden px-5 py-6 space-y-6">
          {messages.length === 0 && (
            <div className="min-h-full flex flex-col justify-center motion-safe:animate-fade-up relative min-w-0">
              {/* Soft atmospheric backdrop. Off-center, no animation — adds
                  depth behind the type without spotlighting the input. */}
              <div
                aria-hidden
                className="absolute -inset-x-6 -inset-y-12 pointer-events-none"
                style={{
                  background:
                    'radial-gradient(ellipse 55% 45% at 25% 25%, rgba(59,130,246,0.12) 0%, transparent 65%), radial-gradient(ellipse 45% 40% at 90% 85%, rgba(99,102,241,0.07) 0%, transparent 70%)',
                  filter: 'blur(40px)',
                }}
              />

              {/* Status bar: gradient wordmark + live "ready" pulse */}
              <div className="relative flex items-center gap-2.5 mb-5">
                <span className="font-mono text-[10px] uppercase tracking-[0.32em] font-semibold bg-gradient-to-r from-accent via-indigo-500 to-cyan-500 bg-clip-text text-transparent">
                  K · AI
                </span>
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 motion-safe:animate-ping" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </span>
                <span className="font-mono text-[9px] uppercase tracking-[0.24em] text-foreground-muted">
                  ready
                </span>
                <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.24em] text-foreground-muted/70">
                  pick a thread
                </span>
              </div>

              {/* Headline */}
              <h3 className="relative font-display text-foreground text-[1.5rem] leading-[1.15] tracking-tight mb-6">
                What can I help
                <br />
                you with?
              </h3>

              {/* 2x2 card grid — topic label + the actual prompt the user is
                  about to send, with hover lift + accent edge */}
              <div className="relative grid grid-cols-2 gap-2.5">
                {QUICK_REPLIES.map((q, i) => (
                  <button
                    key={q.label}
                    type="button"
                    onClick={() => submit(q.message, 'quick_reply')}
                    style={{ animationDelay: `${300 + i * 80}ms` }}
                    className="group relative text-left bg-background-secondary/50 border border-border rounded-xl p-3.5 pb-9 transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:bg-background hover:shadow-lg hover:shadow-accent/10 motion-safe:animate-fade-up motion-safe:opacity-0 min-w-0"
                  >
                    {/* Accent corner gradient — lights up on hover */}
                    <span
                      aria-hidden
                      className="absolute inset-0 rounded-xl bg-gradient-to-br from-accent/0 via-transparent to-accent/0 group-hover:from-accent/[0.06] group-hover:to-accent/0 transition-colors pointer-events-none"
                    />
                    <div className="relative">
                      <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.22em] text-foreground-muted group-hover:text-accent transition-colors mb-1.5 font-semibold">
                        <span className="block w-1 h-1 rounded-full bg-current opacity-70" />
                        {q.topic}
                      </div>
                      <div className="text-[13px] text-foreground leading-snug font-medium break-words">
                        {q.label}
                      </div>
                    </div>
                    <span className="absolute bottom-2.5 right-3 text-accent opacity-0 group-hover:opacity-100 -translate-x-1 group-hover:translate-x-0 transition-all text-sm font-medium">
                      →
                    </span>
                  </button>
                ))}
              </div>

              {/* Subtle footer hint */}
              <p className="relative mt-5 text-[11px] text-foreground-muted/80 leading-snug">
                Or type your own question below.
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
            const usedCitations = parsed && citations ? citationsActuallyUsed(visibleText, citations) : [];

            if (m.role === 'user') {
              return (
                <div key={m.id} className="flex justify-end motion-safe:animate-fade-up">
                  <div className="max-w-[82%] min-w-0 bg-foreground text-background rounded-2xl rounded-tr-md px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                    {visibleText}
                  </div>
                </div>
              );
            }

            return (
              <div key={m.id} className="flex items-start gap-3 motion-safe:animate-fade-up">
                <AssistantAvatar />
                <div className="flex-1 min-w-0 space-y-2 pt-0.5">
                  {status && status.stage !== 'done' && <StatusPill key={status.stage} status={status} />}
                  {visibleText && (
                    <div className="text-[15px] text-foreground leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                      {visibleText}
                    </div>
                  )}
                  {parsed?.handoff && (
                    <div className="motion-safe:animate-fade-up">
                      <HandoffCard
                        initialContent={parsed.handoff}
                        onSent={(channel) =>
                          track('ask_ahmad_handoff_completed', { channel, message_id: m.id })
                        }
                      />
                    </div>
                  )}
                  {parsed?.handoffOpen && !parsed.handoff && (
                    <div className="text-xs text-foreground-muted italic motion-safe:animate-fade-in-fast">
                      preparing handoff summary…
                    </div>
                  )}
                  {usedCitations.length > 0 && status?.stage === 'done' && (
                    <div className="motion-safe:animate-fade-in-fast">
                      <Citations
                        items={usedCitations}
                        onClick={(c) => track('ask_ahmad_citation_clicked', { url: c.url, source_type: c.sourceType })}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {error && (
            <div className="flex items-start gap-3 motion-safe:animate-fade-up">
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

        {/* Voice error toast */}
        {voiceErrorMessage && (
          <div
            role="status"
            className="px-4 pt-2 motion-safe:animate-fade-in-fast bg-background"
          >
            <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start justify-between gap-2">
              <span>{voiceErrorMessage}</span>
              <button
                type="button"
                onClick={() => setVoiceErrorMessage(null)}
                className="text-amber-700 hover:text-amber-900 font-medium flex-shrink-0"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          </div>
        )}

        {/* aria-live announcement for screen readers */}
        <div className="sr-only" aria-live="polite" role="status">
          {voiceState === 'listening'
            ? interimTranscript
              ? `Heard: ${interimTranscript}`
              : 'Listening'
            : ''}
        </div>

        {/* Input — editorial thin-underline. Mic as a small icon. Submit is a
            tracked "Ask →" text-button rather than a colored circle. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (voiceState === 'listening') return;
            submit(input, 'input');
          }}
          className="border-t border-border/60 px-5 py-3 flex-shrink-0 bg-background"
        >
          <div
            className={`flex items-center gap-3 border-b pb-1.5 transition-colors ${
              voiceState === 'listening'
                ? 'border-red-400'
                : 'border-border focus-within:border-accent'
            }`}
          >
            <input
              ref={inputRef}
              type="text"
              value={voiceState === 'listening' ? interimTranscript : input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                voiceState === 'listening' ? 'Listening…' : 'Ask anything…'
              }
              disabled={isStreaming}
              readOnly={voiceState === 'listening'}
              className={`flex-1 min-w-0 bg-transparent border-0 outline-none text-[15px] py-1.5 placeholder:text-foreground-muted disabled:opacity-50 ${
                voiceState === 'listening' ? 'italic text-foreground-muted' : ''
              }`}
            />
            {voiceState !== 'unsupported' && (
              <button
                type="button"
                onPointerDown={() => {
                  // Blur the text input on pointerdown so iOS dismisses the
                  // keyboard and resolves any focus-related dead-tap before
                  // the click event runs.
                  if (document.activeElement === inputRef.current) {
                    inputRef.current?.blur();
                  }
                }}
                onClick={() => {
                  if (voiceState === 'listening') {
                    stopRecognition();
                    return;
                  }
                  startRecognition();
                }}
                disabled={isStreaming}
                aria-pressed={voiceState === 'listening'}
                aria-label={
                  voiceState === 'listening'
                    ? 'Stop recording'
                    : 'Start voice input'
                }
                title={voiceState === 'listening' ? 'Tap to stop' : 'Tap to speak'}
                className={`relative shrink-0 transition-colors select-none ${
                  voiceState === 'listening'
                    ? 'text-red-500'
                    : 'text-foreground-muted hover:text-accent'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M5 11a7 7 0 0 0 14 0" />
                  <line x1="12" y1="18" x2="12" y2="22" />
                  <line x1="8" y1="22" x2="16" y2="22" />
                </svg>
                {voiceState === 'listening' && (
                  <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-red-400 motion-safe:animate-ping" />
                )}
              </button>
            )}
            <button
              type="submit"
              disabled={isStreaming || !input.trim() || voiceState === 'listening'}
              aria-label="Send"
              className="font-medium text-accent text-[11px] uppercase tracking-[0.22em] shrink-0 hover:opacity-80 disabled:opacity-25 disabled:cursor-not-allowed transition-opacity py-1"
            >
              {isStreaming ? 'Asking…' : 'Ask →'}
            </button>
          </div>
        </form>

        {/* Footer: disclaimer + escape hatches */}
        <div className="px-4 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] border-t border-border/60 text-[10.5px] text-foreground-muted flex-shrink-0 bg-background-secondary/30">
          <div className="flex items-center justify-between gap-3 flex-wrap leading-snug">
            <span>
              Powered by Anthropic. May produce inaccurate information.
            </span>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => escapeToEmail('header')}
                className="hover:text-accent hover:underline font-medium"
              >
                Email Ahmad
              </button>
              <span className="text-border">|</span>
              <button
                type="button"
                onClick={() => escapeToForm('header')}
                className="hover:text-accent hover:underline font-medium"
              >
                Contact form
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
