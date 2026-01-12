import process from 'process';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

function loadEnvFile(filePath) {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const lines = raw.split(/\r?\n/);
        for (const line of lines) {
            const trimmed = String(line || '').trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const idx = trimmed.indexOf('=');
            if (idx <= 0) continue;
            const key = trimmed.slice(0, idx).trim();
            const value = trimmed.slice(idx + 1).trim();
            if (!key) continue;
            if (process.env[key] === undefined) process.env[key] = value;
        }
    } catch {
        // ignore
    }
}

function loadDefaultEnv() {
    const filePath = fileURLToPath(import.meta.url);
    const dir = path.dirname(filePath);
    loadEnvFile(path.join(dir, 'frontend', '.env'));
    if (!process.env.WP_URL && process.env.PUBLIC_WP_URL) process.env.WP_URL = process.env.PUBLIC_WP_URL;
}

loadDefaultEnv();

const WP_URL = process.env.WP_URL || 'https://admin.ahmadkarmi.com';
const WP_USER = process.env.WP_USER || '';
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD || '';

const args = process.argv.slice(2);
const confirmed = args.includes('--yes');
const dryRun = args.includes('--dry-run');

if (!confirmed) {
    console.error('Refusing to run without confirmation flag. Re-run with: node sync-external-media-to-wp.mjs --yes');
    process.exit(1);
}

if (!WP_USER || !WP_APP_PASSWORD) {
    throw new Error('Missing required environment variables: WP_USER and/or WP_APP_PASSWORD');
}

const WP_AUTH = Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString('base64');
const WP_HOST = new URL(WP_URL).hostname;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function authHeaders(extra = {}) {
    return {
        Authorization: `Basic ${WP_AUTH}`,
        'X-WP-Authorization': `Basic ${WP_AUTH}`,
        ...extra,
    };
}

async function wpFetchJson(path, options = {}) {
    const response = await fetch(`${WP_URL}${path}`, {
        ...options,
        headers: {
            ...authHeaders({ 'Content-Type': 'application/json' }),
            ...(options.headers || {}),
        },
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`WP ${options.method || 'GET'} ${path} failed: ${response.status} ${text.slice(0, 300)}`);
    }

    return response.json();
}

async function wpFetchJsonPublic(path) {
    const response = await fetch(`${WP_URL}${path}`);
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`WP GET ${path} failed: ${response.status} ${text.slice(0, 300)}`);
    }
    return response.json();
}

function getUrlHost(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return null;
    }
}

