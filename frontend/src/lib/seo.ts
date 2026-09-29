// Meta description normalisation, single source of truth.
//
// WordPress `description` fields are often the article's whole intro (up to
// ~800 characters) and portfolio pages used to hard-slice at 180 characters,
// cutting mid-word. Google truncates snippets around 155-160 characters and
// rewrites descriptions it considers poor, so an over-long description means
// losing control of how the result reads. Clamp at a word boundary instead.

const DEFAULT_MAX = 155;

/** Strip tags, collapse whitespace and clamp to `max` chars at a word boundary. */
export function clampDescription(text: string | null | undefined, max = DEFAULT_MAX): string {
  const clean = String(text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= max) return clean;

  // Leave room for the ellipsis, then back up to the last whole word.
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const trimmed = (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut)
    .replace(/[\s,;:.!?\-–—]+$/, '');
  return `${trimmed}…`;
}

/**
 * Demote <h1> in CMS body HTML to <h2>. The page template already renders the
 * title as the page's only H1; a second one from WordPress content muddies
 * the document outline search engines read.
 */
export function demoteBodyH1(html: string): string {
  return html.replace(/<(\/?)h1\b/gi, '<$1h2');
}
