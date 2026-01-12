/**
 * Migration Script: Strapi to WordPress
 * 
 * This script reads Works and Insights from the local Strapi database
 * and creates them in WordPress via the REST API.
 * 
 * Usage: node migrate-to-wp.mjs
 */

const WP_URL = process.env.WP_URL || 'https://admin.ahmadkarmi.com';
const WP_USER = process.env.WP_USER || '';
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD || '';
const STRAPI_URL = process.env.STRAPI_URL || 'http://localhost:1337';
const STRAPI_API_TOKEN = process.env.STRAPI_API_TOKEN || '';

if (!WP_USER || !WP_APP_PASSWORD) {
    throw new Error('Missing required environment variables: WP_USER and/or WP_APP_PASSWORD');
}

const WP_AUTH = Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString('base64');

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

    for (const key of ['mainImage', 'coverImage', 'clientLogo', 'thumbnailImage']) {
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
    try {
        const headers = STRAPI_API_TOKEN ? { Authorization: `Bearer ${STRAPI_API_TOKEN}` } : undefined;
        const response = await fetch(`${STRAPI_URL}/api/${endpoint}?populate=*`, {
            headers,
        });
        if (!response.ok) {
            console.error(`Failed to fetch ${endpoint} from Strapi`);
            return [];
        }
        const json = await response.json();
        const data = Array.isArray(json.data) ? json.data : [];
        return data.map(normalizeStrapiEntry);
    } catch (error) {
        console.error(`Error fetching ${endpoint}:`, error.message);
        return [];
    }
}

async function createInWordPress(postType, data) {
    try {
        const response = await fetch(`${WP_URL}/wp-json/wp/v2/${postType}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${WP_AUTH}`,
            },
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Failed to create ${postType}:`, response.status, errorText);
            return null;
        }

        return await response.json();
    } catch (error) {
        console.error(`Error creating ${postType}:`, error.message);
        return null;
    }
}

async function migrateWorks() {
    console.log('\n📦 Migrating Works...');
    const works = await fetchFromStrapi('works');

    if (works.length === 0) {
        console.log('No works found in Strapi');
        return;
    }

    console.log(`Found ${works.length} works in Strapi`);

    for (const work of works) {
        const wpData = {
            title: work.name,
            slug: work.slug,
            status: 'publish',
            acf: {
                status: work.status || 'completed',
                featured: work.featured || false,
                brief: work.brief || '',
                scope: work.scope || '',
                details: work.details || '',
                client: work.client || '',
                videoUrl: work.videoUrl || '',
            },
        };

        console.log(`  → Creating: ${work.name}`);
        const result = await createInWordPress('work', wpData);
        if (result) {
            console.log(`    ✓ Created with ID: ${result.id}`);
        }
    }
}

async function migrateInsights() {
    console.log('\n📝 Migrating Insights...');
    const insights = await fetchFromStrapi('insights');

    if (insights.length === 0) {
        console.log('No insights found in Strapi');
        return;
    }

    console.log(`Found ${insights.length} insights in Strapi`);

    for (const insight of insights) {
        const wpData = {
            title: insight.name,
            slug: insight.slug,
            status: 'publish',
            date: insight.publishDate || new Date().toISOString(),
            content: insight.body || '',
            acf: {
                featured: insight.featured || false,
                description: insight.description || '',
            },
        };

        console.log(`  → Creating: ${insight.name}`);
        const result = await createInWordPress('insight', wpData);
        if (result) {
            console.log(`    ✓ Created with ID: ${result.id}`);
        }
    }
}

async function main() {
    console.log('🚀 Starting Strapi → WordPress Migration');
    console.log(`   Strapi: ${STRAPI_URL}`);
    console.log(`   WordPress: ${WP_URL}`);

    await migrateWorks();
    await migrateInsights();

    console.log('\n✅ Migration complete!');
}

main();
