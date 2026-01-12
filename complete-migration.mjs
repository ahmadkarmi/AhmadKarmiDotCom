/**
 * Complete Migration Script: Strapi to WordPress
 * 
 * - Migrates Works and Insights with proper date handling
 * - Associates featured images by matching filenames
 * - Splits Creation and Update to handle ACF fields
 * 
 * Usage: node complete-migration.mjs
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

let acfEndpointAvailable = true;

function parseBoolean(value) {
    if (value === true) return true;
    if (value === false) return false;
    if (value === 1 || value === '1') return true;
    if (value === 0 || value === '0') return false;
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === '' || value === null || value === undefined) return false;
    return Boolean(value);
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

async function updateAcfInWordPress(postType, id, acf) {
    if (!acfEndpointAvailable) return null;

    try {
        const response = await fetch(`${WP_URL}/wp-json/acf/v3/${postType}/${id}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${WP_AUTH}`,
            },
            body: JSON.stringify({ fields: acf }),
        });

        if (response.status === 404) {
            acfEndpointAvailable = false;
            return null;
        }

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`  ✗ Failed ACF Update: ${response.status} - ${errorText.substring(0, 80)}...`);
            return null;
        }

        return await response.json();
    } catch (error) {
        console.error(`  ✗ Error: ${error.message}`);
        return null;
    }
}

async function fetchWPMedia() {
    const allMedia = [];
    let page = 1;

    while (true) {
        try {
            const response = await fetch(`${WP_URL}/wp-json/wp/v2/media?per_page=100&page=${page}`, {
                headers: { 'Authorization': `Basic ${WP_AUTH}` },
            });

            if (!response.ok) break;

            const media = await response.json();
            if (media.length === 0) break;

            allMedia.push(...media);
            page++;
        } catch (error) {
            break;
        }
    }

    console.log(`📷 Found ${allMedia.length} media files in WordPress`);
    return allMedia;
}

function findMatchingImage(strapiImage, wpMedia) {
    if (!strapiImage?.url) return null;

    // Extract filename from Strapi URL
    const strapiFilename = strapiImage.url.split('/').pop().toLowerCase();

    // Try to find a match in WordPress media
    for (const media of wpMedia) {
        const wpFilename = media.source_url.split('/').pop().toLowerCase();

        // Direct match
        if (wpFilename === strapiFilename) {
            return media.id;
        }

        // Partial match (filename might have different prefix/suffix)
        if (wpFilename.includes(strapiFilename.replace(/\.[^.]+$/, '')) ||
            strapiFilename.includes(wpFilename.replace(/\.[^.]+$/, ''))) {
            return media.id;
        }
    }

    return null;
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
            const searchResponse = await fetch(
                `${WP_URL}/wp-json/wp/v2/tags?per_page=100&search=${encodeURIComponent(name)}`,
                { headers: { 'Authorization': `Basic ${WP_AUTH}` } }
            );

            if (searchResponse.ok) {
                const found = await searchResponse.json();
                const exact = Array.isArray(found) ? found.find((t) => t.slug === slug) : null;
                if (exact?.id) {
                    tagIds.push(exact.id);
                    continue;
                }
            }

            const createResponse = await fetch(`${WP_URL}/wp-json/wp/v2/tags`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Basic ${WP_AUTH}`,
                },
                body: JSON.stringify({ name, slug }),
            });

            if (createResponse.ok) {
                const created = await createResponse.json();
                if (created?.id) tagIds.push(created.id);
            }
        } catch (e) {
            // Ignore tag failures; content migration should still proceed.
        }
    }

    return tagIds;
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
            console.error(`  ✗ Failed Create: ${response.status} - ${errorText.substring(0, 80)}...`);
            return null;
        }

        return await response.json();
    } catch (error) {
        console.error(`  ✗ Error: ${error.message}`);
        return null;
    }
}

async function updateInWordPress(postType, id, data) {
    try {
        const response = await fetch(`${WP_URL}/wp-json/wp/v2/${postType}/${id}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${WP_AUTH}`,
            },
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`  ✗ Failed Update: ${response.status} - ${errorText.substring(0, 80)}...`);
            return null;
        }

        return await response.json();
    } catch (error) {
        console.error(`  ✗ Error: ${error.message}`);
        return null;
    }
}

async function migrateWorks(wpMedia) {
    console.log('\n📦 Migrating Works...');
    const works = await fetchFromStrapi('works');

    if (works.length === 0) {
        console.log('No works found in Strapi');
        return;
    }

    console.log(`Found ${works.length} works in Strapi`);

    for (const work of works) {
        const mainImageId = findMatchingImage(work.mainImage, wpMedia);
        const coverImageId = findMatchingImage(work.coverImage, wpMedia);
        const clientLogoId = findMatchingImage(work.clientLogo, wpMedia);
        const galleryIds = Array.isArray(work.gallery)
            ? work.gallery.map((img) => findMatchingImage(img, wpMedia)).filter(Boolean)
            : [];

        const featuredMediaId = mainImageId || coverImageId;

        // 1. Create Post (NO ACF here)
        const wpData = {
            title: work.name,
            slug: work.slug,
            status: 'publish',
            content: work.details || work.brief || '',
        };

        // Add featured image if found
        if (featuredMediaId) {
            wpData.featured_media = featuredMediaId;
        }

        console.log(`  → Creating: ${work.name}${featuredMediaId ? ' (with image)' : ''}`);
        const result = await createInWordPress('work', wpData);
        if (result) {
            console.log(`    ✓ Created with ID: ${result.id}`);

            // 2. Update with ACF
            const acf = {
                status: work.status || 'completed',
                featured: parseBoolean(work.featured),
                brief: work.brief || '',
                scope: work.scope || '',
                details: work.details || '',
                client: work.client || '',
                videoUrl: work.videoUrl || '',
            };

            if (mainImageId) acf.mainImage = mainImageId;
            if (coverImageId) acf.coverImage = coverImageId;
            if (clientLogoId) acf.clientLogo = clientLogoId;
            if (galleryIds.length > 0) acf.gallery = galleryIds;

            const acfData = { acf };

            console.log(`    ↻ Updating ACF...`);
            const wpUpdateResult = await updateInWordPress('work', result.id, acfData);
            const acfUpdateResult = await updateAcfInWordPress('work', result.id, acf);
            if (acfUpdateResult || wpUpdateResult) {
                console.log(`    ✓ ACF Updated`);
            }
        }
    }
}

async function migrateInsights(wpMedia) {
    console.log('\n📝 Migrating Insights...');
    const insights = await fetchFromStrapi('insights');

    if (insights.length === 0) {
        console.log('No insights found in Strapi');
        return;
    }

    console.log(`Found ${insights.length} insights in Strapi`);

    for (const insight of insights) {
        const mainImageId = findMatchingImage(insight.mainImage, wpMedia);
        const thumbnailImageId = findMatchingImage(insight.thumbnailImage, wpMedia);
        const featuredMediaId = mainImageId || thumbnailImageId;

        const tagIds = await ensureWPTags(insight.tags);

        // 1. Create Post (NO ACF here)
        const wpData = {
            title: insight.name,
            slug: insight.slug,
            status: 'publish',
            date: insight.publishDate || new Date().toISOString(),
            content: insight.body || '',
        };

        if (tagIds.length > 0) {
            wpData.tags = tagIds;
        }

        // Add featured image if found
        if (featuredMediaId) {
            wpData.featured_media = featuredMediaId;
        }

        console.log(`  → Creating: ${insight.name}${featuredMediaId ? ' (with image)' : ''}`);
        const result = await createInWordPress('insight', wpData);
        if (result) {
            console.log(`    ✓ Created with ID: ${result.id}`);

            // 2. Update with ACF
            const acf = {
                featured: parseBoolean(insight.featured),
                description: insight.description || '',
            };

            if (mainImageId) acf.mainImage = mainImageId;
            if (thumbnailImageId) acf.thumbnailImage = thumbnailImageId;

            const acfData = { acf };

            console.log(`    ↻ Updating ACF...`);
            const wpUpdateResult = await updateInWordPress('insight', result.id, acfData);
            const acfUpdateResult = await updateAcfInWordPress('insight', result.id, acf);
            if (acfUpdateResult || wpUpdateResult) {
                console.log(`    ✓ ACF Updated`);
            }
        }
    }
}

async function main() {
    console.log('🚀 Starting Complete Migration (Strapi → WordPress)');
    console.log(`   Strapi: ${STRAPI_URL}`);
    console.log(`   WordPress: ${WP_URL}`);

    // First, fetch all WordPress media to match images
    const wpMedia = await fetchWPMedia();

    await migrateWorks(wpMedia);
    await migrateInsights(wpMedia);

    console.log('\n✅ Migration complete!');
}

main();
