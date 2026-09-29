// "Editorial cover" share card for an insight: kicker, serif title, primary
// tag, byline. Purely typographic, so it reads at thumbnail size whatever the
// post's hero image looks like.

import type { Insight } from '../wordpress';
import { calculateReadTime } from '../insightCard';
import { BRAND, Byline, Frame, Headline, Img, Kicker, Pill } from './parts';
import { localImage, monthYear, toCardText, truncate, type CardImage } from './render';

interface InsightCardProps {
    title: string;
    kicker: string[];
    tag?: string;
    avatar: CardImage;
    mark: CardImage;
}

function titleSize(title: string): number {
    if (title.length <= 36) return 76;
    if (title.length <= 60) return 64;
    return 54;
}

export function InsightCard({ title, kicker, tag, avatar, mark }: InsightCardProps) {
    return (
        <Frame>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Kicker parts={kicker} />
                <Img image={mark} />
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
                <Headline text={title} fontSize={titleSize(title)} maxLines={3} />
                {tag && (
                    <div style={{ display: 'flex', marginTop: 28 }}>
                        <Pill label={tag} />
                    </div>
                )}
            </div>

            <div style={{ display: 'flex', color: BRAND.ink }}>
                <Byline avatar={avatar} />
            </div>
        </Frame>
    );
}

/** Gather everything the insight card needs from the resolved Insight. */
export async function buildInsightCard(insight: Insight) {
    const [avatar, mark] = await Promise.all([
        localImage('brand/avatar.jpg', { width: 56, height: 56, cover: true }),
        localImage('brand/logo-mark.png', { width: 44, height: 44 }),
    ]);

    const readTime = calculateReadTime(insight.body);
    const tag = toCardText(insight.tags?.[0]);

    return (
        <InsightCard
            title={truncate(toCardText(insight.name), 110)}
            kicker={['Insight', `${readTime} min read`, monthYear(insight.publishDate)]}
            tag={tag ? truncate(tag, 32) : undefined}
            avatar={avatar}
            mark={mark}
        />
    );
}
