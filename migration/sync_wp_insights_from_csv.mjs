import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = new Set(process.argv.slice(2));
const isYes = args.has('--yes');
const isDryRun = args.has('--dry-run');

if (!isYes) {
    console.error('Refusing to run without confirmation flag. Re-run with: node sync_wp_insights_from_csv.mjs --yes');
    console.error('Optional: add --dry-run to preview changes without writing.');
    process.exit(1);
}

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
    const root = path.resolve(__dirname, '..');
    const frontendEnvPath = path.join(root, 'frontend', '.env');
    const backendEnvPath = path.join(root, 'backend', '.env');

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
}

loadLocalEnv();

const WP_URL = process.env.WP_URL || 'https://admin.ahmadkarmi.com';
const WP_USER = process.env.WP_USER || '';
const WP_APP_PASSWORD_RAW = String(process.env.WP_APP_PASSWORD || '');

if (!WP_USER) {
    throw new Error('Missing required environment variable: WP_USER');
}

const wpPasswordCandidates = Array.from(new Set([
    WP_APP_PASSWORD_RAW,
    WP_APP_PASSWORD_RAW.replace(/\s+/g, ''),
])).filter(Boolean);

function makeWpAuthHeaders(password) {
    const token = Buffer.from(`${WP_USER}:${password}`).toString('base64');
    const auth = `Basic ${token}`;
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

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripWpDuplicateSuffix(slug) {
    const value = String(slug || '').trim();
    const match = value.match(/^(.*)-(\d{1,2})$/);
    if (!match) return value;
    const n = Number(match[2]);
    if (!Number.isFinite(n) || n < 2 || n > 99) return value;
    return match[1];
}

function parseCsvDateToIso(dateString) {
    if (!dateString) return null;
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return null;

    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function buildIsoDateTime(dateYmd, secondsFromStartOfDay) {
    const total = Math.max(0, Math.min(86399, Number(secondsFromStartOfDay) || 0));
    const hh = String(Math.floor(total / 3600)).padStart(2, '0');
    const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    return `${dateYmd}T${hh}:${mm}:${ss}Z`;
}

function normalizeWpGmt(dateGmt) {
    const value = String(dateGmt || '').trim();
    if (!value) return '';
    return value.endsWith('Z') ? value : `${value}Z`;
}

async function fetchLiveSlugOrder() {
    try {
        const res = await fetch('https://www.ahmadkarmi.com/news-insights/articles');
        if (!res.ok) return [];
        const html = await res.text();
        const matches = Array.from(html.matchAll(/\/articles-insights\/([a-z0-9-]+)/g));
        const slugs = matches.map((m) => m[1]).filter(Boolean);
        return Array.from(new Set(slugs));
    } catch {
        return [];
    }
}

function slugifyTag(tag) {
    return String(tag)
        .trim()
        .toLowerCase()
        .replace(/[\u001A']/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
}

async function wpFetch(pathname, init) {
    const authHeaders = await resolveWpAuthHeaders();
    const response = await fetch(`${WP_URL}${pathname}`, {
        ...init,
        headers: {
            ...(init?.headers || {}),
            ...authHeaders,
        },
    });
    return response;
}

async function wpFetchJson(pathname, init) {
    const res = await wpFetch(pathname, init);
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`WP ${init?.method || 'GET'} ${pathname} failed: ${res.status} ${text.slice(0, 200)}`);
    }
    return res.json();
}

async function ensureWpTags(tagNames) {
    if (!Array.isArray(tagNames) || tagNames.length === 0) return [];

    const ids = [];
    const seen = new Set();

    for (const raw of tagNames) {
        const name = String(raw || '').trim();
        if (!name) continue;
        const slug = slugifyTag(name);
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);

        const search = await wpFetch(`/wp-json/wp/v2/tags?per_page=100&search=${encodeURIComponent(name)}`);
        if (search.ok) {
            const found = await search.json().catch(() => []);
            const exact = Array.isArray(found) ? found.find((t) => t?.slug === slug) : null;
            if (exact?.id) {
                ids.push(exact.id);
                continue;
            }
        }

        if (isDryRun) {
            console.log(`[dry-run] would create tag: ${name} (${slug})`);
        } else {
            const created = await wpFetch('/wp-json/wp/v2/tags', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, slug }),
            });
            if (created.ok) {
                const json = await created.json().catch(() => null);
                if (json?.id) ids.push(json.id);
            }
        }

        await sleep(120);
    }

    return ids;
}

