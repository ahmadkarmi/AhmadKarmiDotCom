// HTML stripper + semantic chunker for Ask Ahmad ingestion.
//
// Splits text on paragraph boundaries first, then merges paragraphs to fill
// ~600-token chunks with ~100-token overlap between adjacent chunks. Token
// estimation is character-based (~4 chars/token) — good enough for chunking
// budget; precise counts come from the embedding API response.

const TARGET_TOKENS = 600;
const OVERLAP_TOKENS = 100;
const CHARS_PER_TOKEN = 4;

const TARGET_CHARS = TARGET_TOKENS * CHARS_PER_TOKEN;
const OVERLAP_CHARS = OVERLAP_TOKENS * CHARS_PER_TOKEN;

export function stripHtml(html: string): string {
  if (!html) return '';
  return html
    // Drop script/style blocks entirely
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    // Convert block-level boundaries to double-newlines so paragraphs split cleanly
    .replace(/<\/(p|div|li|h[1-6]|blockquote|pre|tr)>/gi, '\n\n')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    // Drop remaining tags
    .replace(/<[^>]+>/g, '')
    // Decode common entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    // Collapse whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface Chunk {
  index: number;
  text: string;
  estTokens: number;
}

export function chunkText(text: string): Chunk[] {
  const normalized = text.trim();
  if (!normalized) return [];

  // If the whole thing fits, return as a single chunk.
  if (normalized.length <= TARGET_CHARS) {
    return [{ index: 0, text: normalized, estTokens: Math.ceil(normalized.length / CHARS_PER_TOKEN) }];
  }

  const paragraphs = normalized.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: Chunk[] = [];
  let current = '';

  function push() {
    if (!current.trim()) return;
    chunks.push({
      index: chunks.length,
      text: current.trim(),
      estTokens: Math.ceil(current.length / CHARS_PER_TOKEN),
    });
  }

  for (const para of paragraphs) {
    // If a single paragraph is itself larger than target, split it on sentence boundaries.
    if (para.length > TARGET_CHARS) {
      if (current) {
        push();
        current = '';
      }
      const sentences = para.split(/(?<=[.!?])\s+/);
      let buf = '';
      for (const s of sentences) {
        if ((buf + ' ' + s).length > TARGET_CHARS && buf) {
          chunks.push({
            index: chunks.length,
            text: buf.trim(),
            estTokens: Math.ceil(buf.length / CHARS_PER_TOKEN),
          });
          // Carry overlap from end of buf into next.
          buf = buf.slice(-OVERLAP_CHARS) + ' ' + s;
        } else {
          buf = buf ? `${buf} ${s}` : s;
        }
      }
      if (buf) {
        current = buf;
      }
      continue;
    }

    if ((current + '\n\n' + para).length > TARGET_CHARS && current) {
      push();
      // Seed next chunk with overlap from the tail of the previous one.
      current = current.slice(-OVERLAP_CHARS) + '\n\n' + para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  push();

  return chunks;
}
