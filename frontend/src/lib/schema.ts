// Shared schema.org JSON-LD builders.
//
// The Person entity is defined exactly once here and referenced elsewhere by
// `@id` (PERSON_ID). That single-source-of-truth approach lets search engines
// and AI crawlers resolve every mention of Ahmad (homepage, about page, every
// article byline) back to one consistent, trusted entity.
//
// Pages pass the result of `graph(...)` to BaseLayout's `schema` prop, which
// renders it as a single <script type="application/ld+json"> block.

export const SITE_URL = import.meta.env.PUBLIC_SITE_URL || 'https://www.ahmadkarmi.com';
export const PERSON_ID = `${SITE_URL}#person`;
export const WEBSITE_ID = `${SITE_URL}#website`;

type SchemaNode = Record<string, any>;

/**
 * Canonical Person entity: the single source of truth for Ahmad as an entity.
 * Every other page references this by `@id` (PERSON_ID) instead of redefining it.
 */
export function personNode(opts: { linkedinUrl?: string } = {}): SchemaNode {
  return {
    '@type': 'Person',
    '@id': PERSON_ID,
    name: 'Ahmad Al-Karmi',
    givenName: 'Ahmad',
    familyName: 'Al-Karmi',
    // "Karmi" and "Ahmad Karmi" are the forms people actually search and the
    // domain itself. Declaring them helps engines unify the entity.
    alternateName: ['Karmi', 'Ahmad Karmi'],
    url: SITE_URL,
    image: `${SITE_URL}/brand/avatar.jpg`,
    jobTitle: 'Senior Product Manager for Loyalty and Growth Products',
    worksFor: {
      '@type': 'Organization',
      name: 'Al Jazeera Media Network',
      url: 'https://www.aljazeera.com',
    },
    alumniOf: [
      { '@type': 'EducationalOrganization', name: 'Boston University', url: 'https://www.bu.edu' },
      { '@type': 'EducationalOrganization', name: 'American University of Kuwait', url: 'https://www.auk.edu.kw' },
    ],
    knowsAbout: [
      'AI Product Management',
      'Product Management',
      'Loyalty and Growth',
      'AI-augmented product development',
      'Digital Transformation',
      'Bilingual product strategy',
    ],
    knowsLanguage: ['en', 'ar'],
    nationality: { '@type': 'Country', name: 'Canada' },
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Kuwait City',
      addressCountry: 'KW',
    },
    description:
      'Senior Product Manager for Loyalty and Growth Products at Al Jazeera Media Network. AI-focused. Over 16 years shipping digital products from enterprise through consumer.',
    email: 'alkarmi.ahmad@gmail.com',
    sameAs: [
      opts.linkedinUrl || 'https://www.linkedin.com/in/akarmi',
      'https://www.threads.com/@karmi.csd',
    ].filter(Boolean),
  };
}

/** WebSite entity. Names the Person as publisher via `@id`. */
export function websiteNode(): SchemaNode {
  return {
    '@type': 'WebSite',
    '@id': WEBSITE_ID,
    name: 'Ahmad Al-Karmi',
    url: SITE_URL,
    inLanguage: 'en',
    publisher: { '@id': PERSON_ID },
  };
}

/** BreadcrumbList from an ordered list of crumbs. Relative URLs are absolutized. */
export function breadcrumbNode(items: { name: string; url: string }[]): SchemaNode {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url.startsWith('http') ? item.url : `${SITE_URL}${item.url}`,
    })),
  };
}

/** Wrap one or more nodes into a single `@graph` JSON-LD document. */
export function graph(...nodes: (SchemaNode | null | undefined)[]): SchemaNode {
  return {
    '@context': 'https://schema.org',
    '@graph': nodes.filter(Boolean),
  };
}
