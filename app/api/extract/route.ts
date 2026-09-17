import { NextResponse } from "next/server";
import { z } from "zod";
import { schemaSpecSchema } from "@/lib/schema";
import {
  BYO_MODELS,
  DEMO_MODEL,
  ExtractionError,
  MAX_TEXT_CHARS,
  runExtraction,
  summarize,
} from "@/lib/extract";
import { checkRateLimit, rateLimitHeaders } from "@/lib/ratelimit";
import { checkDemoBudget, recordDemoSpend } from "@/lib/budget";
import { computeCacheKey, getCachedRun, saveRun } from "@/lib/runs";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  text: z.string().min(1, "document is empty").max(MAX_TEXT_CHARS),
  fields: schemaSpecSchema,
  /** Set when the request came from a preloaded sample, for run analytics only. */
  sampleId: z.string().max(64).optional(),
  model: z.enum(BYO_MODELS).optional(),
});

export async function POST(req: Request) {
  const started = Date.now();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, "bad_request", "Body must be JSON.");
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_request",
        message: "Request did not validate.",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }

  const { text, fields, sampleId } = parsed.data;

  // BYO key arrives in a header, is used once, and is never logged or persisted.
  const byoKey = req.headers.get("x-openai-key")?.trim() || null;
  if (byoKey && !/^sk-[A-Za-z0-9_-]{20,}$/.test(byoKey)) {
    return fail(400, "invalid_api_key_format", "That doesn't look like an OpenAI API key.");
  }

  // Model choice is only exposed on the BYO path; the demo path is pinned for cost.
  const model = byoKey ? (parsed.data.model ?? DEMO_MODEL) : DEMO_MODEL;

  const cacheKey = computeCacheKey({ model, documentText: text, fields });

  // Cache lookup precedes the rate limit deliberately: sample documents are the common
  // case, cost nothing to serve, and shouldn't burn a visitor's quota before they've
  // tried their own schema.
  const cached = await getCachedRun(cacheKey);
  if (cached) {
    return NextResponse.json(
      {
        runId: cached.id,
        cached: true,
        model: cached.model,
        cells: cached.cells,
        stats: summarize(cached.cells),
        durationMs: Date.now() - started,
      },
      { headers: { "x-cache": "HIT" } },
    );
  }

  // Resolve the key before the limiter: a misconfigured server shouldn't burn a
  // visitor's hourly quota on a request that was never going to run.
  const apiKey = byoKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) return fail(503, "not_configured", "Demo key is not configured.");

  let limitHeaders: Record<string, string> = {};
  if (!byoKey) {
    // The day's budget is checked before the per-IP limiter for the same reason the key
    // is: a request that cannot run shouldn't consume a visitor's quota. Per-IP limiting
    // bounds one visitor; this bounds the bill.
    const budget = await checkDemoBudget();
    if (!budget.ok) {
      return NextResponse.json(
        {
          error: "demo_budget_exhausted",
          message:
            "The shared demo key has used up today's budget. Add your own OpenAI key to keep going — it resets at 00:00 UTC.",
          budgetUsd: budget.budgetUsd,
        },
        { status: 429 },
      );
    }

    const limit = await checkRateLimit(clientIp(req));
    limitHeaders = rateLimitHeaders(limit);
    if (!limit.ok) {
      return NextResponse.json(
        {
          error: "rate_limited",
          message:
            "Hourly limit reached for the shared demo key. Add your own OpenAI key to keep going.",
          resetAt: limit.resetAt,
        },
        { status: 429, headers: limitHeaders },
      );
    }
  }

  try {
    const result = await runExtraction({
      documentText: text,
      fields,
      apiKey,
      model,
      signal: AbortSignal.timeout(50_000),
    });

    const durationMs = Date.now() - started;

    // Meter what the shared key actually spent, using reported usage rather than an
    // estimate. BYO-key runs cost the demo nothing and are never counted.
    if (!byoKey) await recordDemoSpend(result.model, result.usage);

    const runId = await saveRun({
      cacheKey,
      model: result.model,
      sampleId,
      byoKey: Boolean(byoKey),
      fields,
      docChars: text.length,
      cells: result.cells,
      usage: result.usage,
      durationMs,
    });

    return NextResponse.json(
      {
        runId,
        cached: false,
        model: result.model,
        cells: result.cells,
        stats: summarize(result.cells),
        usage: byoKey ? result.usage : null,
        durationMs,
      },
      { headers: { ...limitHeaders, "x-cache": "MISS" } },
    );
  } catch (err) {
    if (err instanceof ExtractionError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: err.status, headers: limitHeaders },
      );
    }
    console.error("extract route failed", err);
    return fail(500, "unknown", "Extraction failed.");
  }
}

function clientIp(req: Request): string {
  const forwarded =
    req.headers.get("x-vercel-forwarded-for") ?? req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "0.0.0.0";
}

function fail(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}
