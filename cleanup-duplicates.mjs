/**
 * Cleanup Script: Delete WordPress posts without images
 * 
 * Deletes Works and Insights that have featured_media = 0
 * 
 * Usage: node cleanup-duplicates.mjs
 */

const WP_URL = process.env.WP_URL || 'https://admin.ahmadkarmi.com';
const WP_USER = process.env.WP_USER || '';
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD || '';

const args = process.argv.slice(2);
const confirmed = args.includes('--yes');

if (!confirmed) {
    console.error('Refusing to run without confirmation flag. Re-run with: node cleanup-duplicates.mjs --yes');
    process.exit(1);
}

if (!WP_USER || !WP_APP_PASSWORD) {
    throw new Error('Missing required environment variables: WP_USER and/or WP_APP_PASSWORD');
}

const WP_AUTH = Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString('base64');

async function deletePost(postType, id) {
    try {
        const response = await fetch(`${WP_URL}/wp-json/wp/v2/${postType}/${id}?force=true`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Basic ${WP_AUTH}`,
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`  ✗ Failed to delete ${postType}/${id}: ${response.status}`);
            return false;
        }

        return true;
    } catch (error) {
        console.error(`  ✗ Error: ${error.message}`);
        return false;
    }
}

async function cleanupPosts(postType) {
    console.log(`\n🧹 Cleaning up ${postType}...`);

    const perPage = 100;
    let page = 1;
    let total = 0;
    let totalDeleted = 0;

    while (true) {
        const response = await fetch(
            `${WP_URL}/wp-json/wp/v2/${postType}?per_page=${perPage}&page=${page}&status=any&_fields=id,title,featured_media`,
            {
                headers: { 'Authorization': `Basic ${WP_AUTH}` },
            }
        );

        if (!response.ok) {
            if (response.status === 400) break;
            console.error(`Failed to fetch ${postType}: ${response.status}`);
            return;
        }

        const posts = await response.json();
        if (!Array.isArray(posts) || posts.length === 0) break;

        total += posts.length;
        const toDelete = posts.filter((p) => p.featured_media === 0);

        for (const post of toDelete) {
            const title = post.title?.rendered || `ID: ${post.id}`;
            console.log(`   → Deleting: ${title} (ID: ${post.id})`);
            const success = await deletePost(postType, post.id);
            if (success) {
                totalDeleted++;
                console.log(`     ✓ Deleted`);
            }
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        page++;
    }

    console.log(`   Scanned ${total} total, deleted ${totalDeleted} without images`);
}

async function main() {
    console.log('🧹 Starting Cleanup - Removing Duplicates Without Images');
    console.log(`   WordPress: ${WP_URL}`);

    await cleanupPosts('work');
    await cleanupPosts('insight');

    console.log('\n✅ Cleanup complete!');
}

main();
