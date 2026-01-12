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

const args = process.argv.slice(2);
const confirmed = args.includes('--yes');
const dryRun = args.includes('--dry-run');

function readArgValue(prefix) {
    const hit = args.find((a) => a.startsWith(`${prefix}=`));
    return hit ? hit.slice(prefix.length + 1) : null;
}

const postType = readArgValue('--type') || 'work';
const targetSlug = readArgValue('--slug');
const titleContains = (readArgValue('--title-contains') || 'story').toLowerCase();

if (!confirmed) {
    console.error('Refusing to run without confirmation flag. Re-run with: node cleanup-wp-css-leaks.mjs --yes [--dry-run]');
    process.exit(1);
}

const WP_URL = process.env.WP_URL || 'https://admin.ahmadkarmi.com';
const WP_USER = process.env.WP_USER || '';
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD || '';

if (!WP_USER || !WP_APP_PASSWORD) {
    throw new Error('Missing required environment variables: WP_USER and/or WP_APP_PASSWORD');
}

const WP_AUTH = Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString('base64');

function authHeaders(extra = {}) {
    return {
        Authorization: `Basic ${WP_AUTH}`,
        'X-WP-Authorization': `Basic ${WP_AUTH}`,
        ...extra,
    };
}

async function wpFetchJson(pathname, options = {}) {
    const response = await fetch(`${WP_URL}${pathname}`, {
        ...options,
        headers: {
            ...authHeaders({ 'Content-Type': 'application/json' }),
            ...(options.headers || {}),
        },
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`WP ${options.method || 'GET'} ${pathname} failed: ${response.status} ${text.slice(0, 400)}`);
    }

    return response.json();
}

function stripModernBtnCss(input) {
    if (typeof input !== 'string') return input;
    if (!input.includes('.modern-btn') && !input.includes('Visit Button')) return input;

    let out = input;

    out = out.replace(/\bVisit Button\b\s*(?=\.modern-btn\b)/gi, '');
    out = out.replace(/\.modern-btn[^\{]*\{[\s\S]*?\}\s*/gi, '');

    // Common case where CSS gets pasted inline as one long line.
    out = out.replace(/\s{2,}/g, ' ');

    return out.trim();
}

function patchObjectStrings(obj, patchFn) {
    if (obj === null || obj === undefined) return { next: obj, changed: false };
    if (typeof obj === 'string') {
        const next = patchFn(obj);
        return { next, changed: next !== obj };
    }
    if (Array.isArray(obj)) {
        let changed = false;
        const next = obj.map((v) => {
            const res = patchObjectStrings(v, patchFn);
            if (res.changed) changed = true;
            return res.next;
        });
        return { next, changed };
    }
    if (typeof obj === 'object') {
        let changed = false;
        const next = {};
        for (const [k, v] of Object.entries(obj)) {
            const res = patchObjectStrings(v, patchFn);
            if (res.changed) changed = true;
            next[k] = res.next;
        }
        return { next, changed };
    }

    return { next: obj, changed: false };
}

async function fetchAllPosts() {
    const all = [];
    let page = 1;

    while (true) {
        try {
            const results = await wpFetchJson(`/wp-json/wp/v2/${postType}?per_page=100&page=${page}&_fields=id,slug,title,acf,content`, {
                method: 'GET',
            });
            if (!Array.isArray(results) || results.length === 0) break;
            all.push(...results);
            page += 1;
        } catch (e) {
            const message = String(e?.message || '');
            if (message.includes('rest_post_invalid_page_number')) break;
            throw e;
        }
    }

    return all;
}

async function updatePost(id, payload) {
    if (dryRun) return null;
    return wpFetchJson(`/wp-json/wp/v2/${postType}/${id}`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

console.log('🧹 Cleanup WP CSS leaks');
console.log(`   WP: ${WP_URL}`);
console.log(`   type: ${postType}`);
console.log(`   dryRun: ${dryRun ? 'yes' : 'no'}`);
console.log(`   target: ${targetSlug ? `slug=${targetSlug}` : `title contains '${titleContains}'`}`);

const posts = await fetchAllPosts();
console.log(`Found ${posts.length} ${postType}(s)`);

const candidates = posts.filter((p) => {
    if (targetSlug) return String(p?.slug || '') === targetSlug;
    const title = String(p?.title?.rendered || '').toLowerCase();
    return title.includes(titleContains);
});

if (candidates.length === 0) {
    console.log('No matching posts found.');
    process.exit(0);
}

if (!targetSlug && candidates.length > 1) {
    console.log('Multiple candidates found; pass --slug=... to target exactly one:');
    for (const p of candidates) {
        console.log(`- id ${p.id} slug ${p.slug} title ${(p?.title?.rendered || '').replace(/<[^>]+>/g, '')}`);
    }
    process.exit(0);
}

const post = candidates[0];
const id = post.id;

const originalAcf = post.acf || {};
const originalContent = post?.content?.rendered || '';

const acfPatched = patchObjectStrings(originalAcf, stripModernBtnCss);
const contentPatched = typeof originalContent === 'string'
    ? { next: stripModernBtnCss(originalContent), changed: stripModernBtnCss(originalContent) !== originalContent }
    : { next: originalContent, changed: false };

if (!acfPatched.changed && !contentPatched.changed) {
    console.log(`No CSS leak detected for id ${id} (${post.slug}).`);
    process.exit(0);
}

console.log(`Will update id ${id} (${post.slug})`);
console.log(`- acf changed: ${acfPatched.changed ? 'yes' : 'no'}`);
console.log(`- content changed: ${contentPatched.changed ? 'yes' : 'no'}`);

if (dryRun) {
    console.log('Dry run only; no updates performed.');
    process.exit(0);
}

await updatePost(id, {
    acf: acfPatched.next,
    content: contentPatched.changed ? contentPatched.next : undefined,
});

console.log('✅ Updated.');
