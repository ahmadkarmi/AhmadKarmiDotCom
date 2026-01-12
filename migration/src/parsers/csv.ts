import { createReadStream } from 'fs';
import { parse } from 'csv-parse';
import { logger } from '../utils/logger.js';

export interface CsvRow {
    [key: string]: string;
}

export async function parseCsv(filePath: string): Promise<CsvRow[]> {
    return new Promise((resolve, reject) => {
        const records: CsvRow[] = [];

        const parser = createReadStream(filePath)
            .pipe(
                parse({
                    columns: true,
                    skip_empty_lines: true,
                    relax_quotes: true,
                    relax_column_count: true,
                    trim: true,
                })
            );

        parser.on('data', (row: CsvRow) => {
            records.push(row);
        });

        parser.on('error', (error) => {
            logger.error(`CSV parsing error: ${error.message}`);
            reject(error);
        });

        parser.on('end', () => {
            logger.success(`Parsed ${records.length} records from CSV`);
            resolve(records);
        });
    });
}

/**
 * Parse tags from a comma-separated string
 */
export function parseTags(tagString: string): string[] {
    if (!tagString) return [];
    return tagString
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
}

/**
 * Parse gallery URLs from a semicolon-separated string
 */
export function parseGalleryUrls(galleryString: string): string[] {
    if (!galleryString) return [];
    return galleryString
        .split(';')
        .map((url) => url.trim())
        .filter(Boolean);
}

/**
 * Parse a date string to ISO format
 */
export function parseDate(dateString: string): string | null {
    if (!dateString) return null;
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return null;
        return date.toISOString().split('T')[0]; // YYYY-MM-DD format
    } catch {
        return null;
    }
}

/**
 * Parse boolean from various string formats
 */
export function parseBoolean(value: string): boolean {
    if (!value) return false;
    const normalized = value.toLowerCase().trim();
    return normalized === 'true' || normalized === 'yes' || normalized === '1';
}

/**
 * Normalize project status from CSV to enum values
 */
export function parseStatus(status: string): string {
    if (!status) return 'completed';
    const normalized = status.toLowerCase();

    if (normalized.includes('completed') || normalized.includes('✅')) {
        return 'completed';
    }
    if (normalized.includes('proposal') || normalized.includes('📃')) {
        return 'proposal';
    }
    if (normalized.includes('concept') || normalized.includes('💭')) {
        return 'concept';
    }
    if (normalized.includes('progress') || normalized.includes('⌚')) {
        return 'in_progress';
    }

    return 'completed';
}
