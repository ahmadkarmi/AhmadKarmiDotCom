/**
 * Reset Script: Delete ALL Works and Insights
 * 
 * Clears all data to allow for a clean re-migration now that ACF fields are set up.
 * 
 * Usage: node reset-cpts.mjs
 */

const WP_URL = process.env.WP_URL || 'https://admin.ahmadkarmi.com';
const WP_USER = process.env.WP_USER || '';
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD || '';

const args = process.argv.slice(2);
const confirmed = args.includes('--yes');

if (!confirmed) {
    console.error('Refusing to run without confirmation flag. Re-run with: node reset-cpts.mjs --yes');
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
            console.error(`  ✗ Failed to delete ${postType}/${id}: ${response.status}`);
            return false;
        }

        return true;
    } catch (error) {
        console.error(`  ✗ Error: ${error.message}`);
        return false;
    }
}

async function deleteAll(postType) {
    console.log(`\nDeleting ALL ${postType}s...`);

    const perPage = 100;
    let page = 1;
    let totalDeleted = 0;

    while (true) {
        const response = await fetch(
            `${WP_URL}/wp-json/wp/v2/${postType}?per_page=${perPage}&page=${page}&status=any&_fields=id,title`,
            {
                headers: { 'Authorization': `Basic ${WP_AUTH}` },
            }
        );

        if (!response.ok) {
            if (response.status === 400) break;
            console.log(`Failed to fetch ${postType}s`);
            return;
        }

        const posts = await response.json();
        if (!Array.isArray(posts) || posts.length === 0) break;

        if (page === 1) {
            const totalPages = Number(response.headers.get('x-wp-totalpages') || '');
            const totalItems = Number(response.headers.get('x-wp-total') || '');
            if (Number.isFinite(totalItems) && totalItems > 0) {
                console.log(`   Found ${totalItems} items to delete`);
            } else if (Number.isFinite(totalPages) && totalPages > 0) {
                console.log(`   Found ${totalPages} pages of items to delete`);
            } else {
                console.log(`   Found ${posts.length} items on first page (pagination headers missing)`);
            }
        }

        for (const post of posts) {
            const title = post.title?.rendered || `ID: ${post.id}`;
            console.log(`   → Deleting: ${title}`);
            const deleted = await deletePost(postType, post.id);
            if (deleted) totalDeleted++;
            await new Promise(resolve => setTimeout(resolve, 100)); // Small delay
        }

        page++;
    }

    console.log(`   Deleted ${totalDeleted} ${postType}(s)`);
}

async function main() {
    console.log('🔥 STARTING FULL RESET: Works & Insights');
    await deleteAll('work');
    await deleteAll('insight');
    console.log('\n✅ Reset complete! Ready for re-migration.');
}

main();
