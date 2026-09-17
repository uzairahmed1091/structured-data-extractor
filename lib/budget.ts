import { Redis } from "@upstash/redis";

/**
 * A site-wide daily ceiling on what the shared demo key may spend.
 *
 * Per-IP rate limiting bounds what one visitor costs; it does not bound the total. Ten
 * requests an hour times an arbitrary number of addresses is an arbitrary bill, and this
 * demo is meant to sit on a public URL unattended for months. So the spend itself is
 * metered, and when the day's budget is gone the demo path closes and the UI steers
 * visitors to their own key — the app stays up, it just stops paying for strangers.
 *
 * The counter lives in Redis rather than Postgres because INCRBY is atomic and shared
 * across Vercel's per-instance isolation, and Upstash is already wired up for the rate
 * limiter. Without it we fall back to a per-instance counter, which is enough for local
 * development and better than nothing in production, but is not a global bound —
 * deploy with Upstash configured if the URL is public.
 */

export type BudgetState = {
  ok: boolean;
  spentUsd: number;
  budgetUsd: number;
  /** True when the number came from a per-instance counter rather than Redis. */
  degraded: boolean;
};

/** USD per 1M tokens, verified against OpenAI's model pages 2026-09-17. */
const PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-5.6-luna": { input: 0.2, output: 1.2 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5 },
};

/**
 * Deliberately pessimistic. An unrecognised model must never meter as free — the failure
 * mode of guessing high is a demo that closes early, and of guessing low is a bill.
 */
const UNKNOWN_MODEL_PRICING = { input: 5, output: 15 };

const DEFAULT_BUDGET_USD = 0.2;

function budgetUsd(): number {
  const raw = Number(process.env.DEMO_DAILY_BUDGET_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_BUDGET_USD;
}

/**
 * The API returns a resolved snapshot id (`gpt-4o-mini-2024-07-18`), so match on the
 * longest configured prefix rather than requiring an exact hit.
 */
function priceFor(model: string) {
  if (PRICING[model]) return PRICING[model];

  let best: { input: number; output: number } | null = null;
  let bestLength = 0;
  for (const [id, price] of Object.entries(PRICING)) {
    if (model.startsWith(id) && id.length > bestLength) {
      best = price;
      bestLength = id.length;
    }
  }
  return best ?? UNKNOWN_MODEL_PRICING;
}

export function estimateCostUsd(
  model: string,
  usage: { promptTokens: number; completionTokens: number } | null,
): number {
  if (!usage) return 0;
  const price = priceFor(model);
  return (
    (usage.promptTokens * price.input + usage.completionTokens * price.output) / 1_000_000
  );
}

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null;

/** Micro-dollars, so the shared counter stays integral and INCRBY stays atomic. */
const MICROS_PER_USD = 1_000_000;
const KEY_TTL_SECONDS = 60 * 60 * 48;

function dayKey(): string {
  return `extract:spend:${new Date().toISOString().slice(0, 10)}`;
}

let localDay = "";
let localMicros = 0;

function localSpend(addMicros = 0): number {
  const key = dayKey();
  if (key !== localDay) {
    localDay = key;
    localMicros = 0;
  }
  localMicros += addMicros;
  return localMicros;
}

export async function checkDemoBudget(): Promise<BudgetState> {
  const budget = budgetUsd();

  if (!redis) {
    const spentUsd = localSpend() / MICROS_PER_USD;
    return { ok: spentUsd < budget, spentUsd, budgetUsd: budget, degraded: true };
  }

  try {
    const micros = (await redis.get<number>(dayKey())) ?? 0;
    const spentUsd = micros / MICROS_PER_USD;
    return { ok: spentUsd < budget, spentUsd, budgetUsd: budget, degraded: false };
  } catch {
    // Redis being unreachable should not take the demo down, but it does mean the bound
    // is now per-instance. Degraded, not off.
    const spentUsd = localSpend() / MICROS_PER_USD;
    return { ok: spentUsd < budget, spentUsd, budgetUsd: budget, degraded: true };
  }
}

/** Call once per completed demo-path extraction, with the usage the API actually reported. */
export async function recordDemoSpend(
  model: string,
  usage: { promptTokens: number; completionTokens: number } | null,
): Promise<void> {
  const micros = Math.ceil(estimateCostUsd(model, usage) * MICROS_PER_USD);
  if (micros <= 0) return;

  // Always advance the local counter: if Redis is down this is the only bound there is.
  localSpend(micros);
  if (!redis) return;

  try {
    const key = dayKey();
    const total = await redis.incrby(key, micros);
    // First write of the day creates the key; give it a TTL so old days evict themselves.
    if (total === micros) await redis.expire(key, KEY_TTL_SECONDS);
  } catch {
    // Metering is best-effort. A dropped increment under-counts; it never fails a request
    // the user already paid for in latency.
  }
}
