// Fix broken markdown link - more flexible approach
const STRAPI_URL = 'http://localhost:1337';
const TOKEN = '0e68750917043287c8e95d1b6d9ecd15064c13549d0f49c0a6175507fc018cd6e936f21d8b8ea0462ca3cc2e9bf86919b562962e768e56d4d5fbee445d0ad4809bdeac1100a752cd37788e979ba3d6f55eda6cb4b1906e70d07646afa828d9a1d4396816d44a3e64e03c1cb291d34e5674d9ed549bfbf283ff6cdc093cc17294';
const INSIGHT_ID = 'h8bm3ksq98pdpwd19kvzisjp';

async function fixLink() {
    try {
        const res = await fetch(`${STRAPI_URL}/api/insights/${INSIGHT_ID}`, {
            headers: { Authorization: `Bearer ${TOKEN}` }
        });
        const json = await res.json();
        const article = json.data;

        if (!article) {
            console.error('Article not found.');
            return;
        }

        let body = article.body;

        // Debug: show the exact content around the problematic area
        const idx = body.indexOf('Gender Shades');
        if (idx > -1) {
            console.log('=== BEFORE ===');
            console.log(body.substring(idx - 100, idx + 250));
            console.log('=== END ===');
        }

        // Fix pattern: [MIT Media Lab's "Gender Shades" research]url... -> proper markdown link
        // The broken pattern seems to be missing the () around the URL

        // Pattern 1: [text]url without parentheses
        body = body.replace(
            /\[MIT Media Lab's "Gender Shades" research\]https:\/\/www\.media\.mit\.edu\/projects\/gender-shades\/overview\//g,
            '[MIT Media Lab\'s "Gender Shades" research](https://www.media.mit.edu/projects/gender-shades/overview/)'
        );

        // Pattern 2: Also fix any [**url**](url) pattern
        body = body.replace(
            /\[\*\*https:\/\/www\.media\.mit\.edu\/projects\/gender-shades\/overview\/\*\*\]\(https:\/\/www\.media\.mit\.edu\/projects\/gender-shades\/overview\/\)/g,
            '[MIT Media Lab\'s "Gender Shades" research](https://www.media.mit.edu/projects/gender-shades/overview/)'
        );

        // Update
        const updateRes = await fetch(`${STRAPI_URL}/api/insights/${INSIGHT_ID}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${TOKEN}`
            },
            body: JSON.stringify({
                data: { body }
            })
        });

        const updateJson = await updateRes.json();
        if (updateJson.data) {
            console.log('Successfully updated!');
            // Verify
            const checkIdx = updateJson.data.body.indexOf('Gender Shades');
            if (checkIdx > -1) {
                console.log('=== AFTER ===');
                console.log(updateJson.data.body.substring(checkIdx - 50, checkIdx + 150));
            }
        } else {
            console.error('Update failed:', JSON.stringify(updateJson, null, 2));
        }

    } catch (error) {
        console.error('Error:', error);
    }
}

fixLink();
