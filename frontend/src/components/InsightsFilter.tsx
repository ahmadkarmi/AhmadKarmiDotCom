import { useState, useMemo, useEffect } from 'react';
import type { Insight } from '../lib/wordpress';
import { getMediaUrl } from '../lib/wordpress';

interface Props {
    insights: Insight[];
    tags: string[];
}

// Calculate read time (same logic as InsightCard.astro)
function calculateReadTime(text?: string): number {
    if (!text) return 1;
    const wordsPerMinute = 200;
    const words = text.replace(/<[^>]+>/g, '').split(/\s+/).length;
    return Math.max(1, Math.ceil(words / wordsPerMinute));
}

// Format date
function formatDate(dateString?: string): string {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

export default function InsightsFilter({ insights, tags }: Props) {
    const [selectedTag, setSelectedTag] = useState<string | null>(null);

    // Initialize from URL query param
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const tagFromUrl = params.get('tag');
        if (tagFromUrl && tags.includes(tagFromUrl)) {
            setSelectedTag(tagFromUrl);
        }
    }, [tags]);

    // Update URL when tag changes
    const handleTagSelect = (tag: string | null) => {
        setSelectedTag(tag);
        const newUrl = new URL(window.location.href);
        if (tag) {
            newUrl.searchParams.set('tag', tag);
        } else {
            newUrl.searchParams.delete('tag');
        }
        window.history.pushState({}, '', newUrl);
    };

    // Filter insights based on selected tag
    const filteredInsights = useMemo(() => {
        if (!selectedTag) return insights;
        return insights.filter(insight =>
            insight.tags?.includes(selectedTag)
        );
    }, [insights, selectedTag]);

    return (
        <div>
            {/* Filter Buttons */}
            <div className="flex flex-wrap gap-2 mb-12">
                <button
                    onClick={() => handleTagSelect(null)}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${selectedTag === null
                        ? 'bg-accent text-white shadow-sm'
                        : 'bg-background-secondary text-foreground-secondary hover:bg-background-tertiary hover:text-foreground'
                        }`}
                >
                    All
                </button>
                {tags.map(tag => (
                    <button
                        key={tag}
                        onClick={() => handleTagSelect(tag)}
                        className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${selectedTag === tag
                            ? 'bg-accent text-white shadow-sm'
                            : 'bg-background-secondary text-foreground-secondary hover:bg-background-tertiary hover:text-foreground'
                            }`}
                    >
                        {tag}
                    </button>
                ))}
            </div>

            {/* Results Count */}
            <p className="text-sm text-foreground-muted mb-6">
                Showing {filteredInsights.length} {filteredInsights.length === 1 ? 'article' : 'articles'}
                {selectedTag && ` in "${selectedTag}"`}
            </p>

            {/* Insights Grid */}
            {filteredInsights.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {filteredInsights.map((insight, index) => (
                        <InsightCardReact key={insight.id} insight={insight} index={index} />
                    ))}
                </div>
            ) : (
                <div className="text-center py-16">
                    <p className="text-foreground-muted text-lg">
                        No articles found for "{selectedTag}". Try another category!
                    </p>
                    <button
                        onClick={() => setSelectedTag(null)}
                        className="mt-4 text-accent hover:underline"
                    >
                        View all articles
                    </button>
                </div>
            )}
        </div>
    );
}

// React version of InsightCard for use in the filter component
function InsightCardReact({ insight, index }: { insight: Insight; index: number }) {
    const imageUrl = getMediaUrl(insight.mainImage) || getMediaUrl(insight.thumbnailImage);
    const readTime = calculateReadTime(insight.body);

    return (
        <a
            href={`/insights/${insight.slug}`}
            className="group flex flex-col h-full bg-white border border-border rounded-lg shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden hover:-translate-y-1"
            style={{ animationDelay: `${index * 100}ms` }}
        >
            {/* Card Header */}
            <div className="px-4 py-3 flex items-center justify-between border-b border-border/40 bg-background-secondary/5">
                <div className="flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 text-blue-500" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
                    </svg>
                    <span className="text-xs font-mono text-foreground-muted font-medium">
                        INSIGHT-{insight.id || index + 1}
                    </span>
                </div>
                {insight.tags && insight.tags.length > 0 && (
                    <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-[10px] uppercase font-bold tracking-wide">
                        {insight.tags[0]}
                    </span>
                )}
            </div>

            {/* Card Body */}
            <div className="p-4 flex flex-col h-full relative">
                {/* Meta Header */}
                <div className="flex items-center justify-between mb-3 h-6">
                    <div className="flex items-center gap-2">
                        {insight.featured && (
                            <span className="flex items-center gap-1 text-[10px] font-bold text-amber-600 uppercase tracking-wide">
                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                                </svg>
                                Featured
                            </span>
                        )}
                        <span className="text-[10px] text-foreground-muted flex items-center gap-1">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            {readTime} min read
                        </span>
                    </div>
                    <span className="text-[10px] font-mono text-foreground-muted">
                        {formatDate(insight.publishDate)}
                    </span>
                </div>

                {/* Title */}
                <h3 className="font-display font-bold text-lg text-foreground mb-2 leading-tight group-hover:text-accent transition-colors line-clamp-2 min-h-[2.9rem]">
                    {insight.name}
                </h3>

                {/* Thumbnail */}
                <div
                    className="relative w-full aspect-[2/1] rounded-md overflow-hidden border border-border/50 mb-4 bg-background-secondary/20 shadow-inner"
                    style={{ viewTransitionName: `insight-${insight.slug}` }}
                >
                    {imageUrl ? (
                        <img
                            src={imageUrl}
                            alt={insight.name}
                            className="absolute inset-0 w-full h-full object-cover opacity-90 transition-transform duration-700 group-hover:scale-105"
                            loading="lazy"
                        />
                    ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-foreground-muted text-xs">
                            No Preview
                        </div>
                    )}
                </div>

                {/* Description */}
                <div className="mb-4 flex-grow">
                    {insight.description ? (
                        <p className="text-xs text-foreground-secondary line-clamp-2 leading-relaxed">
                            {insight.description}
                        </p>
                    ) : (
                        <p className="text-xs text-foreground-secondary italic">
                            No description available.
                        </p>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between pt-3 border-t border-border/40 mt-auto">
                    <div className="flex items-center gap-2">
                        <img src="/brand/avatar.jpg" alt="Ahmad Al-Karmi" className="w-6 h-6 rounded-full object-cover" />
                        <span className="text-xs text-foreground-secondary font-medium">Ahmad Al-Karmi</span>
                    </div>
                    <div className="text-[10px] font-mono text-foreground-muted">
                        INSIGHT-{insight.id}
                    </div>
                </div>
            </div>
        </a>
    );
}
