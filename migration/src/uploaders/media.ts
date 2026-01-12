import axios from 'axios';
import FormData from 'form-data';
import { CONFIG, getHeaders } from '../config.js';
import { logger } from '../utils/logger.js';
import { retry } from '../utils/retry.js';

/**
 * Download an image from a URL and return as a Buffer
 */
export async function downloadImage(url: string): Promise<{ buffer: Buffer; filename: string; contentType: string } | null> {
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; MigrationBot/1.0)',
            },
        });

        // Extract filename from URL
        const urlParts = url.split('/');
        let filename = urlParts[urlParts.length - 1].split('?')[0];

        // Clean up filename
        filename = decodeURIComponent(filename).replace(/[^a-zA-Z0-9._-]/g, '_');

        // Ensure it has an extension
        if (!filename.includes('.')) {
            const contentType = response.headers['content-type'] || 'image/jpeg';
            const ext = contentType.split('/')[1]?.split(';')[0] || 'jpg';
            filename += `.${ext}`;
        }

        return {
            buffer: Buffer.from(response.data),
            filename,
            contentType: response.headers['content-type'] || 'image/jpeg',
        };
    } catch (error: any) {
        if (error.response?.status === 404) {
            logger.warn(`Image not found (404): ${url}`);
            return null;
        }
        throw error;
    }
}

/**
 * Upload an image to Strapi Media Library
 */
export async function uploadToStrapi(
    buffer: Buffer,
    filename: string,
    contentType: string
): Promise<number | null> {
    if (CONFIG.dryRun) {
        logger.debug(`[DRY RUN] Would upload: ${filename}`);
        return -1; // Return dummy ID for dry run
    }

    const form = new FormData();
    form.append('files', buffer, {
        filename,
        contentType,
    });

    const response = await axios.post(`${CONFIG.strapiUrl}/api/upload`, form, {
        headers: {
            Authorization: `Bearer ${CONFIG.apiToken}`,
            ...form.getHeaders(),
        },
        timeout: 60000,
    });

    const uploadedFile = response.data[0];
    if (!uploadedFile?.id) {
        throw new Error('Upload response did not include file ID');
    }

    return uploadedFile.id;
}

/**
 * Download and upload an image to Strapi
 * Returns the media ID or null if the image couldn't be processed
 */
export async function processImage(url: string): Promise<number | null> {
    if (!url) return null;

    try {
        return await retry(
            async () => {
                const image = await downloadImage(url);
                if (!image) return null;

                const mediaId = await uploadToStrapi(image.buffer, image.filename, image.contentType);
                return mediaId;
            },
            { maxRetries: 3, delay: 1000, label: `Image ${url.slice(-30)}` }
        );
    } catch (error: any) {
        logger.error(`Failed to process image: ${url}`);
        logger.debug(error.message);
        return null;
    }
}

/**
 * Process multiple images (for galleries)
 * Returns an array of media IDs
 */
export async function processGallery(urls: string[]): Promise<number[]> {
    const mediaIds: number[] = [];

    for (const url of urls) {
        const id = await processImage(url);
        if (id !== null) {
            mediaIds.push(id);
        }
    }

    return mediaIds;
}
