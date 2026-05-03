import { useState } from 'react';

type Mode = 'recruiter' | 'founder' | 'peer-pm' | 'anyone';

export default function Chat() {
  const [mode, setMode] = useState<Mode>('anyone');
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full bg-neutral-900 text-white px-4 py-2 text-sm font-medium shadow-lg hover:bg-neutral-800 transition"
      >
        Ask Ahmad &rarr;
      </button>
    );
  }

  return (
    <div className="w-[380px] max-w-[calc(100vw-3rem)] bg-white border border-neutral-200 rounded-2xl shadow-2xl overflow-hidden">
      <header className="px-4 py-3 border-b border-neutral-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-neutral-900">Ask Ahmad</span>
          <span className="text-xs text-neutral-500">scaffold</span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="text-neutral-400 hover:text-neutral-700"
        >
          &times;
        </button>
      </header>

      <div className="px-4 py-3 border-b border-neutral-100">
        <div className="text-xs text-neutral-500 mb-2">Mode</div>
        <div className="flex gap-1 flex-wrap">
          {(['anyone', 'recruiter', 'founder', 'peer-pm'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`text-xs px-2 py-1 rounded-full border transition ${
                mode === m
                  ? 'bg-neutral-900 text-white border-neutral-900'
                  : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-400'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-6 text-sm text-neutral-600">
        <p className="mb-2">Hi &mdash; I&rsquo;m Ahmad&rsquo;s second brain.</p>
        <p className="text-neutral-500">
          The chat backend is scaffolded but not wired yet. Once the Anthropic key, Neon, and Upstash are
          provisioned, this will stream answers in Ahmad&rsquo;s voice with citations.
        </p>
      </div>

      <footer className="px-4 py-2 border-t border-neutral-100 text-[10px] text-neutral-400 flex items-center justify-between">
        <span>Groundedness &mdash; &middot; Voice &mdash; &middot; Refusal &mdash;</span>
        <span>scaffold</span>
      </footer>
    </div>
  );
}
