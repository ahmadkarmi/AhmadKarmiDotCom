// Comprehensive fix for both iframe and link issues
const STRAPI_URL = 'http://localhost:1337';
const TOKEN = '0e68750917043287c8e95d1b6d9ecd15064c13549d0f49c0a6175507fc018cd6e936f21d8b8ea0462ca3cc2e9bf86919b562962e768e56d4d5fbee445d0ad4809bdeac1100a752cd37788e979ba3d6f55eda6cb4b1906e70d07646afa828d9a1d4396816d44a3e64e03c1cb291d34e5674d9ed549bfbf283ff6cdc093cc17294';
const INSIGHT_ID = 'h8bm3ksq98pdpwd19kvzisjp';

async function fixContent() {
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

        // Fix 1: Remove code fences around iframe
        body = body.replace(/```\s*<iframe/g, '<iframe');
        body = body.replace(/<\/iframe>\s*```/g, '</iframe>');

        // Fix 2: Fix the broken MIT link
        // Current broken: [MIT Media Lab's "Gender Shades" research]https://www.media.mit.edu/projects/gender-shades/overview/**](https://www.media.mit.edu/projects/gender-shades/overview/(link)
        // Replace the entire broken section with correct markdown
        const brokenMitPattern = /\[MIT Media Lab's "Gender Shades" research\][^\n]*gender-shades[^\n]*/g;
        body = body.replace(brokenMitPattern, '[MIT Media Lab\'s "Gender Shades" research](https://www.media.mit.edu/projects/gender-shades/overview/)');

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
            console.log('Successfully fixed content!');

            // Verify fixes
            const newBody = updateJson.data.body;
            console.log('\n=== VERIFICATION ===');
            console.log('iframe has code fences:', newBody.includes('```') && newBody.includes('<iframe'));
            console.log('MIT link is correct:', newBody.includes('[MIT Media Lab\'s "Gender Shades" research](https://www.media.mit.edu/projects/gender-shades/overview/)'));
        } else {
            console.error('Update failed:', JSON.stringify(updateJson, null, 2));
        }

    } catch (error) {
        console.error('Error:', error);
    }
}

fixContent();
