// Force update with status:published (Strapi v5)
const STRAPI_URL = 'http://localhost:1337';
const TOKEN = '0e68750917043287c8e95d1b6d9ecd15064c13549d0f49c0a6175507fc018cd6e936f21d8b8ea0462ca3cc2e9bf86919b562962e768e56d4d5fbee445d0ad4809bdeac1100a752cd37788e979ba3d6f55eda6cb4b1906e70d07646afa828d9a1d4396816d44a3e64e03c1cb291d34e5674d9ed549bfbf283ff6cdc093cc17294';
const INSIGHT_ID = 'h8bm3ksq98pdpwd19kvzisjp';

async function forceFixAndPublish() {
    try {
        // First get ALL versions including draft
        const res = await fetch(`${STRAPI_URL}/api/insights/${INSIGHT_ID}?status=draft`, {
            headers: { Authorization: `Bearer ${TOKEN}` }
        });
        let article = (await res.json()).data;

        console.log('Draft article:', article ? 'found' : 'not found');

        // If no draft, get published
        if (!article) {
            const pubRes = await fetch(`${STRAPI_URL}/api/insights/${INSIGHT_ID}`, {
                headers: { Authorization: `Bearer ${TOKEN}` }
            });
            article = (await pubRes.json()).data;
            console.log('Published article:', article ? 'found' : 'not found');
        }

        if (!article) {
            console.error('Article not found');
            return;
        }

        let body = article.body;
        console.log('Body excerpt before fix:', body.substring(body.indexOf('<iframe') - 5, body.indexOf('<iframe') + 50));

        // Fix 1: Remove code fences
        body = body.replace(/```\n*<iframe/g, '<iframe');
        body = body.replace(/<\/iframe>\n*```/g, '</iframe>');

        // Fix 2: Replace broken MIT link entirely
        const lines = body.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('[MIT Media Lab') && (lines[i].includes('(link)') || lines[i].includes('**]') || lines[i].includes(']https://'))) {
                console.log('Fixing line', i, ':', lines[i].substring(0, 60) + '...');
                lines[i] = '[MIT Media Lab\'s "Gender Shades" research](https://www.media.mit.edu/projects/gender-shades/overview/)';
            }
        }
        body = lines.join('\n');

        // Update with status='published' query param (Strapi v5 way)
        const updateRes = await fetch(`${STRAPI_URL}/api/insights/${INSIGHT_ID}?status=published`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${TOKEN}`
            },
            body: JSON.stringify({ data: { body } })
        });

        console.log('Update status:', updateRes.status);
        const updateData = await updateRes.json();

        if (updateData.error) {
            console.error('Update error:', JSON.stringify(updateData.error, null, 2));
        } else {
            console.log('Update successful!');
        }

        // Verify by fetching again
        await new Promise(r => setTimeout(r, 500)); // Small delay
        const verifyRes = await fetch(`${STRAPI_URL}/api/insights/${INSIGHT_ID}`);
        const verifyData = (await verifyRes.json()).data;

        console.log('\n=== FINAL VERIFICATION ===');
        if (verifyData) {
            console.log('Has code fences:', verifyData.body.includes('```'));
            console.log('Has (link) in content:', verifyData.body.includes('(link)'));
            console.log('Has correct MIT format:', verifyData.body.includes('](https://www.media.mit.edu/projects/gender-shades/overview/)'));
            console.log('Updated at:', verifyData.updatedAt);
        }

    } catch (e) {
        console.error('Error:', e);
    }
}

forceFixAndPublish();
