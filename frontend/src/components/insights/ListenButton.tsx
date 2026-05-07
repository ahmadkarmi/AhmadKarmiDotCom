import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Status = 'unsupported' | 'idle' | 'loading' | 'playing' | 'paused' | 'done' | 'error';

interface ParagraphRange {
  el: HTMLElement;
  start: number;
  end: number;
}

interface SentenceChunk {
  text: string;
  start: number; // absolute char offset in the full preprocessed text
  end: number;
}

interface ExtractResult {
  text: string;
  paragraphs: ParagraphRange[];
}

interface Props {
  articleSelector?: string;
  slug?: string;
  title?: string;
}

const HIGHLIGHT_CLASSES = [
  'tts-active-paragraph',
  'bg-accent/8',
  'ring-1',
  'ring-accent/15',
  'rounded-md',
  'transition-[background-color,box-shadow]',
  'duration-300',
  'ease-out',
  '-mx-2',
  'px-2',
  'py-1',
];

const VOICE_STORAGE_KEY = 'ask-ahmad-listen:voice';
const RATES: Array<1 | 1.5 | 2> = [1, 1.5, 2];

// Acronyms the speech engine commonly mispronounces; replace with phonetic spelling.
const ACRONYMS: Record<string, string> = {
  AI: 'A I',
  PM: 'P M',
  KPI: 'K P I',
  GTM: 'G T M',
  B2B: 'B to B',
  B2C: 'B to C',
  SaaS: 'sass',
  API: 'A P I',
  CEO: 'C E O',
  CTO: 'C T O',
  CFO: 'C F O',
  COO: 'C O O',
  CIO: 'C I O',
  ROI: 'R O I',
  MVP: 'M V P',
  PRD: 'P R D',
  MBA: 'M B A',
  BBA: 'B B A',
  AUK: 'A U K',
  UI: 'U I',
  UX: 'U X',
  LLM: 'L L M',
  RAG: 'rag',
  TLS: 'T L S',
  TTS: 'T T S',
  NDA: 'N D A',
  RFP: 'R F P',
  RICE: 'rice',
};

const ORDINALS = [
  'First',
  'Second',
  'Third',
  'Fourth',
  'Fifth',
  'Sixth',
  'Seventh',
  'Eighth',
  'Ninth',
  'Tenth',
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

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function estDurationSec(text: string, rate: number): number {
  return text.length / (18 * rate);
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// --- Voice tiering -----------------------------------------------------------

interface VoiceWithTier {
  voice: SpeechSynthesisVoice;
  tier: 1 | 2 | 3 | 4;
  tierLabel: 'Premium' | 'Local' | 'Standard';
}

const PREMIUM_NETWORK_PATTERNS = [/online \(natural\)/i, /wavenet/i, /neural/i, /premium/i, /studio/i];
const PREMIUM_LOCAL_NAMES = [
  'Samantha',
  'Karen',
  'Daniel',
  'Moira',
  'Tessa',
  'Aaron',
  'Nicky',
  'Ava',
  'Allison',
  'Susan',
  'Fred',
];

function tierVoice(v: SpeechSynthesisVoice): VoiceWithTier {
  const isEn = v.lang.startsWith('en');
  if (!isEn) return { voice: v, tier: 4, tierLabel: 'Standard' };

  if (PREMIUM_NETWORK_PATTERNS.some((re) => re.test(v.name))) {
    return { voice: v, tier: 1, tierLabel: 'Premium' };
  }
  if (PREMIUM_LOCAL_NAMES.some((n) => v.name.includes(n))) {
    return { voice: v, tier: 2, tierLabel: 'Premium' };
  }
  if (!v.default) return { voice: v, tier: 3, tierLabel: v.localService ? 'Local' : 'Standard' };
  return { voice: v, tier: 4, tierLabel: v.localService ? 'Local' : 'Standard' };
}

function getEnglishVoices(): VoiceWithTier[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
  return voices.map(tierVoice).sort((a, b) => a.tier - b.tier || a.voice.name.localeCompare(b.voice.name));
}

function autoPickVoice(): SpeechSynthesisVoice | undefined {
  const ranked = getEnglishVoices();
  return ranked[0]?.voice;
}

function loadSavedVoice(): SpeechSynthesisVoice | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const uri = window.localStorage.getItem(VOICE_STORAGE_KEY);
    if (!uri) return undefined;
    const all = window.speechSynthesis.getVoices();
    return all.find((v) => v.voiceURI === uri);
  } catch {
    return undefined;
  }
}

