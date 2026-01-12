import { config } from 'dotenv';
import fs from 'fs';
import path from 'path';

config();

let apiToken = process.env.STRAPI_API_TOKEN || '';

if (!apiToken) {
    try {
        // Try to read bootstrap token from backend
        // Assuming running from migration root
        const tokenPath = path.resolve('../backend/TOKEN.txt');
        if (fs.existsSync(tokenPath)) {
            apiToken = fs.readFileSync(tokenPath, 'utf-8').trim();
            console.log('Found bootstrap token in backend/TOKEN.txt');
        }
    } catch (e) {
        console.warn('Could not read bootstrap token:', e);
    }
}

export const CONFIG = {
    strapiUrl: process.env.STRAPI_URL || 'http://localhost:1337',
    apiToken,
    worksCsv: process.env.WORKS_CSV || '../CMS-Migration/Ahmad Al-Karmi - My Works.csv',
    insightsCsv: process.env.INSIGHTS_CSV || '../CMS-Migration/Ahmad Al-Karmi - Articles & Insights.csv',
    dryRun: process.env.DRY_RUN === 'true',
};

export function getHeaders() {
    return {
        Authorization: `Bearer ${CONFIG.apiToken}`,
        'Content-Type': 'application/json',
    };
}
