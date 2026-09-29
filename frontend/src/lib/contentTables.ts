// Responsive tables for WordPress content.
//
// Any <table> in post or page HTML (Gutenberg table blocks, classic-editor
// HTML, or markdown tables rendered by marked) is wrapped in a horizontal
// scroll container, so a wide table scrolls inside itself instead of
// pushing the page wider than a phone screen. Before this, the Trakr case
// study's 4-column table rendered 395px wide inside a 288px column and made
// the whole page pan sideways.
//
// Styling lives in global.css (.table-scroll); lib/tableScroll.ts only adds
// the edge fades and the swipe hint. Without JS the table still scrolls.

const TABLE_RE = /<table\b[^>]*>[\s\S]*?<\/table>/gi;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };

function plainText(html: string): string {
    return html
        .replace(/<[^>]+>/g, ' ')
        .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e) => ENTITIES[e])
        .replace(/\s+/g, ' ')
        .trim();
}

function escapeAttr(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Accessible name for the scroll region: the caption, else the first row. */
function tableLabel(table: string): string {
    const caption = table.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i);
    if (caption) {
        const text = plainText(caption[1]);
        if (text) return `Table: ${text}`;
    }
    const firstRow = table.match(/<tr\b[^>]*>([\s\S]*?)<\/tr>/i);
    const cells = firstRow
        ? Array.from(firstRow[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi), (m) => plainText(m[1])).filter(Boolean)
        : [];
    const label = cells.length ? `Table: ${cells.join(', ')}` : 'Table';
    return label.length > 120 ? `${label.slice(0, 117)}...` : label;
}

/** Wrap every table in a keyboard-focusable, labelled scroll region. */
export function wrapContentTables(html: string | undefined | null): string {
    if (!html) return '';
    if (!/<table\b/i.test(html) || html.includes('data-table-scroll')) return html;
    return html.replace(
        TABLE_RE,
        (table) =>
            `<div class="table-scroll" data-table-scroll>` +
            `<div class="table-scroll__viewport" role="region" tabindex="0" aria-label="${escapeAttr(tableLabel(table))}">${table}</div>` +
            `<p class="table-scroll__hint" aria-hidden="true">Scroll sideways to see all columns &rarr;</p>` +
            `</div>`
    );
}
