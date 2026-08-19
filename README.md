# Cited Extract

Define a schema, paste a document, get back typed and validated JSON where **every value
carries a citation to the exact span it came from**, and **fields the document doesn't
contain come back `null`** rather than a plausible guess.

<!-- TODO(evening 3): demo.gif — load the services agreement, run it, hover a row to move
     the highlight, then point at the null. ~20s, no cursor hunting. -->

## The two guarantees, and how they're enforced

Neither is a prompt instruction we hope the model follows. Both are enforced in code, in
`verifyCells()` (`lib/extract.ts`).

**Citations.** The response schema makes every cell a `{ value, quote }` pair — the model
structurally cannot return a value without committing to a source quote. Models can't emit
reliable character offsets, so the server locates the quote itself (`lib/locate.ts`):
exact `indexOf` first, then a normalized match that survives line breaks, non-breaking
spaces, ligatures, smart quotes, em dashes, and accents in PDF text layers, with an index
map back to original offsets.

**Nulls.** A value survives only if it passes its declared Zod validator *and* its quote
resolves to a real span. Anything else is demoted to `null`. A value whose citation can't
be found in the source is indistinguishable from a confident fabrication, so it's treated
as one — the model's original output is kept in `rejected` and shown struck through in the
UI. Four statuses, four distinct renderings:

| status | meaning |
| --- | --- |
| `found` | value validated, quote located |
| `not_found` | document is silent — the correct answer |
| `unverified` | value arrived with a citation that isn't in the document. Discarded. |
| `invalid` | value failed its declared type. Discarded. |

## Architecture

```
lib/schema.ts     FieldSpec[] -> (a) JSON Schema for OpenAI strict mode
                                 (b) Zod validators for response + export
lib/locate.ts     quote -> character span, with normalization + offset mapping
lib/extract.ts    prompt, model call, per-cell validation and citation verification
lib/runs.ts       Supabase persistence, doubling as the content-addressed cache
lib/ratelimit.ts  Upstash sliding window, in-memory fallback for local dev
```

The JSON Schema is written by hand rather than generated from Zod. Strict mode requires
`additionalProperties: false` everywhere, every property in `required`, optionality only
as nullable unions, and rejects `format`/`pattern` — generating it directly is less code
than post-processing a generated schema into compliance.

## Running cheaply, unattended

- `gpt-4o-mini` pinned on the demo path; model choice only unlocks with your own key.
- Documents capped at 60k chars, schemas at 25 fields, output at `256 + 150/field` tokens.
- Runs are content-addressed by `sha256(PROMPT_VERSION, model, text, canonical schema)`.
  Preloaded samples warm their own cache on first visit; bumping `PROMPT_VERSION`
  invalidates everything.
- **Cache lookup runs before the rate limiter.** Samples are the common path, cost nothing
  to serve, and shouldn't burn a visitor's quota before they've tried their own schema.
- 10 requests/hour/IP on the shared key. Bring-your-own-key skips the limiter entirely.
- BYO keys arrive in a header, are used once, and are never logged or persisted.

## Setup

```bash
npm install
cp .env.example .env.local   # OPENAI_API_KEY at minimum
npm run dev
```

Supabase and Upstash are both optional locally — without them, caching is skipped and the
rate limiter falls back to per-instance memory. The `extraction_runs` DDL is in the header
comment of `lib/runs.ts`.

Document text is deliberately **not** persisted. The client already holds it and sends it
back for re-render, so there is nothing to reconstruct server-side and one less pile of
strangers' pasted text at rest. Runs prune after 30 days.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind v4 · Zod 4 · OpenAI structured outputs ·
Supabase · Upstash · Vercel

## Status

- [x] Evening 1 — schema builder, paste-text input, schema→Zod, extraction, results table
- [ ] Evening 2 — PDF upload, citation highlighting, JSON/CSV export
- [ ] Evening 3 — three sample documents, Supabase persistence, rate limiting, deploy
