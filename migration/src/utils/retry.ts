import { logger } from './logger.js';

export async function retry<T>(
    fn: () => Promise<T>,
    options: { maxRetries?: number; delay?: number; label?: string } = {}
): Promise<T> {
    const { maxRetries = 3, delay = 1000, label = 'operation' } = options;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error: any) {
            const isLastAttempt = attempt === maxRetries;

            if (isLastAttempt) {
                logger.error(`${label} failed after ${maxRetries} attempts`);
                throw error;
            }

            logger.warn(`${label} failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms...`);
            await sleep(delay * attempt); // Exponential backoff
        }
    }

    throw new Error('Unreachable');
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
