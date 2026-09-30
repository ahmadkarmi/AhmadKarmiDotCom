// Shapes shared by the /search-index.json endpoint that builds the index and
// the search modal script (components/Search.astro) that reads it.

export type SearchIndexItemType = 'insight' | 'portfolio' | 'page';

export type SearchIndexItem = {
    id: string;
    type: SearchIndexItemType;
    title: string;
    url: string;
    description?: string;
    image?: string;
    imageAlt?: string;
    tags?: string[];
    publishDate?: string;
    readTime?: number;
    client?: string;
    clientLogo?: string;
    status?: string;
    featured?: boolean;
    text: string;
};

/** An index item with its fields pre-normalised for matching. */
export type IndexedSearchItem = SearchIndexItem & {
    __title: string;
    __description: string;
    __tags: string;
    __meta: string;
    __text: string;
};

/** Modal state, kept on `window` so it survives Astro client navigations. */
export type SearchModalState = {
    indexLoaded: boolean;
    items: IndexedSearchItem[];
    queryTokens: string[];
    activeIndex: number;
    results: IndexedSearchItem[];
    searchTimeout: ReturnType<typeof setTimeout> | undefined;
};
