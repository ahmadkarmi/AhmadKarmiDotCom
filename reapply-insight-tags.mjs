import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function tryReadText(filePath) {
    try {
        if (!fs.existsSync(filePath)) return null;
        return fs.readFileSync(filePath, 'utf8');
    } catch {
        return null;
    }
}

function parseDotEnv(contents) {
    const out = {};
    const lines = String(contents || '').split(/\r?\n/);
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const idx = line.indexOf('=');
        if (idx === -1) continue;
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        if (!key) continue;
        out[key] = value;
    }
    return out;
}

function loadLocalEnv() {
    const frontendEnvPath = path.join(__dirname, 'frontend', '.env');
    const backendEnvPath = path.join(__dirname, 'backend', '.env');

    const frontendEnv = parseDotEnv(tryReadText(frontendEnvPath));
    const backendEnv = parseDotEnv(tryReadText(backendEnvPath));

    for (const [k, v] of Object.entries({ ...backendEnv, ...frontendEnv })) {
        if (!process.env[k] && typeof v === 'string' && v.length > 0) {
            process.env[k] = v;
        }
    }

    if (!process.env.WP_URL && process.env.PUBLIC_WP_URL) {
        process.env.WP_URL = process.env.PUBLIC_WP_URL;
    }

    if (!process.env.STRAPI_API_TOKEN) {
        const tokenPath = path.join(__dirname, 'backend', 'TOKEN.txt');
        const token = (tryReadText(tokenPath) || '').trim();
        if (token) process.env.STRAPI_API_TOKEN = token;
    }
}

loadLocalEnv();

const WP_URL = process.env.WP_URL || 'https://admin.ahmadkarmi.com';
const WP_USER = process.env.WP_USER || '';
const WP_APP_PASSWORD_RAW = String(process.env.WP_APP_PASSWORD || '');
const STRAPI_URL = process.env.STRAPI_URL || 'http://localhost:1337';
const STRAPI_API_TOKEN = process.env.STRAPI_API_TOKEN || '';

const args = new Set(process.argv.slice(2));
const isYes = args.has('--yes');

if (!WP_USER) {
    throw new Error('Missing required environment variable: WP_USER');
}

const wpPasswordCandidates = Array.from(new Set([
    WP_APP_PASSWORD_RAW,
    WP_APP_PASSWORD_RAW.replace(/\s+/g, ''),
])).filter(Boolean);

function makeWpAuthHeader(password) {
    const token = Buffer.from(`${WP_USER}:${password}`).toString('base64');
    return `Basic ${token}`;
}

function makeWpAuthHeaders(password) {
    const auth = makeWpAuthHeader(password);
    return {
        Authorization: auth,
        'X-Authorization': auth,
        'X-WP-Authorization': auth,
        'X-Basic-Auth': auth,
        'X-Auth': auth,
    };
}

let cachedWpAuthHeaders = null;

async function resolveWpAuthHeaders() {
    if (cachedWpAuthHeaders) return cachedWpAuthHeaders;
    if (wpPasswordCandidates.length === 0) {
        throw new Error('Missing required environment variable: WP_APP_PASSWORD');
    }

    for (const candidate of wpPasswordCandidates) {
        const headers = makeWpAuthHeaders(candidate);
        const res = await fetch(`${WP_URL}/wp-json/wp/v2/users/me`, { headers });
        if (res.ok) {
            cachedWpAuthHeaders = headers;
            return headers;
        }
    }

    throw new Error('WordPress authentication failed: check WP_USER / WP_APP_PASSWORD');
}

function stripWpDuplicateSuffix(slug) {
    return String(slug || '').replace(/-\d+$/, '');
}

async function wpFetch(path, init) {
    const authHeaders = await resolveWpAuthHeaders();
    const response = await fetch(`${WP_URL}${path}`, {
        ...init,
        headers: {
            ...(init?.headers || {}),
            ...authHeaders,
        },
    });
    return response;
}

async function fetchWpInsightType() {
    try {
        const response = await wpFetch('/wp-json/wp/v2/types/insight');
        if (!response.ok) return null;
        return await response.json();
    } catch {
        return null;
    }
}

async function fetchAllWpInsightsLite() {
    const all = [];
    let page = 1;

    while (true) {
        const response = await wpFetch(`/wp-json/wp/v2/insight?per_page=100&page=${page}&_fields=id,slug`);
        if (!response.ok) break;
        const json = await response.json();
        if (!Array.isArray(json) || json.length === 0) break;
        for (const post of json) {
            if (post?.id && post?.slug) all.push({ id: post.id, slug: post.slug });
        }
        page += 1;
    }

    return all;
}