function isLikelyImageUrl(url) {
    const u = String(url || '');
    if (!/^https?:\/\//i.test(u)) return false;
    return /\.(png|jpe?g|webp|gif|avif|svg)(\?|#|$)/i.test(u);
}

function isAllowedHost(host) {
    if (!host) return false;
    if (host === WP_HOST) return true;
    if (host === 'www.ahmadkarmi.com') return true;
    return false;
}

function pickFilenameFromUrl(url, contentType) {
    const clean = String(url).split('#')[0].split('?')[0];
    const base = clean.split('/').pop() || 'image';

    const hasExt = /\.[a-z0-9]{2,5}$/i.test(base);
    if (hasExt) return decodeURIComponent(base);

    const extFromType = (() => {
        const ct = String(contentType || '').toLowerCase();
        if (ct.includes('image/jpeg')) return 'jpg';
        if (ct.includes('image/png')) return 'png';
        if (ct.includes('image/webp')) return 'webp';
        if (ct.includes('image/gif')) return 'gif';
        if (ct.includes('image/avif')) return 'avif';
        if (ct.includes('image/svg')) return 'svg';
        return 'bin';
    })();

    return `${decodeURIComponent(base)}.${extFromType}`;
}

async function searchMediaByFilename(filename) {
    const withoutExt = String(filename).replace(/\.[^.]+$/, '');
    const results = await wpFetchJsonPublic(`/wp-json/wp/v2/media?per_page=100&search=${encodeURIComponent(withoutExt)}&_fields=id,source_url`);
    if (!Array.isArray(results)) return null;

    const exact = results.find((m) => {
        const src = String(m?.source_url || '');
        return src.toLowerCase().endsWith(`/${String(filename).toLowerCase()}`);
    });

    if (exact?.id && exact?.source_url) return { id: exact.id, source_url: exact.source_url };

    const first = results.find((m) => m?.id && m?.source_url);
    if (first?.id && first?.source_url) return { id: first.id, source_url: first.source_url };

    return null;
}

async function uploadExternalUrlToWp(url) {
    const response = await fetch(url);
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Download failed ${response.status}: ${text.slice(0, 200)}`);
    }

    const contentType = response.headers.get('content-type') || '';
    const buf = Buffer.from(await response.arrayBuffer());
    const filename = pickFilenameFromUrl(url, contentType);

    const existing = await searchMediaByFilename(filename);
    if (existing) return { ...existing, filename, reused: true };

    if (dryRun) {
        return { id: -1, source_url: url, filename, reused: false };
    }

    const uploadRes = await fetch(`${WP_URL}/wp-json/wp/v2/media`, {
        method: 'POST',
        headers: authHeaders({
            'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
            'Content-Type': contentType || 'application/octet-stream',
        }),
        body: buf,
    });

    if (!uploadRes.ok) {
        const text = await uploadRes.text().catch(() => '');
        throw new Error(`Upload failed ${uploadRes.status}: ${text.slice(0, 300)}`);
    }

    const media = await uploadRes.json();
    return { id: media.id, source_url: media.source_url, filename, reused: false };
}

function extractUrlsFromHtml(html) {
    const out = new Set();
    const value = String(html || '');
    const regex = /\bsrc\s*=\s*(["'])(https?:\/\/[^"']+)\1/gi;
    let match;
    while ((match = regex.exec(value))) {
        out.add(match[2]);
    }
    return Array.from(out);
}

function extractUrlsFromText(value) {
    const out = new Set();
    const text = String(value || '');
    const regex = /(https?:\/\/[^\s"'<>]+\.(?:png|jpe?g|webp|gif|avif|svg))(\?[^\s"'<>]*)?/gi;
    let match;
    while ((match = regex.exec(text))) {
        out.add(match[1] + (match[2] || ''));
    }
    return Array.from(out);
}

function getMediaUrlFromAcfValue(value) {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return null;
    if (typeof value === 'object') {
        return value.source_url || value.url || value.src || null;
    }
    return null;
}

function replaceAllExternalUrls(value, urlMap) {
    let out = String(value || '');
    for (const [from, to] of urlMap.entries()) {
        if (!from || !to) continue;
        out = out.split(from).join(to);
    }
    return out;
}

async function fetchAllPosts(postType) {
    const all = [];
    let page = 1;

    while (true) {
        try {
            const results = await wpFetchJson(`/wp-json/wp/v2/${postType}?per_page=100&page=${page}&_fields=id,slug,acf,content`, {
                method: 'GET',
            });

            if (!Array.isArray(results) || results.length === 0) break;
            all.push(...results);
            page += 1;
            await sleep(200);
        } catch (e) {
            const message = String(e?.message || '');
            if (message.includes('rest_post_invalid_page_number')) break;
            break;
        }
    }

    return all;
}

async function updatePost(postType, id, payload) {
    if (dryRun) return null;
    return wpFetchJson(`/wp-json/wp/v2/${postType}/${id}`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

async function syncPost(postType, post, mediaMap) {
    const id = post?.id;
    const slug = post?.slug;
    const acf = post?.acf || {};
    const contentHtml = post?.content?.rendered || '';

    const candidateUrls = new Set();

    const mediaFields = postType === 'work'
        ? ['mainImage', 'coverImage', 'clientLogo', 'gallery']
        : ['mainImage', 'thumbnailImage'];

    for (const field of mediaFields) {
        const value = acf[field];
        if (Array.isArray(value)) {
            for (const item of value) {
                const u = getMediaUrlFromAcfValue(item);
                if (u) candidateUrls.add(u);
            }
        } else {
            const u = getMediaUrlFromAcfValue(value);
            if (u) candidateUrls.add(u);
        }
    }

    for (const url of extractUrlsFromHtml(contentHtml)) candidateUrls.add(url);

    for (const field of ['brief', 'scope', 'details', 'body', 'description']) {
        const value = acf[field];
        if (typeof value === 'string') {
            for (const url of extractUrlsFromText(value)) candidateUrls.add(url);
        }
    }

    const externalUrls = Array.from(candidateUrls)
        .map((u) => String(u))
        .filter((u) => isLikelyImageUrl(u))
        .filter((u) => !isAllowedHost(getUrlHost(u)));

    if (externalUrls.length === 0) return;

    console.log(`\n→ ${postType} ${id} (${slug}): found ${externalUrls.length} external image url(s)`);

    for (const url of externalUrls) {
        if (!mediaMap.has(url)) {
            console.log(`  downloading/uploading: ${url}`);
            const media = await uploadExternalUrlToWp(url);
            if (!media?.id || !media?.source_url) {
                console.log('  ✗ failed to get media result');
                continue;
            }
            mediaMap.set(url, media);
            await sleep(200);
        }
    }

    const urlReplacement = new Map();
    for (const [from, media] of mediaMap.entries()) {
        if (externalUrls.includes(from) && media?.source_url && media.id !== -1) {
            urlReplacement.set(from, media.source_url);
        }
    }

    const acfUpdates = {};

    for (const field of mediaFields) {
        const value = acf[field];
        if (Array.isArray(value)) {
            const next = value.map((item) => {
                if (typeof item === 'number') return item;
                const u = getMediaUrlFromAcfValue(item);
                if (!u) return item;
                const media = mediaMap.get(u);
                return media?.id && media.id !== -1 ? media.id : item;
            });
            const changed = JSON.stringify(next) !== JSON.stringify(value);
            if (changed) acfUpdates[field] = next;
        } else if (typeof value === 'string') {
            const media = mediaMap.get(value);
            if (media?.id && media.id !== -1) acfUpdates[field] = media.id;
        } else if (value && typeof value === 'object') {
            const u = getMediaUrlFromAcfValue(value);
            if (u) {
                const media = mediaMap.get(u);
                if (media?.id && media.id !== -1) acfUpdates[field] = media.id;
            }
        }
    }

    for (const field of ['brief', 'scope', 'details', 'body', 'description']) {
        const value = acf[field];
        if (typeof value !== 'string') continue;
        const updated = replaceAllExternalUrls(value, urlReplacement);
        if (updated !== value) acfUpdates[field] = updated;
    }

    const updatedContent = replaceAllExternalUrls(contentHtml, urlReplacement);

    const payload = {};
    if (Object.keys(acfUpdates).length > 0) payload.acf = acfUpdates;
    if (updatedContent !== contentHtml) payload.content = updatedContent;

    const keys = Object.keys(payload);
    if (keys.length === 0) {
        console.log('  ✓ nothing to update after upload');
        return;
    }

    console.log(`  updating: ${keys.join(', ')}`);
    await updatePost(postType, id, payload);
    await sleep(250);
}

async function main() {
    console.log('🚀 Sync external media URLs to WordPress');
    console.log(`   WP: ${WP_URL}`);
    console.log(`   dryRun: ${dryRun ? 'yes' : 'no'}`);

    const mediaMap = new Map();

    const works = await fetchAllPosts('work');
    const insights = await fetchAllPosts('insight');

    console.log(`Found ${works.length} works`);
    console.log(`Found ${insights.length} insights`);

    for (const work of works) {
        await syncPost('work', work, mediaMap);
    }

    for (const insight of insights) {
        await syncPost('insight', insight, mediaMap);
    }

    console.log('\n✅ Done');
}

main().catch((e) => {
    console.error(`\n❌ Failed: ${String(e?.message || e)}`);
    process.exit(1);
});