function saveVoice(voice: SpeechSynthesisVoice | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (voice) window.localStorage.setItem(VOICE_STORAGE_KEY, voice.voiceURI);
    else window.localStorage.removeItem(VOICE_STORAGE_KEY);
  } catch {
    /* quota / private mode: ignore */
  }
}

// --- Text extraction + preprocessing -----------------------------------------

function extractReadableText(root: Element): ExtractResult {
  const SKIP = new Set(['PRE', 'CODE', 'FIGURE', 'IFRAME', 'SCRIPT', 'STYLE', 'NOSCRIPT']);
  const PARAGRAPH_TAGS = new Set([
    'P',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'BLOCKQUOTE',
    'LI',
  ]);
  const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
  const paragraphs: ParagraphRange[] = [];
  let text = '';
  let liIndex = 0;

  function walk(el: Element, parentIsOL = false): void {
    if (SKIP.has(el.tagName)) return;

    if (el.tagName === 'OL') {
      liIndex = 0;
      for (const child of Array.from(el.children)) walk(child, true);
      return;
    }
    if (el.tagName === 'UL') {
      for (const child of Array.from(el.children)) walk(child, false);
      return;
    }

    if (PARAGRAPH_TAGS.has(el.tagName)) {
      const start = text.length;
      let inner = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!inner) return;

      // Reframe ordered-list markers naturally.
      if (el.tagName === 'LI' && parentIsOL) {
        liIndex += 1;
        const ord = ORDINALS[liIndex - 1] ?? `Item ${liIndex}`;
        inner = `${ord}, ${inner}`;
      }

      // Drop emoji (the engine reads them in confusing ways).
      inner = inner.replace(
        /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/gu,
        ''
      ).replace(/\s+/g, ' ').trim();

      // Acronym replacements (whole-word only).
      for (const [from, to] of Object.entries(ACRONYMS)) {
        const re = new RegExp(`\\b${from}\\b`, 'g');
        inner = inner.replace(re, to);
      }

      // Normalise URLs to "link to <hostname>".
      inner = inner.replace(/https?:\/\/(?:www\.)?([^\s/]+)\S*/g, 'link to $1');

      // Headings get a trailing period if they don't already, plus a clear pause.
      if (HEADING_TAGS.has(el.tagName)) {
        if (!/[.!?]$/.test(inner)) inner += '.';
        inner += ' '; // small spacer
      }

      text += inner + '\n\n';
      paragraphs.push({ el: el as HTMLElement, start, end: text.length });
      return;
    }

    for (const child of Array.from(el.children)) walk(child, parentIsOL);
  }

  walk(root);
  return { text: text.trim(), paragraphs };
}

// Sentence splitter that respects common abbreviations and decimals.
function splitIntoSentences(text: string, baseOffset = 0): SentenceChunk[] {
  // Replace known abbreviation periods with a placeholder so they don't trigger splits.
  const PLACEHOLDER = '';
  const ABBREVS = ['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Prof.', 'Sr.', 'Jr.', 'St.', 'vs.', 'etc.', 'e.g.', 'i.e.'];
  let masked = text;
  for (const a of ABBREVS) {
    masked = masked.split(a).join(a.replace('.', PLACEHOLDER));
  }
  // Mask decimals like 1.5
  masked = masked.replace(/(\d)\.(\d)/g, `$1${PLACEHOLDER}$2`);

  const chunks: SentenceChunk[] = [];
  // Match sentences ending in . ! ? followed by whitespace or end.
  const sentenceRe = /([^.!?\n]+[.!?]+|[^\n]+$)/g;
  let m: RegExpExecArray | null;
  while ((m = sentenceRe.exec(masked)) !== null) {
    const raw = m[0];
    const restored = raw.replace(new RegExp(PLACEHOLDER, 'g'), '.');
    const trimmed = restored.trim();
    if (!trimmed) continue;
    const localStart = m.index;
    chunks.push({
      text: trimmed,
      start: baseOffset + localStart,
      end: baseOffset + localStart + raw.length,
    });
  }
  return chunks;
}

