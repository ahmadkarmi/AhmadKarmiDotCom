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
const isDebugWpAuth = args.has('--debug-wp-auth');

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
        const res = await fetch(`${WP_URL}/wp-json/wp/v2/users/me`, {
            headers,
        });

        if (res.ok) {
            cachedWpAuthHeaders = headers;
            return headers;
        }
    }

    cachedWpAuthHeaders = makeWpAuthHeaders(wpPasswordCandidates[0]);
    return cachedWpAuthHeaders;
}

async function debugWpAuth() {
    console.log('WP auth candidates:', wpPasswordCandidates.map((p) => ({ length: String(p).length, spaced: /\s/.test(p) })));

    for (const candidate of wpPasswordCandidates) {
        const headers = makeWpAuthHeaders(candidate);
        const meView = await fetch(`${WP_URL}/wp-json/wp/v2/users/me`, { headers });
        const meViewText = await meView.text();
        console.log('WP /users/me status:', meView.status);
        console.log(meViewText.slice(0, 600));

        const meEdit = await fetch(`${WP_URL}/wp-json/wp/v2/users/me?context=edit`, { headers });
        const meEditText = await meEdit.text();
        console.log('WP /users/me?context=edit status:', meEdit.status);
        console.log(meEditText.slice(0, 600));
    }

    const headers = await resolveWpAuthHeaders();

    const sampleId = Number(process.env.DEBUG_WORK_ID || 345);
    const work = await fetch(`${WP_URL}/wp-json/wp/v2/work/${sampleId}?context=edit`, { headers });
    const workText = await work.text();
    console.log(`WP /work/${sampleId}?context=edit status:`, work.status);
    console.log(workText.slice(0, 1200));
}

function stripWpDuplicateSuffix(slug) {
    return String(slug || '').replace(/-\d+$/, '');
}

function normalizeStrapiMediaNode(node) {
    if (!node) return null;
    if (node.attributes && typeof node.attributes === 'object') {
        return { id: node.id, ...node.attributes };
    }
    return node;
}

function normalizeStrapiMedia(value) {
    if (!value) return null;

    if (Array.isArray(value)) {
        return value.map(normalizeStrapiMediaNode).filter(Boolean);
    }

    if (Object.prototype.hasOwnProperty.call(value, 'data')) {
        const data = value.data;
        if (!data) return null;
        if (Array.isArray(data)) {
            return data.map(normalizeStrapiMediaNode).filter(Boolean);
        }
        return normalizeStrapiMediaNode(data);
    }

    return normalizeStrapiMediaNode(value);
}

function normalizeStrapiEntry(entry) {
    if (!entry) return entry;
    const normalized = entry.attributes && typeof entry.attributes === 'object'
        ? { id: entry.id, documentId: entry.documentId, ...entry.attributes }
        : entry;

    for (const key of ['coverImage']) {
        if (Object.prototype.hasOwnProperty.call(normalized, key)) {
            normalized[key] = normalizeStrapiMedia(normalized[key]);
        }
    }

    if (Object.prototype.hasOwnProperty.call(normalized, 'gallery')) {
        const gallery = normalizeStrapiMedia(normalized.gallery);
        normalized.gallery = Array.isArray(gallery) ? gallery : [];
    }

    return normalized;
}

async function fetchFromStrapi(endpoint) {
    const url = `${STRAPI_URL}/api/${endpoint}?populate=*`;
    const headers = STRAPI_API_TOKEN ? { Authorization: `Bearer ${STRAPI_API_TOKEN}` } : undefined;

    const response = await fetch(url, { headers });
    if (!response.ok) {
        throw new Error(`Failed to fetch ${endpoint} from Strapi: ${response.status}`);
    }

    const json = await response.json();
    const data = Array.isArray(json?.data) ? json.data : [];
    return data.map(normalizeStrapiEntry);
}

