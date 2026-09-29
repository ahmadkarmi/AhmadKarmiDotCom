// "Case study plate" share card for a portfolio work: client logo, status,
// kicker, serif project name, one-line brief, byline.

import type { Work } from '../wordpress';
import { getMediaUrl } from '../wordpress';
import { BRAND, Byline, Frame, Headline, Img, Kicker, Pill } from './parts';
import { localImage, remoteImage, toCardText, truncate, type CardImage } from './render';

const STATUS_LABELS: Partial<Record<Work['status'], string>> = {
    completed: 'Completed',
    in_progress: 'In progress',
    concept: 'Concept',
    proposal: 'Proposal',
};

const LOGO_BOX = { width: 220, height: 72 };

interface WorkCardProps {
    title: string;
    client?: string;
    summary?: string;
    status?: string;
    logo: CardImage;
    avatar: CardImage;
}

function titleSize(title: string): number {
    if (title.length <= 28) return 68;
    if (title.length <= 48) return 58;
    return 50;
}

export function WorkCard({ title, client, summary, status, logo, avatar }: WorkCardProps) {
    return (
        <Frame>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: LOGO_BOX.height }}>
                <div style={{ display: 'flex', alignItems: 'center', height: LOGO_BOX.height }}>
                    <Img image={logo} />
                </div>
                {status && <Pill label={status} tone="accent" />}
            </div>

            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    flexGrow: 1,
                    paddingRight: 40,
                }}
            >
                <Kicker parts={['Case study', client ?? '']} />
                <div style={{ display: 'flex', marginTop: 18 }}>
                    <Headline text={title} fontSize={titleSize(title)} maxLines={2} />
                </div>
                {summary && (
                    <div
                        style={{
                            display: 'block',
                            marginTop: 16,
                            fontSize: 24,
                            fontWeight: 500,
                            lineHeight: 1.4,
                            color: BRAND.secondary,
                            lineClamp: 2,
                        }}
                    >
                        {summary}
                    </div>
                )}
            </div>

            <div style={{ display: 'flex' }}>
                <Byline avatar={avatar} />
            </div>
        </Frame>
    );
}

/** First paragraph of WP HTML or markdown that reads like prose. */
function firstParagraph(content?: string): string {
    if (!content) return '';
    const blocks = /<p[\s>]/i.test(content)
        ? Array.from(content.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi), (m) => m[1])
        : content.split(/\n\s*\n/).filter((block) => !/^\s*(#|[-*+] |\d+\.\s)/.test(block));
    for (const block of blocks) {
        const text = toCardText(block);
        if (text.length >= 40) return text;
    }
    return '';
}

/**
 * Gather everything the work card needs. `withRemote: false` skips the client
 * logo fetch, used as the retry when the full card fails to render.
 */
export async function buildWorkCard(work: Work, { withRemote = true } = {}) {
    const [avatar, markFallback, remoteLogo] = await Promise.all([
        localImage('brand/avatar.jpg', { width: 56, height: 56, cover: true }),
        localImage('brand/logo-mark.png', { width: 64, height: 64 }),
        // Same logo the portfolio page shows (explicit ACF logo, else the
        // media-library match from fetchWorks), K mark when absent.
        withRemote ? remoteImage(getMediaUrl(work.clientLogo), LOGO_BOX) : Promise.resolve(undefined),
    ]);

    const client = toCardText(work.client);
    // Same order as the page's meta description (brief, then details), but
    // take the first real paragraph of details so headings like "Overview"
    // don't lead the line. Newer works leave brief and scope empty.
    const summary = toCardText(work.brief) || firstParagraph(work.details) || toCardText(work.scope);

    return (
        <WorkCard
            title={truncate(toCardText(work.name), 80)}
            client={client ? truncate(client, 40) : undefined}
            summary={summary ? truncate(summary, 130) : undefined}
            status={STATUS_LABELS[work.status]}
            logo={remoteLogo ?? markFallback}
            avatar={avatar}
        />
    );
}
