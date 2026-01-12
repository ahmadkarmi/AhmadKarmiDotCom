// Fix content AND publish in one script
const STRAPI_URL = 'http://localhost:1337';
const TOKEN = '0e68750917043287c8e95d1b6d9ecd15064c13549d0f49c0a6175507fc018cd6e936f21d8b8ea0462ca3cc2e9bf86919b562962e768e56d4d5fbee445d0ad4809bdeac1100a752cd37788e979ba3d6f55eda6cb4b1906e70d07646afa828d9a1d4396816d44a3e64e03c1cb291d34e5674d9ed549bfbf283ff6cdc093cc17294';
const INSIGHT_ID = 'h8bm3ksq98pdpwd19kvzisjp';

async function fixAndPublish() {
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
        console.log('Original body length:', body.length);

        // Fix 1: Remove code fences around iframe (handle variations)
        body = body.replace(/```\n*<iframe/g, '<iframe');
        body = body.replace(/<\/iframe>\n*```/g, '</iframe>');

        // Fix 2: Fix the MIT link - replace the entire malformed section
        // Match: [MIT Media Lab's "Gender Shades" research]https://...until the end of that line
        const mitLinkIdx = body.indexOf('[MIT Media Lab');
        const lineEndIdx = body.indexOf('\n', mitLinkIdx);
        if (mitLinkIdx > -1 && lineEndIdx > mitLinkIdx) {
            const brokenLine = body.substring(mitLinkIdx, lineEndIdx);
            console.log('Broken line found:', brokenLine);

            if (brokenLine.includes('(link)') || brokenLine.includes('**]')) {
                body = body.substring(0, mitLinkIdx) +
                    '[MIT Media Lab\'s "Gender Shades" research](https://www.media.mit.edu/projects/gender-shades/overview/)' +
                    body.substring(lineEndIdx);
                console.log('Fixed MIT link!');
            }
        }

        console.log('Fixed body length:', body.length);

        // Update with explicit status:published (Strapi v5)
        const updateRes = await fetch(`${STRAPI_URL}/api/insights/${INSIGHT_ID}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${TOKEN}`
            },
            body: JSON.stringify({
                data: {
                    body: body
                }
            })
        });

        const updateJson = await updateRes.json();
        console.log('Update response status:', updateRes.status);

        if (updateJson.data) {
            console.log('Content updated!');

            // Now publish explicitly (Strapi v5)
            const publishRes = await fetch(`${STRAPI_URL}/api/insights/${INSIGHT_ID}/actions/publish`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${TOKEN}`
                }
            });

            console.log('Publish response status:', publishRes.status);
            const publishJson = await publishRes.json();

            if (publishJson.data || publishRes.status === 200) {
                console.log('Content published successfully!');
            } else {
                console.log('Publish response:', JSON.stringify(publishJson, null, 2));
            }

            // Verify
            const verifyRes = await fetch(`${STRAPI_URL}/api/insights/${INSIGHT_ID}`);
            const verifyJson = await verifyRes.json();
            const finalBody = verifyJson.data?.body || '';

            console.log('\n=== VERIFICATION ===');
            console.log('Has code fences around iframe:', finalBody.includes('```') && finalBody.includes('<iframe'));
            console.log('Has (link) in MIT section:', finalBody.includes('(link)'));
            console.log('Has correct MIT link format:', finalBody.includes('[MIT Media Lab\'s "Gender Shades" research](https://www.media.mit.edu'));

        } else {
            console.error('Update failed:', JSON.stringify(updateJson, null, 2));
        }

    } catch (error) {
        console.error('Error:', error);
    }
}

fixAndPublish();