const mediaIdByRemoteUrl = new Map();

function getFilenameFromUrl(url) {
    try {
        const u = new URL(String(url));
        const filename = decodeURIComponent((u.pathname.split('/').pop() || '').trim());
        return filename || null;
    } catch {
        return null;
    }
}

function guessMimeType(filename) {
    const lower = String(filename || '').toLowerCase();
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.gif')) return 'image/gif';
    return 'application/octet-stream';
}

async function findExistingMediaIdByFilename(filename) {
    const name = String(filename || '').trim();
    if (!name) return null;
    const token = name.replace(/\.[a-z0-9]+$/i, '');
    if (!token) return null;

    try {
        const res = await fetch(`${WP_URL}/wp-json/wp/v2/media?per_page=100&search=${encodeURIComponent(token)}&_fields=id,source_url`);
        if (!res.ok) return null;
        const json = await res.json().catch(() => null);
        if (!Array.isArray(json) || json.length === 0) return null;

        const exact = json.find((m) => {
            const src = String(m?.source_url || '');
            return src.toLowerCase().endsWith(`/${name.toLowerCase()}`);
        });
        if (exact?.id) return exact.id;

        const first = json.find((m) => m?.id);
        return first?.id || null;
    } catch {
        return null;
    }
}

async function ensureWpMediaFromRemoteUrl(remoteUrl) {
    const url = String(remoteUrl || '').trim();
    if (!url) return null;
    if (mediaIdByRemoteUrl.has(url)) return mediaIdByRemoteUrl.get(url);

    const filename = getFilenameFromUrl(url);
    if (!filename) return null;

    const existingId = await findExistingMediaIdByFilename(filename);
    if (existingId) {
        mediaIdByRemoteUrl.set(url, existingId);
        return existingId;
    }

    if (isDryRun) {
        console.log(`[dry-run] would upload media: ${url}`);
        mediaIdByRemoteUrl.set(url, null);
        return null;
    }

    const download = await fetch(url);
    if (!download.ok) {
        throw new Error(`Failed to download media: ${url} (${download.status})`);
    }

    const contentType = download.headers.get('content-type') || guessMimeType(filename);
    const buffer = Buffer.from(await download.arrayBuffer());

    const uploaded = await wpFetchJson('/wp-json/wp/v2/media', {
        method: 'POST',
        headers: {
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Type': contentType,
        },
        body: buffer,
    });

    const id = uploaded?.id || null;
    mediaIdByRemoteUrl.set(url, id);
    await sleep(250);
    return id;
}

async function fetchAllWpInsightsLite() {
    const all = [];
    let page = 1;

    while (true) {
        const res = await wpFetch(`/wp-json/wp/v2/insight?per_page=100&page=${page}&status=any&_fields=id,slug,date,date_gmt,acf,featured_media`, {
            method: 'GET',
        });

        if (!res.ok) break;
        const json = await res.json().catch(() => null);
        if (!Array.isArray(json) || json.length === 0) break;

        for (const post of json) {
            if (post?.id && post?.slug) all.push(post);
        }

        page += 1;
        await sleep(120);
    }

    return all;
}

async function parseCsvFile(filePath) {
    return new Promise((resolve, reject) => {
        const rows = [];
        fs.createReadStream(filePath)
            .pipe(
                parse({
                    columns: true,
                    skip_empty_lines: true,
                    relax_quotes: true,
                    relax_column_count: true,
                    trim: true,
                })
            )
            .on('data', (row) => rows.push(row))
            .on('error', reject)
            .on('end', () => resolve(rows));
    });
}

