// Fix the MIT link with curly quotes
const STRAPI_URL = 'http://localhost:1337';
const TOKEN = '0e68750917043287c8e95d1b6d9ecd15064c13549d0f49c0a6175507fc018cd6e936f21d8b8ea0462ca3cc2e9bf86919b562962e768e56d4d5fbee445d0ad4809bdeac1100a752cd37788e979ba3d6f55eda6cb4b1906e70d07646afa828d9a1d4396816d44a3e64e03c1cb291d34e5674d9ed549bfbf283ff6cdc093cc17294';
const INSIGHT_ID = 'h8bm3ksq98pdpwd19kvzisjp';

async function fixMitLink() {
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

        // Debug: Find exactly what's around Gender Shades
        const idx = body.indexOf('Gender Shades');
        if (idx > -1) {
            console.log('=== CURRENT CONTENT (raw bytes) ===');
            const snippet = body.substring(idx - 20, idx + 150);
            console.log(snippet);
            console.log('Hex:', Buffer.from(snippet).toString('hex'));
        }

        // Try multiple patterns - with curly quotes
        // Pattern with curly/smart quotes: "Gender Shades" (U+201C and U+201D)
        const patterns = [
            /\[MIT Media Lab's "Gender Shades" research\][^\n]+/g,      // curly quotes
            /\[MIT Media Lab's "Gender Shades" research\][^\n]+/g,  // straight quotes
            /\[MIT Media Lab[^\]]*Gender Shades[^\]]*\][^\n]+/gi,   // flexible
        ];

        let changed = false;
        for (const pattern of patterns) {
            const newBody = body.replace(pattern, '[MIT Media Lab\'s "Gender Shades" research](https://www.media.mit.edu/projects/gender-shades/overview/)');
            if (newBody !== body) {
                body = newBody;
                changed = true;
                console.log('Pattern matched and replaced!');
                break;
            }
        }

        if (!changed) {
            console.log('No pattern matched. Trying direct string replace...');
            // Try direct approach - find and replace the broken section
            const brokenStart = body.indexOf('[MIT Media Lab');
            const brokenEnd = body.indexOf('(link)');

            if (brokenStart !== -1 && brokenEnd !== -1 && brokenEnd > brokenStart) {
                const brokenSection = body.substring(brokenStart, brokenEnd + 6);
                console.log('Found broken section:', brokenSection);
                body = body.replace(brokenSection, '[MIT Media Lab\'s "Gender Shades" research](https://www.media.mit.edu/projects/gender-shades/overview/)');
                changed = true;
            }
        }

        if (!changed) {
            console.log('Could not fix the MIT link.');
            return;
        }

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
            console.log('Successfully fixed MIT link!');
        } else {
            console.error('Update failed:', JSON.stringify(updateJson, null, 2));
        }

    } catch (error) {
        console.error('Error:', error);
    }
}

fixMitLink();
