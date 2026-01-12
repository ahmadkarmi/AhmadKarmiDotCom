
// using native fetch
// If axios is not installed in migration fallback to fetch if node 18+
// Using native fetch for compatibility
const STRAPI_URL = 'http://localhost:1337';
const TOKEN = '0e68750917043287c8e95d1b6d9ecd15064c13549d0f49c0a6175507fc018cd6e936f21d8b8ea0462ca3cc2e9bf86919b562962e768e56d4d5fbee445d0ad4809bdeac1100a752cd37788e979ba3d6f55eda6cb4b1906e70d07646afa828d9a1d4396816d44a3e64e03c1cb291d34e5674d9ed549bfbf283ff6cdc093cc17294';
const INSIGHT_ID = 'h8bm3ksq98pdpwd19kvzisjp';

async function fixEmbed() {
    try {
        // 1. Fetch
        const res = await fetch(`${STRAPI_URL}/api/insights/${INSIGHT_ID}`, {
            headers: { Authorization: `Bearer ${TOKEN}` }
        });
        const json = await res.json();
        const article = json.data;

        if (!article) {
            console.error('Article not found. JSON:', JSON.stringify(json, null, 2));
            return;
        }

        let body = article.body;

        // 2. Fix Body
        // Replace ```<iframe...</iframe>``` with just the iframe
        // Use a regex that matches the specific block structure seen in the output
        const regex = /```\s*(<iframe[^>]*>.*?<\/iframe>)\s*```/gs;

        if (!regex.test(body)) {
            console.log('No code-fenced iframe found. Checking for variations...');
            // debug
            console.log(body.substring(body.indexOf('iframe') - 10, body.indexOf('iframe') + 300));
        }

        const newBody = body.replace(regex, '$1');

        if (newBody === body) {
            console.log('No changes made to body.');
            return;
        }

        // 3. Update
        const updateRes = await fetch(`${STRAPI_URL}/api/insights/${INSIGHT_ID}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${TOKEN}`
            },
            body: JSON.stringify({
                data: {
                    body: newBody
                }
            })
        });

        const updateJson = await updateRes.json();
        if (updateJson.data) {
            console.log('Successfully updated article body!');
        } else {
            console.error('Update failed:', JSON.stringify(updateJson, null, 2));
        }

    } catch (error) {
        console.error('Error:', error);
    }
}

fixEmbed();
