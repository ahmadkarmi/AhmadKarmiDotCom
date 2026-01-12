import axios from 'axios';
import { CONFIG, getHeaders } from '../config.js';
import { logger } from '../utils/logger.js';
import { retry } from '../utils/retry.js';

export interface StrapiEntry {
    id: number;
    documentId: string;
    [key: string]: any;
}

export interface CreateEntryPayload {
    data: Record<string, any>;
}

/**
 * Create an entry in a Strapi collection
 */
export async function createEntry(
    collectionName: string,
    data: Record<string, any>
): Promise<StrapiEntry | null> {
    if (CONFIG.dryRun) {
        logger.debug(`[DRY RUN] Would create ${collectionName}: ${data.name || data.slug}`);
        return { id: -1, documentId: 'dry-run', ...data };
    }

    const payload: CreateEntryPayload = { data };

    return await retry(
        async () => {
            const response = await axios.post(
                `${CONFIG.strapiUrl}/api/${collectionName}`,
                payload,
                {
                    headers: getHeaders(),
                    timeout: 30000,
                }
            );

            return response.data.data;
        },
        { maxRetries: 3, delay: 1000, label: `Create ${collectionName}` }
    );
}

/**
 * Update an entry in a Strapi collection
 */
export async function updateEntry(
    collectionName: string,
    documentId: string,
    data: Record<string, any>
): Promise<StrapiEntry | null> {
    if (CONFIG.dryRun) {
        logger.debug(`[DRY RUN] Would update ${collectionName}/${documentId}`);
        return { id: -1, documentId, ...data };
    }

    const payload: CreateEntryPayload = { data };

    return await retry(
        async () => {
            const response = await axios.put(
                `${CONFIG.strapiUrl}/api/${collectionName}/${documentId}`,
                payload,
                {
                    headers: getHeaders(),
                    timeout: 30000,
                }
            );

            return response.data.data;
        },
        { maxRetries: 3, delay: 1000, label: `Update ${collectionName}` }
    );
}

/**
 * Check if an entry with a specific slug already exists
 */
export async function findBySlug(
    collectionName: string,
    slug: string
): Promise<StrapiEntry | null> {
    try {
        const response = await axios.get(
            `${CONFIG.strapiUrl}/api/${collectionName}`,
            {
                params: {
                    'filters[slug][$eq]': slug,
                },
                headers: getHeaders(),
            }
        );

        const entries = response.data.data;
        return entries.length > 0 ? entries[0] : null;
    } catch (error: any) {
        logger.debug(`Error finding ${collectionName} by slug: ${error.message}`);
        return null;
    }
}

/**
 * Publish an entry (change status from draft to published)
 */
export async function publishEntry(
    collectionName: string,
    documentId: string
): Promise<void> {
    if (CONFIG.dryRun) {
        logger.debug(`[DRY RUN] Would publish ${collectionName}/${documentId}`);
        return;
    }

    await retry(
        async () => {
            await axios.post(
                `${CONFIG.strapiUrl}/api/${collectionName}/${documentId}/actions/publish`,
                {},
                {
                    headers: getHeaders(),
                    timeout: 30000,
                }
            );
        },
        { maxRetries: 3, delay: 1000, label: `Publish ${collectionName}` }
    );
}

/**
 * Test the Strapi connection
 */
export async function testConnection(): Promise<boolean> {
    try {
        await axios.get(`${CONFIG.strapiUrl}/api/content-type-builder/content-types`, {
            headers: getHeaders(),
            timeout: 10000,
        });
        return true;
    } catch (error: any) {
        if (error.response?.status === 401) {
            logger.error('Invalid API token - please check your STRAPI_API_TOKEN');
        } else if (error.code === 'ECONNREFUSED') {
            logger.error('Cannot connect to Strapi - is the server running?');
        } else {
            logger.error(`Connection test failed: ${error.message}`);
        }
        return false;
    }
}