function findParagraphAt(charIndex: number, paragraphs: ParagraphRange[]): HTMLElement | null {
  for (const p of paragraphs) {
    if (charIndex >= p.start && charIndex < p.end) return p.el;
  }
  return null;
}

function applyHighlight(el: HTMLElement | null): void {
  if (!el) return;
  for (const c of HIGHLIGHT_CLASSES) el.classList.add(c);
  el.setAttribute('aria-current', 'true');
}

function clearHighlight(el: HTMLElement | null): void {
  if (!el) return;
  for (const c of HIGHLIGHT_CLASSES) el.classList.remove(c);
  el.removeAttribute('aria-current');
}

function isInViewport(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight;
  return r.top >= 80 && r.bottom <= vh - 120; // leave room above the sticky bar
}

// --- Sticky player bar (rendered via portal to document.body) ----------------

interface StickyBarProps {
  status: Status;
  showDoneFlash: boolean;
  isPlaying: boolean;
  closing: boolean;
  title?: string;
  progress: number;
  rate: 1 | 1.5 | 2;
  elapsedSec: number;
  totalSec: number;
  voices: VoiceWithTier[];
  selectedVoiceURI: string | null;
  onPlayPause: () => void;
  onStop: () => void;
  onSpeedCycle: () => void;
  onVoiceChange: (voice: SpeechSynthesisVoice | null) => void;
  onTrackVoicePickerOpened: () => void;
}

