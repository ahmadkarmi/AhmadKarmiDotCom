import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// Free-tier defaults: 20 questions per IP per rolling 1 hour.
// Logged-in upgrade tier comes later; for now everyone is anonymous.
const LIMIT = 20;
const WINDOW = '1 h' as const;

let cachedLimiter: Ratelimit | null = null;

function getLimiter(): Ratelimit | null {
  if (cachedLimiter) return cachedLimiter;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  const redis = new Redis({ url, token });
  cachedLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(LIMIT, WINDOW),
    analytics: true,
    prefix: 'ask-ahmad',
  });
  return cachedLimiter;
}

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  reset: number; // unix ms
}

export async function checkRateLimit(identifier: string): Promise<RateLimitResult> {
  const limiter = getLimiter();
  if (!limiter) {
    // Without Upstash configured, allow but warn.
    return { ok: true, limit: LIMIT, remaining: LIMIT, reset: Date.now() + 3600_000 };
  }
  const result = await limiter.limit(identifier);
  return {
    ok: result.success,
    limit: result.limit,
    remaining: result.remaining,
    reset: result.reset,
  };
}

export function clientIdentifier(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for') ?? '';
  const ip = fwd.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'anon';
  // Mix in user-agent so two visitors behind the same NAT don't share a bucket.
  const ua = req.headers.get('user-agent') ?? '';
  return `${ip}:${hash(ua)}`;
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}
