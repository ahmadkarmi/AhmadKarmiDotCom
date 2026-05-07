import { useCallback, useEffect, useRef, useState } from 'react';

type Status = 'unsupported' | 'idle' | 'loading' | 'playing' | 'paused' | 'done' | 'error';

interface ParagraphRange {
  el: HTMLElement;
  start: number;
  end: number;
}

interface ExtractResult {
  text: string;
  paragraphs: ParagraphRange[];
}

interface Props {
  articleSelector?: string;
  slug?: string;
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
  // Rough average for English TTS: ~18 chars per second at 1x.
  return text.length / (18 * rate);
}

function pickEnglishVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return undefined;
  // Prefer high-quality local voices (Apple, MS) over network ones.
  const localEnglish = voices.find((v) => v.localService && v.lang.startsWith('en'));
  if (localEnglish) return localEnglish;
  return voices.find((v) => v.lang.startsWith('en'));
}

// Walk the article DOM, skipping elements we should not read aloud (code,
// figures, embeds). Build a flat text string and a side-table mapping char
// ranges back to the paragraph element they came from so we can highlight
// the correct paragraph as the speech engine progresses.
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

  const paragraphs: ParagraphRange[] = [];
  let text = '';

  function walk(el: Element): void {
    if (SKIP.has(el.tagName)) return;
    if (PARAGRAPH_TAGS.has(el.tagName)) {
      const start = text.length;
      const inner = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (inner) {
        text += inner + '\n\n';
        paragraphs.push({ el: el as HTMLElement, start, end: text.length });
      }
      return;
    }
    for (const child of Array.from(el.children)) walk(child);
  }

  walk(root);
  return { text: text.trim(), paragraphs };
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
  return r.top >= 80 && r.bottom <= vh - 80;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const RATES: Array<1 | 1.5 | 2> = [1, 1.5, 2];

