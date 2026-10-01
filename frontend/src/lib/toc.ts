// Table of contents for long articles. Gives every <h2> in the rendered body
// a stable id (keeping any id WordPress already set) and returns the list, so
// the page can link to each section. Google sometimes shows these section
// links under the result.

export interface TocHeading {
  id: string;
  text: string;
}

/** An article gets a table of contents from this many sections. */
export const MIN_TOC_HEADINGS = 3;

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

export function addHeadingIds(html: string): { html: string; headings: TocHeading[] } {
  const headings: TocHeading[] = [];
  const used = new Set<string>();

  const out = html.replace(/<h2\b([^>]*)>([\s\S]*?)<\/h2>/gi, (full, attrs: string, inner: string) => {
    const text = decodeEntities(inner.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (!text) return full;

    const existing = attrs.match(/\bid=(["'])([^"']+)\1/i)?.[2];
    let id = existing || slugify(text) || 'section';
    if (!existing) {
      const base = id;
      for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    }
    used.add(id);
    headings.push({ id, text });
    return existing ? full : `<h2${attrs} id="${id}">${inner}</h2>`;
  });

  return { html: out, headings };
}
