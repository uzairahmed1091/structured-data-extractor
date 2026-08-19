/**
 * Resolves a model-returned quote to a character span in the original document.
 *
 * The model is asked for a verbatim quote, and usually complies — but PDF text layers
 * introduce soft hyphens, non-breaking spaces, ligatures, and line breaks mid-sentence,
 * and models silently normalize those away. So: try exact indexOf first, then match in a
 * normalized space while keeping an index map back to original offsets.
 *
 * Offsets are into the exact string that was sent to the model. Whatever produces that
 * string (pdf parse, textarea) must hand the *same* string to the highlighter, or spans
 * will drift. Store the extracted text alongside the run; don't re-parse for rendering.
 */

export type Span = { start: number; end: number };

const CHAR_ALIASES: Record<string, string> = {
  "\u2018": "'",
  "\u2019": "'",
  "\u201a": "'",
  "\u201b": "'",
  "\u201c": '"',
  "\u201d": '"',
  "\u201e": '"',
  "\u2013": "-",
  "\u2014": "-",
  "\u2212": "-",
  "\u00ad": "", // soft hyphen
  "\u200b": "", // zero-width space
  "\ufeff": "",
  "\u00a0": " ",
  "\u2026": "...",
};

type Normalized = { text: string; map: number[] };

/**
 * Lowercase, strip accents, expand ligatures, collapse whitespace runs to one space.
 * `map[i]` is the index in `src` that produced normalized character `i`.
 */
function normalizeWithMap(src: string): Normalized {
  const out: string[] = [];
  const map: number[] = [];
  let pendingSpace = false;

  for (let i = 0; i < src.length; i++) {
    const raw = src[i];
    const aliased = CHAR_ALIASES[raw] ?? raw;
    if (aliased === "") continue;

    if (/\s/.test(aliased)) {
      pendingSpace = out.length > 0;
      continue;
    }

    // NFKD + combining-mark strip handles é -> e and ﬁ -> fi.
    const folded = aliased.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
    if (!folded) continue;

    if (pendingSpace) {
      out.push(" ");
      map.push(i);
      pendingSpace = false;
    }
    for (const ch of folded) {
      out.push(ch);
      map.push(i);
    }
  }

  return { text: out.join(""), map };
}

function spanFrom(n: Normalized, idx: number, len: number): Span {
  return { start: n.map[idx], end: n.map[idx + len - 1] + 1 };
}

/**
 * Precompute the source normalization once per run — locate() is called once per field.
 */
export function createLocator(source: string) {
  let normalized: Normalized | null = null;

  return function locate(quote: string | null | undefined): Span | null {
    if (!quote) return null;

    const trimmed = quote.trim();
    // Sub-3-char quotes match noise everywhere. Reject rather than highlight the wrong "5".
    if (trimmed.length < 3) return null;

    const direct = source.indexOf(trimmed);
    if (direct !== -1) return { start: direct, end: direct + trimmed.length };

    normalized ??= normalizeWithMap(source);
    const q = normalizeWithMap(trimmed);
    if (!q.text) return null;

    const idx = normalized.text.indexOf(q.text);
    if (idx !== -1) return spanFrom(normalized, idx, q.text.length);

    // Last resort: models like to append a trailing period or wrap in quotes.
    const stripped = q.text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (!stripped || stripped === q.text || stripped.length < 3) return null;

    const idx2 = normalized.text.indexOf(stripped);
    if (idx2 === -1) return null;
    return spanFrom(normalized, idx2, stripped.length);
  };
}

/**
 * Non-overlapping segments for rendering. Feed it the source and the spans you want lit up;
 * render each segment as a <span> and attach the field key for the click-to-scroll behaviour.
 */
export function segmentByCitations(
  source: string,
  citations: Array<{ key: string; span: Span }>,
): Array<{ text: string; keys: string[] }> {
  const sorted = [...citations].sort(
    (a, b) => a.span.start - b.span.start || b.span.end - a.span.end,
  );

  const segments: Array<{ text: string; keys: string[] }> = [];
  let cursor = 0;

  for (const { key, span } of sorted) {
    if (span.start >= source.length || span.end <= span.start) continue;
    // Overlapping citations: first one wins the contested characters.
    const start = Math.max(span.start, cursor);
    const end = Math.min(span.end, source.length);
    if (start >= end) continue;

    if (start > cursor) segments.push({ text: source.slice(cursor, start), keys: [] });
    segments.push({ text: source.slice(start, end), keys: [key] });
    cursor = end;
  }

  if (cursor < source.length) segments.push({ text: source.slice(cursor), keys: [] });
  return segments;
}
