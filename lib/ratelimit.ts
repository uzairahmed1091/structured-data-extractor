import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Demo path only. Bring-your-own-key requests skip this entirely — they cost you nothing.
 *
 * Upstash rather than a Postgres counter because the free tier covers a portfolio demo
 * and it survives Vercel's per-instance isolation. The in-memory fallback exists so the
 * project runs with zero external setup on `pnpm dev`; it is not a production limiter.
 */

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
};

const LIMIT = 10;
const WINDOW = "1 h" as const;

const upstash =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Ratelimit({
        redis: Redis.fromEnv(),
        limiter: Ratelimit.slidingWindow(LIMIT, WINDOW),
        analytics: false,
        prefix: "extract",
      })
    : null;

const memory = new Map<string, number[]>();
const WINDOW_MS = 60 * 60 * 1000;

function memoryLimit(key: string): RateLimitResult {
  const now = Date.now();
  const hits = (memory.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  const ok = hits.length < LIMIT;
  if (ok) hits.push(now);
  memory.set(key, hits);
  if (memory.size > 5_000) memory.clear();
  return {
    ok,
    limit: LIMIT,
    remaining: Math.max(0, LIMIT - hits.length),
    resetAt: (hits[0] ?? now) + WINDOW_MS,
  };
}

export async function checkRateLimit(ip: string): Promise<RateLimitResult> {
  if (!upstash) return memoryLimit(ip);

  try {
    const res = await upstash.limit(ip);
    return {
      ok: res.success,
      limit: res.limit,
      remaining: res.remaining,
      resetAt: res.reset,
    };
  } catch {
    // Redis being down should not take the demo down. Fail open, per-instance.
    return memoryLimit(ip);
  }
}

export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  return {
    "x-ratelimit-limit": String(r.limit),
    "x-ratelimit-remaining": String(r.remaining),
    "x-ratelimit-reset": String(Math.ceil(r.resetAt / 1000)),
  };
}
