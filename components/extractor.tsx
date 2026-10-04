"use client";

import { useState } from "react";
import { isOwner } from "./analytics";
import { SchemaBuilder } from "./schema-builder";
import { ResultsTable, StatsBar, StatusChip } from "./results-table";
import { SourceView } from "./source-view";
import { DEFAULT_SAMPLE, SAMPLES } from "@/lib/samples";
import { DEMO_MODEL, MAX_TEXT_CHARS, type Cell } from "@/lib/extract";
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
  // The right pane shows one of these at a time. A run flips it to the result so the
  // values land next to the document without anyone scrolling past the schema to find them.
  const [tab, setTab] = useState<"schema" | "result">("schema");
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
    setTab("schema");
    reset();
  };

  const extract = async () => {
    const submitted = text;
    setExtractedText(submitted);
    setPinnedKey(null);
    setHoverKey(null);
    setRun({ status: "running" });
    setTab("result");
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { "x-openai-key": apiKey } : {}),
          ...(isOwner() ? { "x-ce-owner": "1" } : {}),
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
        if (
          data.error === "demo_budget_exhausted" ||
          data.error === "rate_limited" ||
          data.error === "not_configured"
        ) {
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
  const sample = SAMPLES.find((s) => s.id === sampleId) ?? null;

  const sampleTab = (active: boolean) =>
    "min-h-9 rounded px-3 text-[13px] whitespace-nowrap transition-colors " +
    (active ? "bg-ink text-paper" : "text-ink-2 hover:bg-raise hover:text-ink");
  const paneTab = (active: boolean) =>
    "-mb-px flex min-h-[52px] items-center gap-2 border-b-2 px-1 text-sm font-medium " +
    (active ? "border-ink text-ink" : "border-transparent text-ink-3 hover:text-ink");

  return (
    <section
      id="workspace"
      className="mx-auto w-full max-w-[1320px] scroll-mt-6 px-4 pb-10 lg:px-6"
    >
      {/* On desktop the workspace is one viewport tall and the two panes scroll inside
          themselves, so the document and the results stay side by side. Below lg they
          stack and the page scrolls normally. */}
      <div className="grid gap-4 lg:h-[clamp(560px,calc(100dvh-3rem),900px)] lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
        {/* Source pane. Editable until a run lands, then swaps to the cited view so the
            highlights sit on the exact string the model saw. */}
        <section className="panel flex h-[70dvh] min-h-[420px] flex-col overflow-hidden lg:h-auto lg:min-h-0">
          <header className="shrink-0 border-b border-rule px-2 py-2">
            <h2 className="sr-only">Document</h2>
            <div className="flex flex-wrap gap-0.5">
              {SAMPLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={sampleId === s.id}
                  onClick={() => loadSample(s.id)}
                  className={sampleTab(sampleId === s.id)}
                >
                  {s.label}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={sampleId === null}
                onClick={() => {
                  setSampleId(null);
                  setTab("schema");
                  reset();
                }}
                className={sampleTab(sampleId === null)}
              >
                Your text
              </button>
            </div>
          </header>

          {sample && (
            <p className="shrink-0 border-b border-rule bg-raise px-4 py-2.5 text-[13px] text-ink-2">
              {sample.note}
            </p>
          )}

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
              aria-label="Document text"
              onChange={(e) => {
                setText(e.target.value);
                setSampleId(null);
                reset();
              }}
              spellCheck={false}
              placeholder="Paste a contract, invoice, report — anything with facts in it."
              className="min-h-0 flex-1 resize-none bg-transparent px-5 py-5 font-mono text-[12.5px] leading-[1.75] text-ink placeholder:text-ink-3 focus:outline-none"
            />
          )}

          <footer className="flex min-h-[52px] shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-rule py-1.5 pr-3 pl-4">
            <span className="eyebrow text-ink-3">
              {showCited
                ? `${citedCount} cited ${citedCount === 1 ? "span" : "spans"}`
                : `${text.length.toLocaleString()} / ${MAX_TEXT_CHARS.toLocaleString()} chars`}
            </span>
            {showCited && (
              <button
                type="button"
                onClick={() => {
                  setTab("schema");
                  reset();
                }}
                className="min-h-9 rounded border border-rule px-3 text-[13px] hover:border-ink"
              >
                Edit text
              </button>
            )}
          </footer>
        </section>

        {/* Schema + result pane. One panel, two tabs, with the action bar pinned to the
            bottom so Extract is reachable however long the schema gets. */}
        <section className="panel flex flex-col overflow-hidden lg:min-h-0">
          <div
            role="tablist"
            aria-label="Schema and result"
            className="flex shrink-0 flex-wrap items-center gap-x-5 border-b border-rule px-4"
          >
            <button
              type="button"
              role="tab"
              id="tab-schema"
              aria-selected={tab === "schema"}
              aria-controls="panel-schema"
              onClick={() => setTab("schema")}
              className={paneTab(tab === "schema")}
            >
              Schema
              <span className="eyebrow font-normal text-ink-3">{fields.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              id="tab-result"
              aria-selected={tab === "result"}
              aria-controls="panel-result"
              onClick={() => setTab("result")}
              className={paneTab(tab === "result")}
            >
              Result
              {done && (
                <span className="eyebrow font-normal text-ink-3">{done.cells.length}</span>
              )}
            </button>
            {done && tab === "result" && (
              <span className="eyebrow ml-auto py-2 text-ink-3">
                {done.model} · {done.durationMs.toLocaleString()} ms
                {done.cached ? " · cached" : ""}
              </span>
            )}
          </div>

          <div className="px-4 pt-1 pb-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {tab === "schema" && (
              <div role="tabpanel" id="panel-schema" aria-labelledby="tab-schema">
                <SchemaBuilder
                  fields={fields}
                  onChange={(f) => {
                    setFields(f);
                    reset();
                  }}
                  disabled={run.status === "running"}
                />
              </div>
            )}

            {tab === "result" && (
              <div role="tabpanel" id="panel-result" aria-labelledby="tab-result">
                {run.status === "idle" && (
                  <div className="mt-3 flex flex-col items-center gap-3.5 rounded-md border border-dashed border-rule px-6 py-12 text-center">
                    <div className="flex flex-wrap justify-center gap-1.5">
                      <StatusChip status="found" />
                      <StatusChip status="not_found" />
                      <StatusChip status="unverified" label="discarded" />
                    </div>
                    <p className="max-w-xs text-[15px] font-medium tracking-tight">
                      Run an extraction to see typed values and their citations.
                    </p>
                    <p className="max-w-[340px] text-[13px] text-ink-2">
                      Each field comes back as one of these three. Click a cited value to
                      see the text it came from.
                    </p>
                  </div>
                )}

                {run.status === "running" && (
                  <div className="mt-4 flex flex-col gap-[18px]" role="status">
                    <span className="eyebrow text-ink-3">Reading the document…</span>
                    {[
                      ["38%", "56%", "72%"],
                      ["30%", "34%", "64%"],
                      ["44%", "22%", "50%"],
                      ["34%", "48%", "68%"],
                    ].map((widths, i) => (
                      <div key={i} className="flex flex-col gap-2" aria-hidden="true">
                        <div className="skeleton h-3.5" style={{ width: widths[0] }} />
                        <div className="skeleton h-[18px]" style={{ width: widths[1] }} />
                        <div className="skeleton h-3" style={{ width: widths[2] }} />
                      </div>
                    ))}
                  </div>
                )}

                {run.status === "error" && (
                  <p
                    role="alert"
                    className="mt-3 rounded-md border border-flag px-3 py-2.5 text-sm text-flag"
                  >
                    {run.message}
                  </p>
                )}

                {done && (
                  <>
                    <div className="flex flex-col gap-2 pt-3.5 pb-2.5">
                      <StatsBar cells={done.cells} />
                      {citedCount > 0 && (
                        <p className="text-xs text-ink-3">
                          Click a cited field to pin its span in the document.
                        </p>
                      )}
                    </div>
                    <ResultsTable
                      cells={done.cells}
                      fields={fields}
                      activeKey={activeKey}
                      pinnedKey={pinnedKey}
                      onHoverKey={setHoverKey}
                      onSelectKey={setPinnedKey}
                    />
                  </>
                )}
              </div>
            )}
          </div>

          {showKeyInput && (
            <div className="shrink-0 border-t border-rule px-4 pt-3">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-…"
                aria-label="OpenAI API key"
                autoComplete="off"
                className="h-[38px] w-full rounded border border-rule bg-paper px-2.5 font-mono text-xs hover:border-ink focus:border-ink focus:outline-none"
              />
              <p className="mt-1.5 text-xs text-ink-3">
                Sent with this one request, never stored or logged. Skips the shared
                hourly limit.
              </p>
            </div>
          )}

          <div
            className={`flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 ${
              showKeyInput ? "" : "border-t border-rule"
            }`}
          >
            <button
              type="button"
              onClick={extract}
              disabled={!canRun}
              className="flex min-h-11 items-center gap-2 rounded bg-ink px-4.5 text-sm font-medium text-paper hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {run.status === "running" && (
                <span
                  className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
                  aria-hidden="true"
                />
              )}
              {run.status === "running" ? "Extracting…" : "Extract"}
            </button>
            <button
              type="button"
              onClick={() => setShowKeyInput((v) => !v)}
              aria-expanded={showKeyInput}
              className="min-h-11 text-[13px] text-ink-2 underline underline-offset-[3px] hover:text-ink"
            >
              Use your own API key
            </button>
            <span className="eyebrow ml-auto text-ink-3">
              {apiKey ? "your key" : `${DEMO_MODEL} · shared demo key`}
            </span>
          </div>
        </section>
      </div>
    </section>
  );
}
