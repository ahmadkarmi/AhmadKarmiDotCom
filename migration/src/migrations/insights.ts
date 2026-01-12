import { resolve } from 'path';
import { parseCsv, parseTags, parseDate, parseBoolean, CsvRow } from '../parsers/csv.js';
import { htmlToMarkdown } from '../converters/html-to-markdown.js';
import { processImage } from '../uploaders/media.js';
import { createEntry, findBySlug, publishEntry } from '../uploaders/strapi.js';
import { logger } from '../utils/logger.js';
import { CONFIG } from '../config.js';

export interface InsightEntry {
    name: string;
    slug: string;
    featured: boolean;
    tags: string[];
    publishDate?: string;
    description: string;
    body: string;
    mainImage?: number;
    thumbnailImage?: number;
}

/**
 * Transform a CSV row into an Insight entry
 */
async function transformRow(row: CsvRow): Promise<InsightEntry> {
    const entry: InsightEntry = {
        name: row['Name'] || '',
        slug: row['Slug'] || row['Name']?.toLowerCase().replace(/\s+/g, '-') || '',
        featured: parseBoolean(row['Featured?']),
        tags: parseTags(row['Tags'] || ''),
        publishDate: parseDate(row['Datepublished']) || undefined,
        description: row['Post Description'] || '',
        body: htmlToMarkdown(row['Post body'] || ''),
    };

    // Process main image
    if (row['Main image']) {
        const mainImageId = await processImage(row['Main image']);
        if (mainImageId) entry.mainImage = mainImageId;
    }

    // Process thumbnail image
    if (row['Thumbnail image']) {
        const thumbnailId = await processImage(row['Thumbnail image']);
        if (thumbnailId) entry.thumbnailImage = thumbnailId;
    }

    return entry;
}

/**
 * Migrate all Insights from CSV to Strapi
 */
export async function migrateInsights(): Promise<{ success: number; failed: number }> {
    logger.section('Migrating Insights');

    const csvPath = resolve(process.cwd(), CONFIG.insightsCsv);
    logger.info(`Reading CSV: ${csvPath}`);

    const rows = await parseCsv(csvPath);
    logger.info(`Found ${rows.length} insight entries`);

    let success = 0;
    let failed = 0;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const name = row['Name'] || `Entry ${i + 1}`;

        logger.progress(i + 1, rows.length, name.slice(0, 50));

        try {
            // Skip if entry already exists
            const existing = await findBySlug('insights', row['Slug']);
            if (existing) {
                logger.newLine();
                logger.warn(`Skipping existing entry: ${name.slice(0, 50)}`);
                success++; // Count as success since it exists
                continue;
            }

            // Transform and create entry
            const entry = await transformRow(row);

            const created = await createEntry('insights', entry);
            if (created) {
                // Publish the entry
                if (!CONFIG.dryRun && created.documentId) {
                    await publishEntry('insights', created.documentId);
                }
                success++;
            } else {
                failed++;
            }
        } catch (error: any) {
            logger.newLine();
            logger.error(`Failed to migrate: ${name.slice(0, 50)}`);
            logger.debug(error.message);
            failed++;
        }
    }

    logger.newLine();
    logger.section('Insights Migration Complete');
    logger.success(`Successfully migrated: ${success}`);
    if (failed > 0) {
        logger.error(`Failed: ${failed}`);
    }

    return { success, failed };
}
