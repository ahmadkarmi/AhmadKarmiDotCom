import TurndownService from 'turndown';

// Create a configured Turndown instance
const turndown = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
});

// Custom rule to handle empty paragraphs
turndown.addRule('emptyParagraphs', {
    filter: (node) => {
        return node.nodeName === 'P' && !node.textContent?.trim();
    },
    replacement: () => '',
});

// Custom rule to clean up Webflow-specific attributes in links
turndown.addRule('cleanLinks', {
    filter: 'a',
    replacement: (content, node) => {
        const element = node as HTMLAnchorElement;
        const href = element.getAttribute('href');
        if (!href || !content.trim()) return content;
        return `[${content}](${href})`;
    },
});

// Custom rule to handle blockquotes
turndown.addRule('blockquotes', {
    filter: 'blockquote',
    replacement: (content) => {
        const lines = content.trim().split('\n');
        return lines.map((line) => `> ${line}`).join('\n') + '\n\n';
    },
});

// Custom rule to handle figures with images
turndown.addRule('figures', {
    filter: 'figure',
    replacement: (_content, node) => {
        const element = node as HTMLElement;
        const img = element.querySelector('img');
        const figcaption = element.querySelector('figcaption');

        if (!img) return '';

        const src = img.getAttribute('src') || '';
        const alt = img.getAttribute('alt') || figcaption?.textContent || '';

        let markdown = `![${alt}](${src})`;
        if (figcaption?.textContent) {
            markdown += `\n*${figcaption.textContent}*`;
        }
        return markdown + '\n\n';
    },
});

// Custom rule to handle iframe embeds (videos)
turndown.addRule('iframes', {
    filter: 'iframe',
    replacement: (_content, node) => {
        const element = node as HTMLIFrameElement;
        const src = element.getAttribute('src') || '';

        // Check if it's a YouTube embed
        if (src.includes('youtube.com/embed/')) {
            // Return the raw outerHTML to preserve the iframe
            return `\n${element.outerHTML}\n\n`;
        }

        return `\n[Embedded content](${src})\n\n`;
    },
});

/**
 * Convert HTML to Markdown, cleaning up Webflow-specific markup
 */
export function htmlToMarkdown(html: string): string {
    if (!html) return '';

    // Pre-process: Clean up Webflow-specific attributes and empty IDs
    let cleanHtml = html
        // Remove empty id attributes like id=""""
        .replace(/\s+id="+""/g, '')
        .replace(/\s+id=""/g, '')
        // Remove data-rt-* attributes
        .replace(/\s+data-rt-[a-z-]+="[^"]*"/g, '')
        // Remove data-page-url attributes
        .replace(/\s+data-page-url="[^"]*"/g, '')
        // Clean up w-richtext classes
        .replace(/\s+class="w-richtext[^"]*"/g, '')
        // Clean up style attributes
        .replace(/\s+style="[^"]*"/g, '')
        // Remove loading="auto" attributes
        .replace(/\s+loading="[^"]*"/g, '');

    // Convert to Markdown
    let markdown = turndown.turndown(cleanHtml);

    // Post-process: Clean up extra whitespace
    markdown = markdown
        // Remove multiple consecutive blank lines
        .replace(/\n{3,}/g, '\n\n')
        // Remove trailing whitespace on lines
        .replace(/[ \t]+$/gm, '')
        // Ensure single newline at end
        .trim() + '\n';

    return markdown;
}

/**
 * Extract plain text from HTML (for descriptions)
 */
export function htmlToPlainText(html: string): string {
    if (!html) return '';

    // Simple regex-based HTML stripping for short content
    return html
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
