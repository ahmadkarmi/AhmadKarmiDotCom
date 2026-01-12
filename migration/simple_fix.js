// Simple direct fix for content
const STRAPI_URL = 'http://localhost:1337';
const TOKEN = '0e68750917043287c8e95d1b6d9ecd15064c13549d0f49c0a6175507fc018cd6e936f21d8b8ea0462ca3cc2e9bf86919b562962e768e56d4d5fbee445d0ad4809bdeac1100a752cd37788e979ba3d6f55eda6cb4b1906e70d07646afa828d9a1d4396816d44a3e64e03c1cb291d34e5674d9ed549bfbf283ff6cdc093cc17294';
const INSIGHT_ID = 'h8bm3ksq98pdpwd19kvzisjp';

async function fix() {
    try {
        // Fetch current
        const res = await fetch(`${STRAPI_URL}/api/insights/${INSIGHT_ID}`, {
            headers: { Authorization: `Bearer ${TOKEN}` }
        });
        const article = (await res.json()).data;
        if (!article) { console.error('Not found'); return; }

        let body = article.body;

        // Fix 1: Remove code fences
        body = body.replace(/```\n*<iframe/g, '<iframe');
        body = body.replace(/<\/iframe>\n*```/g, '</iframe>');

        // Fix 2: Replace broken MIT link line
        // Find the line and replace it entirely
        const lines = body.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('[MIT Media Lab') && (lines[i].includes('(link)') || lines[i].includes('**]'))) {
                console.log('Found broken line at index', i);
                console.log('Before:', lines[i]);
                lines[i] = '[MIT Media Lab\'s "Gender Shades" research](https://www.media.mit.edu/projects/gender-shades/overview/)';
                console.log('After:', lines[i]);
            }
        }
        body = lines.join('\n');

        // Update
        const updateRes = await fetch(`${STRAPI_URL}/api/insights/${INSIGHT_ID}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${TOKEN}`
            },
            body: JSON.stringify({ data: { body } })
        });

        if (updateRes.ok) {
            console.log('Updated successfully!');

            // Verify immediately
            const check = await fetch(`${STRAPI_URL}/api/insights/${INSIGHT_ID}`);
            const checkData = (await check.json()).data;
            console.log('\nVerification:');
            console.log('- iframe without code fences:', !checkData.body.includes('```') || !checkData.body.includes('```\n<iframe'));
            console.log('- MIT link fixed:', checkData.body.includes('](https://www.media.mit.edu/projects/gender-shades/overview/)'));
        } else {
            console.error('Update failed:', await updateRes.text());
        }
    } catch (e) {
        console.error('Error:', e);
    }
}

fix();