function StickyPlayerBar(props: StickyBarProps) {
  const {
    isPlaying,
    showDoneFlash,
    closing,
    title,
    progress,
    rate,
    elapsedSec,
    totalSec,
    voices,
    selectedVoiceURI,
    onPlayPause,
    onStop,
    onSpeedCycle,
    onVoiceChange,
    onTrackVoicePickerOpened,
  } = props;

  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const pickerButtonRef = useRef<HTMLButtonElement | null>(null);

  // Close picker on outside click.
  useEffect(() => {
    if (!pickerOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (pickerRef.current?.contains(t) || pickerButtonRef.current?.contains(t)) return;
      setPickerOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [pickerOpen]);

  // Close picker on Escape.
  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPickerOpen(false);
        pickerButtonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pickerOpen]);

  const animClass = closing ? 'motion-safe:animate-slide-down' : 'motion-safe:animate-slide-up';

  // Group voices for the picker.
  const groups = useMemo(() => {
    const premium = voices.filter((v) => v.tier <= 2);
    const rest = voices.filter((v) => v.tier > 2);
    return { premium, rest };
  }, [voices]);

  const showPicker = voices.length > 1;

  return (
    <div
      role="region"
      aria-label="Article reader"
      className={`fixed left-0 right-0 z-[65] bottom-[calc(4rem+env(safe-area-inset-bottom))] md:bottom-0 ${animClass}`}
    >
      <div className="bg-background/85 backdrop-blur-md border-t border-border/60 shadow-[0_-4px_20px_rgba(0,0,0,0.04)]">
        <div className="max-w-[1200px] mx-auto px-3 md:px-5 h-14 md:h-16 flex items-center gap-2 md:gap-3 pr-20 md:pr-24">
          {/* Play / pause */}
          <button
            type="button"
            onClick={onPlayPause}
            aria-label={isPlaying ? 'Pause article' : 'Play article'}
            aria-pressed={isPlaying}
            className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-accent text-accent-foreground hover:scale-105 active:scale-95 transition-all duration-150 flex items-center justify-center flex-shrink-0"
          >
            {showDoneFlash ? (
              <svg key="done" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="motion-safe:animate-scale-in">
                <polyline points="5 13 10 18 19 7" />
              </svg>
            ) : isPlaying ? (
              <svg key="pause" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="motion-safe:animate-fade-in-fast">
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            ) : (
              <svg key="play" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="motion-safe:animate-fade-in-fast">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {/* Stop (hidden in done flash to keep the moment clean) */}
          {!showDoneFlash && (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop reading"
              className="w-8 h-8 md:w-9 md:h-9 rounded-full bg-background border border-border text-foreground-muted hover:text-foreground hover:scale-105 active:scale-95 transition-all duration-150 flex items-center justify-center flex-shrink-0"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
            </button>
          )}

          {/* Title — orientation when scrolled. Hidden under 480px. */}
          {title && (
            <span className="hidden min-[480px]:inline-block flex-shrink min-w-0 truncate text-sm font-display text-foreground" aria-hidden="true">
              {title}
            </span>
          )}

          {/* Progress bar */}
          {!showDoneFlash && (
            <div
              role="progressbar"
              aria-label="Reading progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
              className="relative flex-1 min-w-[60px] md:max-w-sm h-1 bg-foreground/10 rounded-full overflow-hidden"
            >
              <div
                className="absolute inset-y-0 left-0 bg-accent rounded-full"
                style={{ width: `${progress * 100}%`, transition: 'width 200ms linear' }}
              />
            </div>
          )}

          {/* Time */}
          {!showDoneFlash && totalSec > 0 && (
            <span className="hidden min-[380px]:inline text-[11px] text-foreground-muted tabular-nums select-none flex-shrink-0">
              {fmtTime(elapsedSec)} / {fmtTime(totalSec)}
            </span>
          )}

          {/* Speed pill */}
          {!showDoneFlash && (
            <button
              type="button"
              onClick={onSpeedCycle}
              aria-label={`Playback speed, currently ${rate}×`}
              className="rounded-full px-2.5 py-1 bg-background border border-border text-[11px] font-semibold text-foreground hover:bg-accent/10 hover:text-accent hover:border-accent/30 transition-all duration-150 tabular-nums flex-shrink-0"
            >
              <span key={rate} className="inline-block motion-safe:animate-fade-up">
                {rate}×
              </span>
            </button>
          )}

          {/* Voice picker */}
          {!showDoneFlash && showPicker && (
            <div className="relative flex-shrink-0">
              <button
                ref={pickerButtonRef}
                type="button"
                onClick={() => {
                  if (!pickerOpen) onTrackVoicePickerOpened();
                  setPickerOpen((p) => !p);
                }}
                aria-haspopup="listbox"
                aria-expanded={pickerOpen}
                aria-label="Pick a voice"
                className="rounded-full px-2.5 py-1 bg-background border border-border text-[11px] font-medium text-foreground hover:bg-accent/10 hover:text-accent hover:border-accent/30 transition-all duration-150 inline-flex items-center gap-1"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                  <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
                  <line x1="12" y1="19" x2="12" y2="22" />
                </svg>
                <span>Voice</span>
              </button>
              {pickerOpen && (
                <div
                  ref={pickerRef}
                  role="listbox"
                  aria-label="Available voices"
                  className="absolute right-0 bottom-full mb-2 w-[260px] max-h-[60vh] overflow-y-auto bg-background border border-border rounded-xl shadow-2xl py-2 motion-safe:animate-fade-up"
                >
                  {groups.premium.length > 0 && (
                    <>
                      <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-foreground-muted font-semibold">
                        Recommended
                      </div>
                      {groups.premium.map((v) => (
                        <VoiceRow
                          key={v.voice.voiceURI}
                          voice={v}
                          selected={v.voice.voiceURI === selectedVoiceURI}
                          onPick={() => {
                            onVoiceChange(v.voice);
                            setPickerOpen(false);
                          }}
                        />
                      ))}
                    </>
                  )}
                  {groups.rest.length > 0 && (
                    <>
                      <div className="px-3 py-1 mt-1 text-[10px] uppercase tracking-wider text-foreground-muted font-semibold">
                        All English voices
                      </div>
                      {groups.rest.map((v) => (
                        <VoiceRow
                          key={v.voice.voiceURI}
                          voice={v}
                          selected={v.voice.voiceURI === selectedVoiceURI}
                          onPick={() => {
                            onVoiceChange(v.voice);
                            setPickerOpen(false);
                          }}
                        />
                      ))}
                    </>
                  )}
                  <div className="border-t border-border/60 mt-1 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        onVoiceChange(null);
                        setPickerOpen(false);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs text-foreground-muted hover:text-foreground hover:bg-background-secondary"
                    >
                      Use device default
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Close (×) — equivalent to Stop with a clearer affordance */}
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop reading and close player"
            className="absolute right-3 md:right-5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full text-foreground-muted hover:text-foreground hover:bg-background-secondary transition-colors duration-150 flex items-center justify-center"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function VoiceRow({
  voice,
  selected,
  onPick,
}: {
  voice: VoiceWithTier;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onPick}
      className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs text-left hover:bg-background-secondary transition-colors ${selected ? 'bg-accent/8 text-accent' : 'text-foreground'}`}
    >
      <span className="truncate">{voice.voice.name}</span>
      <span className={`text-[9px] uppercase tracking-wider font-semibold flex-shrink-0 ${voice.tier <= 2 ? 'text-accent' : 'text-foreground-muted'}`}>
        {voice.tierLabel}
      </span>
    </button>
  );
}

// --- Main component ----------------------------------------------------------

export default function ListenButton({ articleSelector = '#article-body', slug, title }: Props) {
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  const [rate, setRate] = useState<1 | 1.5 | 2>(1);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showDoneFlash, setShowDoneFlash] = useState(false);
  const [closing, setClosing] = useState(false);
  const [voices, setVoices] = useState<VoiceWithTier[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const queueRef = useRef<SentenceChunk[]>([]);
  const queueIndexRef = useRef(0);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const extractedRef = useRef<ExtractResult | null>(null);
  const sentenceCharOffsetRef = useRef(0); // absolute offset of the current sentence's start
  const lastBoundaryCharRef = useRef(0);
  const totalCharsRef = useRef(0);
  const currentParagraphRef = useRef<HTMLElement | null>(null);
  const ariaLiveRef = useRef<HTMLSpanElement | null>(null);
  const startedTrackedRef = useRef(false);
  const playerOpenedTrackedRef = useRef(false);
  const cancelledRef = useRef(false);

  // Mount detection (for portal target).
  useEffect(() => {
    setMounted(true);
  }, []);

  // Feature detect + voice list on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('speechSynthesis' in window)) {
      setStatus('unsupported');
      return;
    }
    const refreshVoices = () => {
      const ranked = getEnglishVoices();
      setVoices(ranked);
      const saved = loadSavedVoice();
      if (saved) setSelectedVoiceURI(saved.voiceURI);
    };
    refreshVoices();
    window.speechSynthesis.addEventListener('voiceschanged', refreshVoices);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', refreshVoices);
  }, []);

  const cleanupSpeech = useCallback(() => {
    cancelledRef.current = true;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    clearHighlight(currentParagraphRef.current);
    currentParagraphRef.current = null;
    queueRef.current = [];
    queueIndexRef.current = 0;
  }, []);

  // Cleanup on unmount + on Astro client-side navigation.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onBeforeSwap = () => cleanupSpeech();
    document.addEventListener('astro:before-swap', onBeforeSwap);
    return () => {
      document.removeEventListener('astro:before-swap', onBeforeSwap);
      cleanupSpeech();
    };
  }, [cleanupSpeech]);

  // Pause when tab hidden; do NOT auto-resume on visibility change.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVis = () => {
      if (document.hidden && status === 'playing') {
        window.speechSynthesis.pause();
        setStatus('paused');
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [status]);

  const announceParagraph = useCallback((el: HTMLElement | null) => {
    if (!el || !ariaLiveRef.current) return;
    const snippet = (el.textContent ?? '').trim().slice(0, 60);
    ariaLiveRef.current.textContent = `Now reading: ${snippet}…`;
  }, []);

  const speakNextSentence = useCallback(
    (currentRate: 1 | 1.5 | 2, voice: SpeechSynthesisVoice | undefined) => {
      const queue = queueRef.current;
      const idx = queueIndexRef.current;
      if (idx >= queue.length) {
        // Article complete.
        clearHighlight(currentParagraphRef.current);
        currentParagraphRef.current = null;
        setProgress(1);
        setStatus('done');
        setShowDoneFlash(true);
        track('insight_listen_completed', { slug, total_chars: totalCharsRef.current });
        setTimeout(() => {
          setShowDoneFlash(false);
          setClosing(true);
          setTimeout(() => {
            setStatus('idle');
            setClosing(false);
            setProgress(0);
            startedTrackedRef.current = false;
            playerOpenedTrackedRef.current = false;
          }, 300);
        }, 700);
        return;
      }

      const chunk = queue[idx];
      sentenceCharOffsetRef.current = chunk.start;

      const utt = new SpeechSynthesisUtterance(chunk.text);
      utt.lang = 'en-US';
      utt.rate = currentRate;
      if (voice) utt.voice = voice;

      utt.onstart = () => setStatus('playing');
      utt.onpause = () => setStatus('paused');
      utt.onresume = () => setStatus('playing');
      utt.onerror = (e) => {
        // A single-sentence error shouldn't kill the whole article — advance and continue.
        console.warn('[listen] sentence error, skipping', e);
        queueIndexRef.current += 1;
        if (!cancelledRef.current) speakNextSentence(currentRate, voice);
      };
      utt.onend = () => {
        if (cancelledRef.current) return;
        queueIndexRef.current += 1;
        // Advance progress to end-of-sentence for the boundary gap.
        const total = totalCharsRef.current || 1;
        setProgress(Math.min(1, chunk.end / total));
        speakNextSentence(currentRate, voice);
      };
      utt.onboundary = (event) => {
        const absoluteCharIndex = chunk.start + event.charIndex;
        lastBoundaryCharRef.current = absoluteCharIndex;
        const total = totalCharsRef.current || 1;
        setProgress(Math.min(1, absoluteCharIndex / total));
        const para = findParagraphAt(absoluteCharIndex, extractedRef.current?.paragraphs ?? []);
        if (para && para !== currentParagraphRef.current) {
          clearHighlight(currentParagraphRef.current);
          applyHighlight(para);
          currentParagraphRef.current = para;
          announceParagraph(para);
          if (!prefersReducedMotion() && !isInViewport(para)) {
            para.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      };

      utteranceRef.current = utt;
      window.speechSynthesis.speak(utt);
    },
    [announceParagraph, slug]
  );

  const resolveVoice = useCallback((): SpeechSynthesisVoice | undefined => {
    if (selectedVoiceURI) {
      const all = window.speechSynthesis.getVoices();
      const found = all.find((v) => v.voiceURI === selectedVoiceURI);
      if (found) return found;
    }
    return autoPickVoice();
  }, [selectedVoiceURI]);

  const startSpeechFromOffset = useCallback(
    (charOffset: number, currentRate: 1 | 1.5 | 2) => {
      const extracted = extractedRef.current;
      if (!extracted) return;

      // Build queue from the sentence containing charOffset onward.
      const allSentences = splitIntoSentences(extracted.text, 0);
      const startIdx = Math.max(
        0,
        allSentences.findIndex((s) => s.end > charOffset)
      );
      queueRef.current = allSentences.slice(startIdx);
      queueIndexRef.current = 0;
      cancelledRef.current = false;
      totalCharsRef.current = extracted.text.length;

      window.speechSynthesis.cancel();
      const voice = resolveVoice();
      speakNextSentence(currentRate, voice);
    },
    [resolveVoice, speakNextSentence]
  );

  const handlePlay = useCallback(() => {
    if (status === 'paused') {
      window.speechSynthesis.resume();
      return;
    }
    if (status === 'playing') {
      window.speechSynthesis.pause();
      return;
    }
    // Fresh start.
    const root = document.querySelector(articleSelector);
    if (!root) {
      setErrorMessage("Couldn't find the article body.");
      setStatus('error');
      return;
    }
    const extracted = extractReadableText(root);
    if (!extracted.text.trim()) {
      setErrorMessage('No text to read.');
      setStatus('error');
      return;
    }
    extractedRef.current = extracted;
    lastBoundaryCharRef.current = 0;
    setProgress(0);
    setStatus('loading');

    if (!startedTrackedRef.current) {
      track('insight_listen_started', {
        slug,
        estimated_duration_sec: Math.round(estDurationSec(extracted.text, rate)),
        rate,
      });
      startedTrackedRef.current = true;
    }
    if (!playerOpenedTrackedRef.current) {
      track('insight_listen_player_opened', { slug });
      playerOpenedTrackedRef.current = true;
    }
    startSpeechFromOffset(0, rate);
  }, [articleSelector, rate, slug, startSpeechFromOffset, status]);

  const handleStop = useCallback(() => {
    setClosing(true);
    cleanupSpeech();
    // Wait for the slide-down to finish before resetting state.
    setTimeout(() => {
      setStatus('idle');
      setProgress(0);
      setClosing(false);
      startedTrackedRef.current = false;
      playerOpenedTrackedRef.current = false;
    }, 300);
  }, [cleanupSpeech]);

  const handleSpeedCycle = useCallback(() => {
    const nextRate = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    setRate(nextRate);
    track('insight_listen_speed_changed', { slug, new_rate: nextRate });
    if (status === 'playing' || status === 'paused') {
      const offset = lastBoundaryCharRef.current;
      startSpeechFromOffset(offset, nextRate);
    }
  }, [rate, slug, startSpeechFromOffset, status]);

  const handleVoiceChange = useCallback(
    (voice: SpeechSynthesisVoice | null) => {
      setSelectedVoiceURI(voice?.voiceURI ?? null);
      saveVoice(voice);
      track('insight_listen_voice_changed', {
        slug,
        voice_name: voice?.name ?? 'device-default',
        voice_lang: voice?.lang ?? null,
        was_local: voice?.localService ?? null,
      });
      if (status === 'playing' || status === 'paused') {
        const offset = lastBoundaryCharRef.current;
        startSpeechFromOffset(offset, rate);
      }
    },
    [rate, slug, startSpeechFromOffset, status]
  );

  const handleVoicePickerOpened = useCallback(() => {
    track('insight_listen_voice_picker_opened', { slug });
  }, [slug]);

  // Keyboard shortcuts attach to document while bar is active.
  useEffect(() => {
    const isActive = status === 'playing' || status === 'paused' || status === 'loading' || showDoneFlash;
    if (!isActive) return;
    const onKey = (e: KeyboardEvent) => {
      // Don't intercept typing in inputs.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        handlePlay();
      } else if (e.code === 'Escape') {
        e.preventDefault();
        handleStop();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [handlePlay, handleStop, showDoneFlash, status]);

  if (status === 'unsupported') return null;

  const isExpanded = status === 'playing' || status === 'paused' || status === 'loading' || showDoneFlash || closing;
  const isPlaying = status === 'playing';

  const total = extractedRef.current?.text.length ?? 0;
  const elapsedSec = total ? Math.round(estDurationSec(extractedRef.current!.text, rate) * progress) : 0;
  const totalSec = total ? Math.round(estDurationSec(extractedRef.current!.text, rate)) : 0;

  return (
    <>
      {/* Idle pill in article header (only when bar is not active) */}
      <div className="flex items-center gap-2 motion-safe:animate-fade-up">
        {!isExpanded && status !== 'error' && (
          <button
            type="button"
            onClick={handlePlay}
            aria-label="Play article"
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 bg-accent/10 text-accent border border-accent/20 text-sm font-medium hover:bg-accent/15 hover:-translate-y-0.5 transition-all duration-200"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
            <span>Listen</span>
          </button>
        )}

        {status === 'error' && errorMessage && (
          <div
            role="alert"
            className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 bg-red-50 border border-red-200 text-red-700 text-xs motion-safe:animate-fade-up"
          >
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={() => {
                setErrorMessage(null);
                setStatus('idle');
              }}
              className="underline font-medium"
              aria-label="Dismiss"
            >
              dismiss
            </button>
          </div>
        )}

        <span ref={ariaLiveRef} aria-live="polite" className="sr-only" />
      </div>

      {/* Sticky bar portal — only mounted when active */}
      {mounted && isExpanded &&
        createPortal(
          <StickyPlayerBar
            status={status}
            showDoneFlash={showDoneFlash}
            isPlaying={isPlaying}
            closing={closing}
            title={title}
            progress={progress}
            rate={rate}
            elapsedSec={elapsedSec}
            totalSec={totalSec}
            voices={voices}
            selectedVoiceURI={selectedVoiceURI}
            onPlayPause={handlePlay}
            onStop={handleStop}
            onSpeedCycle={handleSpeedCycle}
            onVoiceChange={handleVoiceChange}
            onTrackVoicePickerOpened={handleVoicePickerOpened}
          />,
          document.body
        )}
    </>
  );
}
