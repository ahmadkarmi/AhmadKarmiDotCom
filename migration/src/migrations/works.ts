import { resolve } from 'path';
import { parseCsv, parseGalleryUrls, parseStatus, parseBoolean, CsvRow } from '../parsers/csv.js';
import { htmlToMarkdown } from '../converters/html-to-markdown.js';
import { processImage, processGallery } from '../uploaders/media.js';
import { createEntry, findBySlug, publishEntry } from '../uploaders/strapi.js';
import { logger } from '../utils/logger.js';
import { CONFIG } from '../config.js';

export interface WorkEntry {
    name: string;
    slug: string;
    status: string;
    featured: boolean;
    brief: string;
    scope: string;
    details: string;
    mainImage?: number;
    client?: string;
    clientLogo?: number;
    videoUrl?: string;
    gallery?: number[];
}

/**
 * Transform a CSV row into a Work entry
 */
async function transformRow(row: CsvRow): Promise<WorkEntry> {
    const entry: WorkEntry = {
        name: row['Name'] || '',
        slug: row['Slug'] || row['Name']?.toLowerCase().replace(/\s+/g, '-') || '',
        status: parseStatus(row['Project status']),
        featured: parseBoolean(row['Featured project?']),
        brief: htmlToMarkdown(row['Project brief'] || ''),
        scope: htmlToMarkdown(row['Scope of work'] || ''),
        details: htmlToMarkdown(row['Project details'] || ''),
        client: row['Client'] || undefined,
        videoUrl: row['Youtube video'] || undefined,
    };

    // Process main image
    if (row['Main project image']) {
        const mainImageId = await processImage(row['Main project image']);
        if (mainImageId) entry.mainImage = mainImageId;
    }

    // Process client logo
    if (row['Client logo']) {
        const logoId = await processImage(row['Client logo']);
        if (logoId) entry.clientLogo = logoId;
    }

    // Process gallery images
    if (row['Image gallery']) {
        const galleryUrls = parseGalleryUrls(row['Image gallery']);
        if (galleryUrls.length > 0) {
            const galleryIds = await processGallery(galleryUrls);
            if (galleryIds.length > 0) entry.gallery = galleryIds;
        }
    }

    return entry;
}

/**
 * Migrate all Works from CSV to Strapi
 */
export async function migrateWorks(): Promise<{ success: number; failed: number }> {
    logger.section('Migrating Works');

    const csvPath = resolve(process.cwd(), CONFIG.worksCsv);
    logger.info(`Reading CSV: ${csvPath}`);

    const rows = await parseCsv(csvPath);
    logger.info(`Found ${rows.length} work entries`);

    let success = 0;
    let failed = 0;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const name = row['Name'] || `Entry ${i + 1}`;

        logger.progress(i + 1, rows.length, name);

        try {
            // Skip if entry already exists
            const existing = await findBySlug('works', row['Slug']);
            if (existing) {
                logger.newLine();
                logger.warn(`Skipping existing entry: ${name}`);
                success++; // Count as success since it exists
                continue;
            }

            // Transform and create entry
            const entry = await transformRow(row);

            const created = await createEntry('works', entry);
            if (created) {
                // Publish the entry
                if (!CONFIG.dryRun && created.documentId) {
                    await publishEntry('works', created.documentId);
                }
                success++;
            } else {
                failed++;
            }
        } catch (error: any) {
            logger.newLine();
            logger.error(`Failed to migrate: ${name}`);
            logger.debug(error.message);
            failed++;
        }
    }

    logger.newLine();
    logger.section('Works Migration Complete');
    logger.success(`Successfully migrated: ${success}`);
    if (failed > 0) {
        logger.error(`Failed: ${failed}`);
    }

    return { success, failed };
}