export default function ListenButton({ articleSelector = '#article-body', slug }: Props) {
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  const [rate, setRate] = useState<1 | 1.5 | 2>(1);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showDoneFlash, setShowDoneFlash] = useState(false);

  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const extractedRef = useRef<ExtractResult | null>(null);
  const currentParagraphRef = useRef<HTMLElement | null>(null);
  const lastBoundaryCharRef = useRef(0);
  const ariaLiveRef = useRef<HTMLSpanElement | null>(null);
  const startedTrackedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Feature detection — runs once on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('speechSynthesis' in window)) {
      setStatus('unsupported');
      return;
    }
    // Some browsers (Chrome) load voices async; the first call may return [].
    // We just kick a getVoices() to populate the list and listen for changes.
    window.speechSynthesis.getVoices();
    const onVoices = () => {
      // Re-render isn't strictly required; the next play call will pick a voice.
    };
    window.speechSynthesis.addEventListener('voiceschanged', onVoices);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', onVoices);
    };
  }, []);

  const cleanupSpeech = useCallback(() => {
    if (typeof window === 'undefined') return;
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    clearHighlight(currentParagraphRef.current);
    currentParagraphRef.current = null;
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

  // Pause when the tab is hidden. Stay paused when it returns (don't auto-resume).
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

  const speakFromCharIndex = useCallback(
    (charOffset: number, currentRate: 1 | 1.5 | 2) => {
      const extracted = extractedRef.current;
      if (!extracted) return;
      const text = extracted.text.slice(charOffset);
      if (!text.trim()) {
        setStatus('idle');
        return;
      }
      const utt = new SpeechSynthesisUtterance(text);
      utt.lang = 'en-US';
      utt.rate = currentRate;
      const voice = pickEnglishVoice();
      if (voice) utt.voice = voice;

      utt.onstart = () => {
        setStatus('playing');
      };
      utt.onpause = () => setStatus('paused');
      utt.onresume = () => setStatus('playing');
      utt.onerror = (e) => {
        console.error('[listen] speech error', e);
        setErrorMessage("Couldn't read this article. Try a different browser.");
        setStatus('error');
        clearHighlight(currentParagraphRef.current);
        currentParagraphRef.current = null;
      };
      utt.onend = () => {
        // onend fires both on natural completion and on cancel(). Distinguish
        // by checking if the cancellation reset our local state.
        if (status === 'idle' || status === 'error') return;
        clearHighlight(currentParagraphRef.current);
        currentParagraphRef.current = null;
        setProgress(1);
        setStatus('done');
        setShowDoneFlash(true);
        track('insight_listen_completed', { slug, total_chars: extracted.text.length });
        setTimeout(() => {
          setShowDoneFlash(false);
          setStatus('idle');
          setProgress(0);
          startedTrackedRef.current = false;
        }, 700);
      };
      utt.onboundary = (event) => {
        const absoluteCharIndex = charOffset + event.charIndex;
        lastBoundaryCharRef.current = absoluteCharIndex;
        const total = extracted.text.length || 1;
        setProgress(Math.min(1, absoluteCharIndex / total));
        const para = findParagraphAt(absoluteCharIndex, extracted.paragraphs);
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
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utt);
    },
    [announceParagraph, slug, status]
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
    speakFromCharIndex(0, rate);
  }, [articleSelector, rate, slug, speakFromCharIndex, status]);

  const handleStop = useCallback(() => {
    cleanupSpeech();
    setStatus('idle');
    setProgress(0);
    startedTrackedRef.current = false;
  }, [cleanupSpeech]);

  const handleSpeedCycle = useCallback(() => {
    const nextRate = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    setRate(nextRate);
    track('insight_listen_speed_changed', { slug, new_rate: nextRate });
    if (status === 'playing' || status === 'paused') {
      // Restart from the last boundary so we don't lose place.
      const offset = lastBoundaryCharRef.current;
      speakFromCharIndex(offset, nextRate);
    }
  }, [rate, slug, speakFromCharIndex, status]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (status === 'unsupported' || status === 'idle') return;
      if (e.code === 'Space') {
        e.preventDefault();
        handlePlay();
      } else if (e.code === 'Escape') {
        e.preventDefault();
        handleStop();
      }
    },
    [handlePlay, handleStop, status]
  );

  const total = extractedRef.current?.text.length ?? 0;
  const elapsedSec = total ? Math.round(estDurationSec(extractedRef.current!.text, rate) * progress) : 0;
  const totalSec = total ? Math.round(estDurationSec(extractedRef.current!.text, rate)) : 0;

  if (status === 'unsupported') return null;

  const isExpanded = status === 'playing' || status === 'paused' || status === 'loading' || showDoneFlash;
  const isPlaying = status === 'playing';

  return (
    <div className="flex items-center gap-2 motion-safe:animate-fade-up" ref={containerRef} onKeyDown={onKeyDown}>
      {/* Idle pill */}
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

      {/* Expanded toolbar */}
      {isExpanded && (
        <div
          className="inline-flex items-center gap-2 rounded-full bg-background-secondary/60 border border-border/60 pl-1 pr-2 py-1 motion-safe:animate-fade-in-fast"
          role="group"
          aria-label="Article reader controls"
        >
          {/* Play / pause */}
          <button
            type="button"
            onClick={handlePlay}
            aria-label={isPlaying ? 'Pause article' : 'Play article'}
            aria-pressed={isPlaying}
            disabled={status === 'loading'}
            className="w-8 h-8 rounded-full bg-accent text-accent-foreground hover:scale-105 active:scale-95 disabled:opacity-60 transition-all duration-150 flex items-center justify-center flex-shrink-0"
          >
            {showDoneFlash ? (
              <svg
                key="done"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="motion-safe:animate-scale-in"
              >
                <polyline points="5 13 10 18 19 7" />
              </svg>
            ) : isPlaying ? (
              <svg key="pause" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="motion-safe:animate-fade-in-fast">
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            ) : (
              <svg key="play" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="motion-safe:animate-fade-in-fast">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {/* Stop */}
          {!showDoneFlash && (
            <button
              type="button"
              onClick={handleStop}
              aria-label="Stop reading"
              className="w-8 h-8 rounded-full bg-background border border-border text-foreground-muted hover:text-foreground hover:scale-105 active:scale-95 transition-all duration-150 flex items-center justify-center flex-shrink-0"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
            </button>
          )}

          {/* Progress bar */}
          {!showDoneFlash && (
            <div
              role="progressbar"
              aria-label="Reading progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
              className="relative h-1 bg-foreground/10 rounded-full overflow-hidden w-20 sm:w-32 flex-shrink-0"
            >
              <div
                className="absolute inset-y-0 left-0 bg-accent rounded-full"
                style={{
                  width: `${progress * 100}%`,
                  transition: 'width 200ms linear',
                }}
              />
            </div>
          )}

          {/* Time */}
          {!showDoneFlash && totalSec > 0 && (
            <span className="hidden sm:inline text-[11px] text-foreground-muted tabular-nums select-none">
              {fmtTime(elapsedSec)} / {fmtTime(totalSec)}
            </span>
          )}

          {/* Speed pill */}
          {!showDoneFlash && (
            <button
              type="button"
              onClick={handleSpeedCycle}
              aria-label={`Playback speed, currently ${rate}×`}
              className="rounded-full px-2 py-0.5 bg-background border border-border text-[11px] font-semibold text-foreground hover:bg-accent/10 hover:text-accent hover:border-accent/30 transition-all duration-150 tabular-nums"
            >
              <span key={rate} className="inline-block motion-safe:animate-fade-up">
                {rate}×
              </span>
            </button>
          )}
        </div>
      )}

      {/* Error toast */}
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

      {/* SR-only announcer for active paragraph changes */}
      <span ref={ariaLiveRef} aria-live="polite" className="sr-only" />
    </div>
  );
}
