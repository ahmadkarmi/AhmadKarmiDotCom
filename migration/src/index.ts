#!/usr/bin/env node

import { CONFIG } from './config.js';
import { testConnection } from './uploaders/strapi.js';
import { migrateWorks } from './migrations/works.js';
import { migrateInsights } from './migrations/insights.js';
import { logger } from './utils/logger.js';

async function main() {
    const args = process.argv.slice(2);
    const worksOnly = args.includes('--works-only');
    const insightsOnly = args.includes('--insights-only');
    const dryRun = args.includes('--dry-run');

    if (dryRun) {
        process.env.DRY_RUN = 'true';
    }

    logger.section('Strapi Migration Script');
    logger.info(`Strapi URL: ${CONFIG.strapiUrl}`);
    logger.info(`Dry Run: ${CONFIG.dryRun || dryRun}`);

    // Test connection
    logger.info('Testing Strapi connection...');
    const connected = await testConnection();

    if (!connected) {
        logger.error('Cannot proceed without Strapi connection');
        logger.info('');
        logger.info('Make sure:');
        logger.info('1. Strapi is running (npm run develop in backend/)');
        logger.info('2. You have created an API token in Strapi Admin');
        logger.info('3. The token is set in migration/.env');
        logger.info('');
        logger.info('To create an API token:');
        logger.info('1. Go to Settings > API Tokens in Strapi Admin');
        logger.info('2. Create a new "Full Access" token');
        logger.info('3. Copy the token to STRAPI_API_TOKEN in .env');
        process.exit(1);
    }

    logger.success('Connected to Strapi!');

    const results = {
        works: { success: 0, failed: 0 },
        insights: { success: 0, failed: 0 },
    };

    // Run migrations
    if (!insightsOnly) {
        results.works = await migrateWorks();
    }

    if (!worksOnly) {
        results.insights = await migrateInsights();
    }

    // Summary
    logger.section('Migration Summary');

    if (!insightsOnly) {
        logger.info(`Works: ${results.works.success} success, ${results.works.failed} failed`);
    }

    if (!worksOnly) {
        logger.info(`Insights: ${results.insights.success} success, ${results.insights.failed} failed`);
    }

    const totalSuccess = results.works.success + results.insights.success;
    const totalFailed = results.works.failed + results.insights.failed;

    if (totalFailed === 0) {
        logger.success(`All ${totalSuccess} entries migrated successfully!`);
    } else {
        logger.warn(`Completed with ${totalFailed} failures`);
    }

    process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch((error) => {
    logger.error('Migration failed with error:');
    console.error(error);
    process.exit(1);
});
