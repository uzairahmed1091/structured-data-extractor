"use client";

import { useState } from "react";
import { SchemaBuilder } from "./schema-builder";
import { ResultsTable, StatsBar } from "./results-table";
import { SourceView } from "./source-view";
import { DEFAULT_SAMPLE, SAMPLES } from "@/lib/samples";
import { MAX_TEXT_CHARS, type Cell } from "@/lib/extract";
import type { FieldSpec } from "@/lib/schema";

type RunState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "error"; message: string }
  | { status: "done"; cells: Cell[]; cached: boolean; model: string; durationMs: number };

export function Extractor() {
  const [sampleId, setSampleId] = useState<string | null>(DEFAULT_SAMPLE.id);
  const [text, setText] = useState(DEFAULT_SAMPLE.text);
  const [fields, setFields] = useState<FieldSpec[]>(DEFAULT_SAMPLE.fields);
  const [apiKey, setApiKey] = useState("");
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [run, setRun] = useState<RunState>({ status: "idle" });
  // Hover is a preview, a click pins. Pin wins so the highlight survives moving the mouse
  // away from the row to look at the document.
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const activeKey = pinnedKey ?? hoverKey;

  /**
   * The text the highlighted view renders must be the exact string that was extracted
   * from, not whatever is in the editor now — cell.span offsets index into it. Captured
   * at request time and held for the life of the run.
   */
  const [extractedText, setExtractedText] = useState("");

  const reset = () => {
    setRun({ status: "idle" });
    setPinnedKey(null);
    setHoverKey(null);
  };

  const loadSample = (id: string) => {
    const sample = SAMPLES.find((s) => s.id === id);
    if (!sample) return;
    setSampleId(sample.id);
    setText(sample.text);
    setFields(sample.fields);
    reset();
  };

  const extract = async () => {
    const submitted = text;
    setExtractedText(submitted);
    setPinnedKey(null);
    setHoverKey(null);
    setRun({ status: "running" });
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { "x-openai-key": apiKey } : {}),
        },
        body: JSON.stringify({
          text: submitted,
          fields,
          sampleId: sampleId ?? undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        // Both of these are "the shared key can't serve you" rather than "you did
        // something wrong", and the fix in each case is the key field. Open it rather
        // than making the visitor find the link under an error they just hit.
        if (data.error === "demo_budget_exhausted" || data.error === "rate_limited") {
          setShowKeyInput(true);
        }
        setRun({ status: "error", message: data.message ?? "Extraction failed." });
        return;
      }
      setRun({
        status: "done",
        cells: data.cells,
        cached: data.cached,
        model: data.model,
        durationMs: data.durationMs,
      });
    } catch {
      setRun({ status: "error", message: "Could not reach the server." });
    }
  };

  const canRun =
    run.status !== "running" && text.trim().length > 0 && fields.some((f) => f.label);

  const done = run.status === "done" ? run : null;
  const showCited = done !== null;
  const citedCount = done?.cells.filter((c) => c.status === "found" && c.span).length ?? 0;

  return (
    <div className="mx-auto grid w-full max-w-[1400px] gap-4 p-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[1.1fr_1fr] lg:overflow-hidden lg:p-6">
      {/* Source pane. Editable until a run lands, then swaps to the cited view so the
          highlights sit on the exact string the model saw. */}
      <section className="flex max-h-[70dvh] min-h-[50vh] flex-col overflow-hidden rounded-sm border border-rule bg-paper lg:max-h-none lg:min-h-0">
        <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-rule px-4 py-3">
          <h2 className="text-sm font-semibold tracking-tight">Document</h2>
          <span className="eyebrow text-ink-3">
            {showCited
              ? `${citedCount} cited ${citedCount === 1 ? "span" : "spans"}`
              : `${text.length.toLocaleString()} / ${MAX_TEXT_CHARS.toLocaleString()} chars`}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {showCited ? (
              <button
                type="button"
                onClick={reset}
                className="rounded-sm border border-rule px-2 py-1 text-xs hover:border-ink"
              >
                Edit text
              </button>
            ) : (
              <select
                className="rounded-sm border border-rule px-2 py-1 text-xs"
                value={sampleId ?? ""}
                onChange={(e) =>
                  e.target.value ? loadSample(e.target.value) : setSampleId(null)
                }
              >
                <option value="">Own text</option>
                {SAMPLES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        </header>

        {done ? (
          <SourceView
            text={extractedText}
            cells={done.cells}
            activeKey={activeKey}
            pinnedKey={pinnedKey}
            onHoverKey={setHoverKey}
            onSelectKey={setPinnedKey}
          />
        ) : (
          <textarea
            value={text}
            maxLength={MAX_TEXT_CHARS}
            onChange={(e) => {
              setText(e.target.value);
              setSampleId(null);
              reset();
            }}
            spellCheck={false}
            placeholder="Paste a contract, invoice, report — anything with facts in it."
            className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-[13px] leading-relaxed text-ink placeholder:text-ink-3 focus:outline-none"
          />
        )}
      </section>

      {/* Schema + results pane. Scrolls inside itself on desktop so the page doesn't. */}
      <section className="flex flex-col gap-4 lg:min-h-0 lg:overflow-y-auto">
        <div className="shrink-0 rounded-sm border border-rule bg-paper p-4">
          <SchemaBuilder
            fields={fields}
            onChange={(f) => {
              setFields(f);
              reset();
            }}
            disabled={run.status === "running"}
          />

          <div className="mt-4 flex items-center gap-3 border-t border-rule pt-4">
            <button
              type="button"
              onClick={extract}
              disabled={!canRun}
              className="rounded-sm bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-ink-2 disabled:opacity-40"
            >
              {run.status === "running" ? "Extracting…" : "Extract"}
            </button>
            <button
              type="button"
              onClick={() => setShowKeyInput((v) => !v)}
              className="text-xs text-ink-2 underline underline-offset-2 hover:text-ink"
            >
              Use your own API key
            </button>
          </div>

          {showKeyInput && (
            <div className="mt-3">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-…"
                autoComplete="off"
                className="w-full rounded-sm border border-rule px-2.5 py-1.5 font-mono text-xs focus:border-ink focus:outline-none"
              />
              <p className="mt-1 text-xs text-ink-3">
                Sent with this one request, never stored or logged. Skips the shared
                hourly limit.
              </p>
            </div>
          )}
        </div>

        <div className="shrink-0 rounded-sm border border-rule bg-paper p-4">
          <div className="flex items-baseline justify-between border-b border-rule pb-2">
            <h2 className="text-sm font-semibold tracking-tight">Result</h2>
            {run.status === "done" && (
              <span className="eyebrow text-ink-3">
                {run.model} · {run.durationMs} ms{run.cached ? " · cached" : ""}
              </span>
            )}
          </div>

          {run.status === "idle" && (
            <p className="py-8 text-center text-sm text-ink-3">
              Run an extraction to see typed values and their citations.
            </p>
          )}

          {run.status === "running" && (
            <p className="py-8 text-center text-sm text-ink-3">Reading the document…</p>
          )}

          {run.status === "error" && (
            <p className="mt-3 rounded-sm border border-flag px-3 py-2 text-sm text-flag">
              {run.message}
            </p>
          )}

          {done && (
            <div className="mt-3">
              <StatsBar cells={done.cells} />
              {citedCount > 0 && (
                <p className="mt-2 text-xs text-ink-3">
                  Click a cited field to pin its span in the document.
                </p>
              )}
              <div className="mt-3">
                <ResultsTable
                  cells={done.cells}
                  fields={fields}
                  activeKey={activeKey}
                  pinnedKey={pinnedKey}
                  onHoverKey={setHoverKey}
                  onSelectKey={setPinnedKey}
                />
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
