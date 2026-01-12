/**
 * Media Migration Script: Strapi to WordPress
 * 
 * This script uploads images from the Strapi uploads folder to WordPress Media Library
 * 
 * Usage: node upload-media-to-wp.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WP_URL = process.env.WP_URL || 'https://admin.ahmadkarmi.com';
const WP_USER = process.env.WP_USER || '';
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD || '';
const UPLOADS_DIR = path.join(__dirname, 'backend/public/uploads');

if (!WP_USER || !WP_APP_PASSWORD) {
    throw new Error('Missing required environment variables: WP_USER and/or WP_APP_PASSWORD');
}

const WP_AUTH = Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString('base64');

// Only upload original files (skip thumbnails, small, medium, large versions)
function isOriginalFile(filename) {
    if (filename.startsWith('.')) return false;
    if (filename.startsWith('thumbnail_')) return false;
    if (filename.startsWith('small_')) return false;
    if (filename.startsWith('medium_')) return false;
    if (filename.startsWith('large_')) return false;

    const ext = path.extname(filename).toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf'].includes(ext);
}

async function uploadToWordPress(filePath, filename) {
    try {
        const fileBuffer = fs.readFileSync(filePath);
        const mimeType = getMimeType(filename);

        const response = await fetch(`${WP_URL}/wp-json/wp/v2/media`, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${WP_AUTH}`,
                'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
                'Content-Type': mimeType,
            },
            body: fileBuffer,
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`  ✗ Failed: ${response.status} - ${errorText.substring(0, 100)}...`);
            return null;
        }

        const media = await response.json();
        return media;
    } catch (error) {
        console.error(`  ✗ Error: ${error.message}`);
        return null;
    }
}

function getMimeType(filename) {
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.pdf': 'application/pdf',
    };
    return mimeTypes[ext] || 'application/octet-stream';
}

async function main() {
    console.log('🚀 Starting Media Upload to WordPress');
    console.log(`   Source: ${UPLOADS_DIR}`);
    console.log(`   Destination: ${WP_URL}`);
    console.log('');

    if (!fs.existsSync(UPLOADS_DIR)) {
        console.error('❌ Uploads directory not found!');
        return;
    }

    const files = fs.readdirSync(UPLOADS_DIR).filter(isOriginalFile);
    console.log(`📁 Found ${files.length} original files to upload\n`);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < files.length; i++) {
        const filename = files[i];
        const filePath = path.join(UPLOADS_DIR, filename);

        console.log(`[${i + 1}/${files.length}] Uploading: ${filename}`);

        const result = await uploadToWordPress(filePath, filename);
        if (result) {
            console.log(`  ✓ Uploaded (ID: ${result.id})`);
            successCount++;
        } else {
            failCount++;
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 300));
    }

    console.log('\n✅ Upload Complete!');
    console.log(`   Success: ${successCount}`);
    console.log(`   Failed: ${failCount}`);
}

main();