async function fetchWPMedia(authHeaders) {
    const allMedia = [];
    let page = 1;

    while (true) {
        const response = await fetch(`${WP_URL}/wp-json/wp/v2/media?per_page=100&page=${page}`, {
            headers: authHeaders,
        });

        if (!response.ok) break;

        const media = await response.json();
        if (!Array.isArray(media) || media.length === 0) break;

        allMedia.push(...media);
        page += 1;
    }

    return allMedia;
}

function findMatchingImage(strapiImage, wpMedia) {
    if (!strapiImage?.url) return null;
    const strapiFilename = strapiImage.url.split('/').pop().toLowerCase();

    for (const media of wpMedia) {
        const wpFilename = String(media?.source_url || '').split('/').pop().toLowerCase();
        if (!wpFilename) continue;

        if (wpFilename === strapiFilename) {
            return media.id;
        }

        if (
            wpFilename.includes(strapiFilename.replace(/\.[^.]+$/, '')) ||
            strapiFilename.includes(wpFilename.replace(/\.[^.]+$/, ''))
        ) {
            return media.id;
        }
    }

    return null;
}

async function fetchAllWpWorksLite(authHeaders) {
    const all = [];
    let page = 1;

    while (true) {
        const response = await fetch(`${WP_URL}/wp-json/wp/v2/work?per_page=100&page=${page}&_fields=id,slug`, {
            headers: authHeaders,
        });

        if (!response.ok) break;

        const json = await response.json();
        if (!Array.isArray(json) || json.length === 0) break;

        for (const item of json) {
            if (item?.id && item?.slug) all.push({ id: item.id, slug: item.slug });
        }

        page += 1;
    }

    return all;
}

async function updateWorkAcf(authHeaders, postId, acf) {
    const response = await fetch(`${WP_URL}/wp-json/wp/v2/work/${postId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...authHeaders,
        },
        body: JSON.stringify({ acf }),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Failed updating work ${postId}: ${response.status} ${text.substring(0, 150)}`);
    }

    return response.json();
}

async function main() {
    if (isDebugWpAuth) {
        await debugWpAuth();
        return;
    }

    const authHeaders = await resolveWpAuthHeaders();

    const [wpMedia, wpWorks, strapiWorks] = await Promise.all([
        fetchWPMedia(authHeaders),
        fetchAllWpWorksLite(authHeaders),
        fetchFromStrapi('works'),
    ]);

    const wpByBaseSlug = new Map();
    for (const post of wpWorks) {
        const base = stripWpDuplicateSuffix(post.slug);
        const list = wpByBaseSlug.get(base) || [];
        list.push(post);
        wpByBaseSlug.set(base, list);
    }

    let matched = 0;
    let updated = 0;
    let missingWp = 0;

    for (const work of strapiWorks) {
        const slug = work?.slug;
        if (!slug) continue;

        const coverImageId = findMatchingImage(work.coverImage, wpMedia);
        const galleryIds = Array.isArray(work.gallery)
            ? work.gallery.map((img) => findMatchingImage(img, wpMedia)).filter(Boolean)
            : [];

        const updates = {};
        if (coverImageId) updates.coverImage = coverImageId;
        if (galleryIds.length > 0) updates.gallery = galleryIds;

        const updateKeys = Object.keys(updates);
        if (updateKeys.length === 0) continue;

        const matches = wpByBaseSlug.get(slug) || [];
        if (matches.length === 0) {
            missingWp += 1;
            continue;
        }

        matched += 1;

        for (const post of matches) {
            if (!isYes) {
                console.log(`[dry-run] Would update WP work ${post.id} (${post.slug}) fields: ${updateKeys.join(', ')}`);
                continue;
            }

            await updateWorkAcf(authHeaders, post.id, updates);
            updated += 1;
            console.log(`Updated WP work ${post.id} (${post.slug}) fields: ${updateKeys.join(', ')}`);
        }
    }

    console.log('---');
    console.log(`WP works: ${wpWorks.length}`);
    console.log(`Strapi works: ${strapiWorks.length}`);
    console.log(`Matched slugs: ${matched}`);
    console.log(`Updated posts: ${updated}${isYes ? '' : ' (dry-run)'}`);
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