async function createWpInsight({ title, slug, dateIso, content, tagIds, acf, featuredMediaId }) {
    const payload = {
        title,
        slug,
        status: 'publish',
        date: dateIso,
        date_gmt: dateIso,
        content,
        tags: tagIds,
    };

    if (featuredMediaId) {
        payload.featured_media = featuredMediaId;
    }

    if (acf && typeof acf === 'object') {
        payload.acf = acf;
    }

    if (isDryRun) {
        console.log(`[dry-run] create insight slug=${slug} date=${dateIso}`);
        return null;
    }

    const created = await wpFetchJson('/wp-json/wp/v2/insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    return created;
}

async function updateWpInsight(id, dateIso, { acf, featuredMediaId } = {}) {
    if (isDryRun) {
        console.log(`[dry-run] update insight id=${id} date=${dateIso}`);
        return;
    }

    await wpFetchJson(`/wp-json/wp/v2/insight/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            date: dateIso,
            date_gmt: dateIso,
            ...(featuredMediaId ? { featured_media: featuredMediaId } : {}),
            ...(acf && typeof acf === 'object' ? { acf } : {}),
        }),
    });
}

async function main() {
    const root = path.resolve(__dirname, '..');
    const csvPath = path.join(root, 'CMS-Migration', 'Ahmad Al-Karmi - Articles & Insights.csv');
    if (!fs.existsSync(csvPath)) {
        throw new Error(`CSV not found: ${csvPath}`);
    }

    console.log('🔄 Sync WP insights from CSV');
    console.log(`   WP: ${WP_URL}`);
    console.log(`   CSV: ${csvPath}`);
    console.log(`   Mode: ${isDryRun ? 'DRY RUN' : 'WRITE'}`);

    const rows = await parseCsvFile(csvPath);

    const bySlug = new Map();
    for (const row of rows) {
        const slug = String(row?.Slug || '').trim();
        if (!slug) continue;

        const isArchived = String(row?.Archived || '').trim().toLowerCase() === 'true';
        const isDraft = String(row?.Draft || '').trim().toLowerCase() === 'true';
        if (isArchived || isDraft) continue;

        if (!bySlug.has(slug)) bySlug.set(slug, row);
    }

    const liveOrder = await fetchLiveSlugOrder();
    const liveRank = new Map(liveOrder.map((slug, idx) => [slug, idx]));
    console.log(`🌐 Live site slug order detected: ${liveOrder.length}`);

    const csvSlugs = Array.from(bySlug.keys());
    const targetSlugs = liveOrder.length > 0
        ? liveOrder.filter((slug) => bySlug.has(slug))
        : csvSlugs;

    console.log(`📄 CSV unique (non-draft, non-archived) slugs: ${csvSlugs.length}`);
    console.log(`🎯 Target slugs to sync: ${targetSlugs.length}`);

    const wpPosts = await fetchAllWpInsightsLite();
    console.log(`🧾 WP insight posts (status=any): ${wpPosts.length}`);

    const timeSlotsByDay = new Map();
    for (const slug of targetSlugs) {
        const row = bySlug.get(slug);
        const dateYmd = parseCsvDateToIso(String(row?.Datepublished || '').trim());
        if (!dateYmd) continue;
        const rank = liveRank.has(slug) ? Number(liveRank.get(slug)) : Number.MAX_SAFE_INTEGER;
        const perDay = timeSlotsByDay.get(dateYmd) || [];
        perDay.push(rank);
        timeSlotsByDay.set(dateYmd, perDay);
    }

    for (const [day, ranks] of timeSlotsByDay.entries()) {
        ranks.sort((a, b) => a - b);
        timeSlotsByDay.set(day, ranks);
    }

    const wpByBase = new Map();
    for (const post of wpPosts) {
        const base = stripWpDuplicateSuffix(post.slug);
        if (!wpByBase.has(base)) wpByBase.set(base, []);
        wpByBase.get(base).push(post);
    }

    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (const slug of targetSlugs) {
        const row = bySlug.get(slug);
        const title = String(row?.Name || '').trim();
        const dateYmd = parseCsvDateToIso(String(row?.Datepublished || '').trim());
        const rank = liveRank.has(slug) ? Number(liveRank.get(slug)) : Number.MAX_SAFE_INTEGER;

        if (!title) {
            console.warn(`⚠️  Skipping slug=${slug}: missing title`);
            skippedCount += 1;
            continue;
        }

        if (!dateYmd) {
            console.warn(`⚠️  Skipping slug=${slug}: invalid Datepublished (${row?.Datepublished})`);
            skippedCount += 1;
            continue;
        }

        const perDayRanks = timeSlotsByDay.get(dateYmd) || [];
        const pos = perDayRanks.indexOf(rank);
        // Use times near midday UTC so local timezones don't roll the calendar date.
        // Higher time => higher in sort order.
        const baseSeconds = 12 * 60 * 60;
        const seconds = rank === Number.MAX_SAFE_INTEGER
            ? baseSeconds
            : (baseSeconds + Math.max(0, 1000 - pos));
        const dateIso = buildIsoDateTime(dateYmd, seconds);

        const posts = wpByBase.get(slug) || [];

        if (posts.length === 0) {
            const tagsRaw = String(row?.Tags || '').split(',').map((t) => t.trim()).filter(Boolean);
            const tagIds = await ensureWpTags(tagsRaw);

            const content = String(row?.['Post body'] || '').trim();
            if (!content) {
                console.warn(`⚠️  Skipping create slug=${slug}: empty Post body`);
                skippedCount += 1;
                continue;
            }

            const featured = String(row?.['Featured?'] || '').trim().toLowerCase() === 'true';
            const description = String(row?.['Post Description'] || '').trim();

            const mainImageUrl = String(row?.['Main image'] || '').trim();
            const thumbImageUrl = String(row?.['Thumbnail image'] || '').trim();
            const mainMediaId = await ensureWpMediaFromRemoteUrl(mainImageUrl);
            const thumbMediaId = await ensureWpMediaFromRemoteUrl(thumbImageUrl);

            console.log(`➕ Creating missing: ${slug} (${dateIso})`);
            const created = await createWpInsight({
                title,
                slug,
                dateIso,
                content,
                tagIds,
                featuredMediaId: mainMediaId || undefined,
                acf: {
                    featured,
                    description,
                    ...(mainMediaId ? { mainImage: mainMediaId } : {}),
                    ...(thumbMediaId ? { thumbnailImage: thumbMediaId } : {}),
                },
            });
            if (created?.id) {
                createdCount += 1;
                console.log(`   ✓ created id=${created.id}`);
            } else {
                createdCount += 1;
            }

            await sleep(250);
            continue;
        }

        for (const post of posts) {
            const featured = String(row?.['Featured?'] || '').trim().toLowerCase() === 'true';
            const description = String(row?.['Post Description'] || '').trim();
            const current = normalizeWpGmt(post?.date_gmt);

            const isDuplicate = stripWpDuplicateSuffix(post.slug) !== post.slug;
            const hasFeaturedMedia = Number(post?.featured_media || 0) > 0;
            const hasAcfThumb = Boolean(post?.acf?.thumbnailImage);

            const needsFeaturedMedia = !isDuplicate && !hasFeaturedMedia;
            const needsAcfThumb = !isDuplicate && !hasAcfThumb;

            const mainImageUrl = String(row?.['Main image'] || '').trim();
            const thumbImageUrl = String(row?.['Thumbnail image'] || '').trim();

            const mainMediaId = needsFeaturedMedia && mainImageUrl
                ? await ensureWpMediaFromRemoteUrl(mainImageUrl)
                : null;

            const thumbMediaId = needsAcfThumb && thumbImageUrl
                ? await ensureWpMediaFromRemoteUrl(thumbImageUrl)
                : null;

            const existingFeatured = Boolean(post?.acf?.featured);
            const existingDescription = String(post?.acf?.description || '').trim();
            const needsDateUpdate = !(current && current === dateIso);
            const needsAcfUpdate = (existingFeatured !== featured) || (existingDescription !== description);

            const needsMediaUpdate = Boolean(
                (needsFeaturedMedia && mainMediaId)
                || (needsAcfThumb && thumbMediaId)
            );

            if (!needsDateUpdate && !needsAcfUpdate && !needsMediaUpdate) continue;

            console.log(`🕒 Updating: ${post.slug} id=${post.id} ${String(post?.date_gmt || post?.date || '')} -> ${dateIso}`);
            await updateWpInsight(post.id, dateIso, {
                featuredMediaId: needsFeaturedMedia && mainMediaId ? mainMediaId : undefined,
                acf: {
                    featured,
                    description,
                    ...(needsAcfThumb && thumbMediaId ? { thumbnailImage: thumbMediaId } : {}),
                },
            });
            updatedCount += 1;
            await sleep(200);
        }
    }

    console.log('\n✅ Sync complete');
    console.log(`   Created: ${createdCount}`);
    console.log(`   Updated: ${updatedCount}`);
    console.log(`   Skipped: ${skippedCount}`);
    console.log('\nNext: re-run your frontend Insights page and confirm you see 34 posts ordered by publish date.');
}

main().catch((e) => {
    console.error(`\n❌ Sync failed: ${String(e?.message || e)}`);
    process.exit(1);
});
