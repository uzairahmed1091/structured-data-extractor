# Cited Extract

Define a schema, paste a document, get back typed and validated JSON where **every value
carries a citation to the exact span it came from**, and **fields the document doesn't
contain come back `null`** rather than a plausible guess.

**[Live demo](https://structured-data-extractor.vercel.app/)** · runs on `gpt-4o-mini`,
no sign-up. The preloaded sample documents are served from cache and cost nothing; running
your own document needs your own OpenAI key, pasted into the field in the UI and used for
that one request.

<!-- TODO: demo.gif — load the insurance declarations sample, run it, click the dwelling
     limit to pin its highlight, then point at the earthquake field coming back null.
     ~20s, no cursor hunting. -->

## Why this exists

Extraction demos are easy to make look good and hard to trust. A model asked for twelve
fields will return twelve fields, and the two that aren't in the document look exactly
like the ten that are. This project is an argument that the interesting engineering isn't
the prompt — it's everything you do to the model's answer before showing it to anyone.

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

### What this does not prove

Span verification proves a quote **exists** in the source. It does not prove the quote
**supports** the value. A model that answers a question about flood deductibles by quoting
the wind deductible line produces a wrong value with a real citation, and this pipeline
will pass it as `found`. Catching that needs an entailment check — a second model call
scoring quote-against-value — which is a real cost increase for a demo that has to run
unattended, so it isn't here.

What verification does buy is the elimination of the *silent* failure: a fabricated value
attached to a fabricated quote, which is the common case, cannot survive. The sample
documents are written so their absent fields have no near-miss text to grab, which makes
them honest tests of the null path rather than coin flips.

## Architecture

```
lib/schema.ts     FieldSpec[] -> (a) JSON Schema for OpenAI strict mode
                                 (b) Zod validators for response + export
lib/locate.ts     quote -> character span, with normalization + offset mapping
lib/extract.ts    prompt, model call, per-cell validation and citation verification
lib/runs.ts       Supabase persistence, doubling as the content-addressed cache
lib/ratelimit.ts  Upstash sliding window, in-memory fallback for local dev
lib/budget.ts     site-wide daily spend ceiling on the shared key
lib/samples.ts    three documents, each with at least one genuinely absent field
```

The JSON Schema is written by hand rather than generated from Zod. Strict mode requires
`additionalProperties: false` everywhere, every property in `required`, optionality only
as nullable unions, and rejects `format`/`pattern` — generating it directly is less code
than post-processing a generated schema into compliance.

The client holds the document text and posts it back for re-render. Citation offsets index
into the exact string that was sent to the model, so the highlighted view is handed that
same captured string rather than the live editor value — re-parsing or re-normalizing
before rendering would drift every span.

## Running cheaply, unattended

This is a public demo on someone's personal OpenAI key, so cost is a design constraint
rather than an afterthought.

- `gpt-4o-mini` pinned on the demo path; model choice only unlocks with your own key.
- Documents capped at 60k chars, schemas at 25 fields, output at `256 + 150/field` tokens.
- Runs are content-addressed by `sha256(PROMPT_VERSION, model, text, canonical schema)`.
  Preloaded samples warm their own cache on first visit; bumping `PROMPT_VERSION`
  invalidates everything.
- **Cache lookup runs before the rate limiter.** Samples are the common path, cost nothing
  to serve, and shouldn't burn a visitor's quota before they've tried their own schema.
- 10 requests/hour/IP on the shared key.
- **A site-wide daily spend ceiling** (`DEMO_DAILY_BUDGET_USD`) on top of that. Per-IP
  limiting bounds what one visitor costs; it does not bound the total, and ten requests an
  hour times an arbitrary number of addresses is an arbitrary bill. Spend is metered from
  reported usage into an atomic Redis counter; when the day's budget is gone the demo path
  closes and the UI asks for your own key. The app stays up, it just stops paying for
  strangers.
- Bring-your-own keys skip the limiter and the budget entirely, arrive in a header, are
  used once, and are never logged or persisted.
- Stored runs prune after 30 days; sample runs are exempt so the cache stays warm.

**Document text is deliberately not persisted.** The client already holds it and sends it
back for re-render, so there is nothing to reconstruct server-side and one less pile of
strangers' pasted text at rest. What's stored is the cells, the schema, token usage, and
timings.

## Setup

```bash
npm install
cp .env.example .env.local   # OPENAI_API_KEY at minimum
npm run dev
```

Supabase and Upstash are both optional locally — without them, caching is skipped, the
rate limiter falls back to per-instance memory, and so does the spend counter. Deploy with
Upstash configured if the URL is public: a per-instance counter is not a global bound.

Database schema is in `supabase/migrations/`; apply it with `supabase db push`. RLS is
enabled with no policies, so the server connects with the **secret** key — the publishable
key is the anon role and cannot bypass RLS, which fails silently rather than loudly.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind v4 · Zod 4 · OpenAI structured outputs ·
Supabase · Upstash · Vercel

## Not built

Honest list, rather than a roadmap that ages badly:

- **PDF upload.** Text paste only for now. `lib/locate.ts` already normalizes the things a
  PDF text layer does to a quote, but nothing extracts the text yet.
- **JSON/CSV export.** `toPlainRecord` and `buildOutputSchema` exist and are unused.
- **Entailment checking.** See *What this does not prove* above.

## License

MIT — see [LICENSE](LICENSE).
