import process from 'process';

const WP_URL = process.env.WP_URL || 'https://admin.ahmadkarmi.com';
const WP_USER = process.env.WP_USER || '';
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD || '';

const args = process.argv.slice(2);
const confirmed = args.includes('--yes');

if (!confirmed) {
    console.error('Refusing to run without confirmation flag. Re-run with: node backfill-acf-media.mjs --yes');
    process.exit(1);
}

if (!WP_USER || !WP_APP_PASSWORD) {
    throw new Error('Missing required environment variables: WP_USER and/or WP_APP_PASSWORD');
}

const WP_AUTH = Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString('base64');

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function wpFetchJson(path, options = {}) {
    const response = await fetch(`${WP_URL}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${WP_AUTH}`,
            ...(options.headers || {}),
        },
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`WP ${options.method || 'GET'} ${path} failed: ${response.status} ${text.slice(0, 200)}`);
    }

    return response.json();
}

async function wpFetchJsonPublic(path) {
    const response = await fetch(`${WP_URL}${path}`);
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`WP GET ${path} failed: ${response.status} ${text.slice(0, 200)}`);
    }
    return response.json();
}

function stripWpDuplicateSuffix(slug) {
    return String(slug || '').replace(/-\d+$/, '');
}

function tokenize(value) {
    return String(value || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 3);
}

function scoreLogoCandidate(filename, tokens) {
    const lower = filename.toLowerCase();
    let score = 0;
    if (lower.includes('logo')) score += 10;
    for (const token of tokens) {
        if (token && lower.includes(token)) score += 3;
    }
    return score;
}

async function fetchAllLogoMedia() {
    const all = [];
    let page = 1;

    while (true) {
        const results = await wpFetchJsonPublic(`/wp-json/wp/v2/media?per_page=100&page=${page}&search=${encodeURIComponent('logo')}&_fields=id,source_url`);
        if (!Array.isArray(results) || results.length === 0) break;
        all.push(...results);
        page += 1;
        await sleep(150);
    }

    return all
        .filter((m) => m?.id && typeof m?.source_url === 'string')
        .map((m) => ({ id: m.id, source_url: m.source_url }));
}

function findBestLogoId({ client, slug }, logos) {
    const slugBase = stripWpDuplicateSuffix(slug);
    const tokens = Array.from(new Set([...tokenize(client), ...tokenize(slugBase)]));

    let best = null;
    for (const logo of logos) {
        const filename = logo.source_url.split('/').pop() || '';
        const score = scoreLogoCandidate(filename, tokens);
        if (!best || score > best.score) {
            best = { id: logo.id, score, filename };
        }
    }

    if (!best || best.score < 10) return null;
    return best.id;
}

async function fetchAllPosts(postType) {
    const all = [];
    let page = 1;

    while (true) {
        try {
            const results = await wpFetchJson(`/wp-json/wp/v2/${postType}?per_page=100&page=${page}&_fields=id,slug,title,featured_media,acf`, {
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

async function updateAcf(postType, id, acf) {
    return wpFetchJson(`/wp-json/wp/v2/${postType}/${id}`, {
        method: 'POST',
        body: JSON.stringify({ acf }),
    });
}

async function backfillWorks(logos) {
    console.log('\n🔧 Backfilling Works ACF media fields...');
    const works = await fetchAllPosts('work');
    console.log(`Found ${works.length} works`);

    for (const work of works) {
        const updates = {};
        const acf = work?.acf || {};

        if (!acf.mainImage && work.featured_media) {
            updates.mainImage = work.featured_media;
        }

        if (!acf.clientLogo) {
            const id = findBestLogoId({ client: acf.client, slug: work.slug }, logos);
            if (id) updates.clientLogo = id;
        }

        const updateKeys = Object.keys(updates);
        if (updateKeys.length === 0) continue;

        console.log(`  → work ${work.id} (${work.slug}): updating ${updateKeys.join(', ')}`);
        try {
            await updateAcf('work', work.id, updates);
            await sleep(200);
        } catch (e) {
            console.error(`    ✗ failed: ${String(e?.message || e)}`);
        }
    }
}

async function backfillInsights() {
    console.log('\n🔧 Backfilling Insights ACF mainImage from featured_media...');
    const insights = await fetchAllPosts('insight');
    console.log(`Found ${insights.length} insights`);

    for (const insight of insights) {
        const updates = {};
        const acf = insight?.acf || {};

        if (!acf.mainImage && insight.featured_media) {
            updates.mainImage = insight.featured_media;
        }

        const updateKeys = Object.keys(updates);
        if (updateKeys.length === 0) continue;

        console.log(`  → insight ${insight.id} (${insight.slug}): updating ${updateKeys.join(', ')}`);
        try {
            await updateAcf('insight', insight.id, updates);
            await sleep(200);
        } catch (e) {
            console.error(`    ✗ failed: ${String(e?.message || e)}`);
        }
    }
}

async function main() {
    console.log('🚀 Backfill ACF media fields (WordPress)');
    console.log(`   WP: ${WP_URL}`);

    const logos = await fetchAllLogoMedia();
    console.log(`📷 Found ${logos.length} logo-like media items`);

    await backfillWorks(logos);
    await backfillInsights();

    console.log('\n✅ Backfill complete');
}

main().catch((e) => {
    console.error(`\n❌ Backfill failed: ${String(e?.message || e)}`);
    process.exit(1);
});