async function fetchStrapiInsightsLite() {
    const all = [];
    let page = 1;

    while (true) {
        const url = new URL(`${STRAPI_URL}/api/insights`);
        url.searchParams.set('populate', '*');
        url.searchParams.set('pagination[pageSize]', '100');
        url.searchParams.set('pagination[page]', String(page));

        const headers = {};
        if (STRAPI_API_TOKEN) headers.Authorization = `Bearer ${STRAPI_API_TOKEN}`;

        const response = await fetch(url.toString(), { headers });
        if (!response.ok) {
            throw new Error(`Failed to fetch insights from Strapi (page ${page}): ${response.status}`);
        }

        const json = await response.json();
        const data = Array.isArray(json?.data) ? json.data : [];
        if (data.length === 0) break;

        for (const entry of data) {
            const attributes = entry?.attributes && typeof entry.attributes === 'object' ? entry.attributes : entry;
            const slug = attributes?.slug;
            const tags = Array.isArray(attributes?.tags) ? attributes.tags : [];

            if (slug) {
                all.push({
                    slug: String(slug),
                    tags: tags.map((t) => String(t || '').trim()).filter(Boolean),
                });
            }
        }

        page += 1;
    }

    return all;
}

function slugifyTag(tag) {
    return String(tag)
        .trim()
        .toLowerCase()
        .replace(/[\u001A']/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
}

async function ensureWPTags(tags) {
    if (!Array.isArray(tags) || tags.length === 0) return [];

    const tagIds = [];

    for (const rawTag of tags) {
        const name = String(rawTag || '').trim();
        if (!name) continue;

        const slug = slugifyTag(name);

        try {
            const searchResponse = await wpFetch(
                `/wp-json/wp/v2/tags?per_page=100&search=${encodeURIComponent(name)}`
            );

            if (searchResponse.ok) {
                const found = await searchResponse.json();
                const exact = Array.isArray(found) ? found.find((t) => t.slug === slug) : null;
                if (exact?.id) {
                    tagIds.push(exact.id);
                    continue;
                }
            }

            const createResponse = await wpFetch('/wp-json/wp/v2/tags', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name, slug }),
            });

            if (createResponse.ok) {
                const created = await createResponse.json();
                if (created?.id) tagIds.push(created.id);
            }
        } catch {
            // Ignore tag failures; continue
        }
    }

    return tagIds;
}

async function updateInsightTags(postId, tagIds) {
    const response = await wpFetch(`/wp-json/wp/v2/insight/${postId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tags: tagIds }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed updating insight ${postId}: ${response.status} ${text.substring(0, 120)}`);
    }

    return await response.json();
}

async function main() {
    const insightType = await fetchWpInsightType();
    const taxonomies = Array.isArray(insightType?.taxonomies) ? insightType.taxonomies : [];
    const supportsTags = taxonomies.includes('post_tag');

    if (!supportsTags) {
        console.error('Insight CPT does not currently support tags (post_tag).');
        console.error('Deploy the MU-plugin to wp-content/mu-plugins/enable-insight-tags.php, then rerun this script.');
        process.exitCode = 1;
        return;
    }

    const [wpInsights, strapiInsights] = await Promise.all([
        fetchAllWpInsightsLite(),
        fetchStrapiInsightsLite(),
    ]);

    const wpByBaseSlug = new Map();
    for (const post of wpInsights) {
        const base = stripWpDuplicateSuffix(post.slug);
        const list = wpByBaseSlug.get(base) || [];
        list.push(post);
        wpByBaseSlug.set(base, list);
    }

    let matched = 0;
    let updated = 0;
    let skippedNoTags = 0;
    let missingWp = 0;

    for (const insight of strapiInsights) {
        if (!insight.tags || insight.tags.length === 0) {
            skippedNoTags += 1;
            continue;
        }

        const tagIds = await ensureWPTags(insight.tags);
        if (tagIds.length === 0) {
            skippedNoTags += 1;
            continue;
        }

        const matches = wpByBaseSlug.get(insight.slug) || [];
        if (matches.length === 0) {
            missingWp += 1;
            continue;
        }

        matched += 1;

        for (const post of matches) {
            if (!isYes) {
                console.log(`[dry-run] Would set tags on WP insight ${post.id} (${post.slug}) -> ${tagIds.join(',')}`);
                continue;
            }

            await updateInsightTags(post.id, tagIds);
            updated += 1;
            console.log(`Updated WP insight ${post.id} (${post.slug})`);
        }
    }

    console.log('---');
    console.log(`WP insights: ${wpInsights.length}`);
    console.log(`Strapi insights: ${strapiInsights.length}`);
    console.log(`Matched slugs: ${matched}`);
    console.log(`Updated posts: ${updated}${isYes ? '' : ' (dry-run)'}`);
    console.log(`Skipped (no tags): ${skippedNoTags}`);
    console.log(`Missing in WP: ${missingWp}`);

    if (!isYes) {
        console.log('---');
        console.log('Run again with --yes to apply updates.');
    }
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
