"use client";

import { useMemo, useRef, useState } from "react";
import { isOwner } from "./analytics";
import { SchemaBuilder } from "./schema-builder";
import { JsonView, ResultsTable, StatsBar, StatusChip, formatValue } from "./results-table";
import { SourceView } from "./source-view";
import { DEFAULT_SAMPLE, SAMPLES } from "@/lib/samples";
import { DEMO_MODEL, MAX_TEXT_CHARS, toPlainRecord, type Cell } from "@/lib/extract";
import { citationOrder, type Span } from "@/lib/locate";
import { PdfError, readPdf } from "@/lib/pdf";
import type { FieldSpec } from "@/lib/schema";

type RunState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "error"; message: string }
  | { status: "done"; cells: Cell[]; cached: boolean; model: string; durationMs: number };

/** Where the document came from, when it came from a file rather than a sample or a paste. */
type PdfState =
  | { status: "none" }
  | { status: "reading"; name: string }
  | { status: "error"; message: string }
  | { status: "loaded"; name: string; pages: number; pagesRead: number; truncated: boolean };

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
  // Same result, two renderings: rows with their quotes, or the JSON a caller would get.
  const [resultView, setResultView] = useState<"table" | "json">("table");
  const [copied, setCopied] = useState(false);
  const sidePane = useRef<HTMLDivElement>(null);
  // Below lg only one pane fits, so the workspace shows the document or the schema/result
  // panel, never both. Desktop renders both and ignores this.
  const [phonePane, setPhonePane] = useState<"document" | "side">("document");
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

  const [pdf, setPdf] = useState<PdfState>({ status: "none" });
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // Only the most recent file may land: a slow first read must not overwrite a second.
  const pdfRead = useRef(0);

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
    pdfRead.current++; // a file still being read no longer gets to replace this
    setPdf({ status: "none" });
    reset();
  };

  /**
   * A PDF is read here in the browser and becomes the editor's text, so what gets
   * extracted from — and cited into — is the string on screen, the same as a paste. A
   * file that can't be read leaves the current document alone.
   */
  const loadPdf = async (file: File) => {
    const id = ++pdfRead.current;
    setPdf({ status: "reading", name: file.name });
    try {
      const result = await readPdf(file);
      if (id !== pdfRead.current) return;
      setSampleId(null);
      setText(result.text);
      setTab("schema");
      setPhonePane("document");
      reset();
      setPdf({
        status: "loaded",
        name: file.name,
        pages: result.pages,
        pagesRead: result.pagesRead,
        truncated: result.truncated,
      });
    } catch (err) {
      if (id !== pdfRead.current) return;
      setPdf({
        status: "error",
        message: err instanceof PdfError ? err.message : "That PDF couldn't be read.",
      });
    }
  };
  const busy = run.status === "running" || pdf.status === "reading";
  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");

  const extract = async () => {
    const submitted = text;
    setExtractedText(submitted);
    setPinnedKey(null);
    setHoverKey(null);
    setRun({ status: "running" });
    setTab("result");
    setPhonePane("side");
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

  const canRun = !busy && text.trim().length > 0 && fields.some((f) => f.label);

  const done = run.status === "done" ? run : null;
  const showCited = done !== null;
  const citedCount = done?.cells.filter((c) => c.status === "found" && c.span).length ?? 0;
  const sample = SAMPLES.find((s) => s.id === sampleId) ?? null;

  /**
   * Citations are numbered like footnotes, in the order a reader meets them in the
   * document. The same number sits on the highlight and on its row, and the stepper
   * walks them in this order.
   */
  const order = useMemo(() => {
    if (run.status !== "done") return [];
    const citations = run.cells
      .filter((c): c is Cell & { span: Span } => c.status === "found" && c.span !== null)
      .map((c) => ({ key: c.key, span: c.span }));
    return citationOrder(extractedText, citations);
  }, [run, extractedText]);
  const numbers = useMemo(() => new Map(order.map((key, i) => [key, i + 1])), [order]);
  const position = pinnedKey ? order.indexOf(pinnedKey) : -1;

  // A pin made from the document or the stepper has to land somewhere visible, so it
  // brings the Result tab forward. A pin made from a row is already there.
  const pinFromDocument = (key: string | null) => {
    setPinnedKey(key);
    if (key) setTab("result");
  };
  // On a phone, tapping a row flips to the document at its source. The reverse does not
  // flip: tapping a highlight keeps you reading, and a strip above the document footer
  // says which field it is.
  const pinFromRow = (key: string | null) => {
    setPinnedKey(key);
    if (key) setPhonePane("document");
  };
  const pinnedCell = pinnedKey && done ? done.cells.find((c) => c.key === pinnedKey) : undefined;
  const pinnedLabel = pinnedKey ? fields.find((f) => f.key === pinnedKey)?.label || pinnedKey : "";
  const step = (delta: 1 | -1) => {
    if (order.length === 0) return;
    const next =
      position < 0
        ? delta > 0
          ? 0
          : order.length - 1
        : (position + delta + order.length) % order.length;
    pinFromDocument(order[next]);
  };

  const copyJson = async () => {
    if (!done) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(toPlainRecord(done.cells), null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (permissions, insecure context). The JSON is on screen to select.
    }
  };

  const segment = (active: boolean) =>
    "min-h-9 border px-3 text-[12.5px] transition-colors " +
    (active
      ? "border-ink bg-ink text-paper"
      : "border-rule text-ink-2 hover:border-ink hover:text-ink");
  const phoneTab = (active: boolean) =>
    "min-h-11 flex-1 border px-2 text-sm transition-colors " +
    (active ? "border-ink bg-ink text-paper" : "border-rule text-ink-2");
  const stepButton =
    "flex h-11 w-11 items-center justify-center rounded text-ink-2 hover:bg-raise hover:text-ink";

  const sampleTab = (active: boolean) =>
    "min-h-9 rounded px-3 text-[13px] whitespace-nowrap transition-colors " +
    (active ? "bg-ink text-paper" : "text-ink-2 hover:bg-raise hover:text-ink");
  const paneTab = (active: boolean) =>
    "-mb-px flex min-h-[52px] items-center gap-2 border-b-2 px-1 text-sm font-medium " +
    (active ? "border-ink text-ink" : "border-transparent text-ink-3 hover:text-ink");

  return (
    <section
      id="workspace"
      className="mx-auto w-full max-w-[1320px] scroll-mt-3 px-4 pb-10 lg:scroll-mt-6 lg:px-6"
    >
      {/* On desktop the workspace is one viewport tall and the two panes scroll inside
          themselves, so the document and the results stay side by side. Below lg there is
          room for one pane, so a switcher picks which, and that pane is sized to the
          screen and scrolls inside itself the same way. */}
      <div className="grid gap-2.5 lg:h-[clamp(560px,calc(100dvh-3rem),900px)] lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:gap-4">
        <div className="flex lg:hidden" role="group" aria-label="Workspace pane">
          <button
            type="button"
            aria-pressed={phonePane === "document"}
            onClick={() => setPhonePane("document")}
            className={`${phoneTab(phonePane === "document")} rounded-l`}
          >
            Document
          </button>
          <button
            type="button"
            aria-pressed={phonePane === "side" && tab === "schema"}
            onClick={() => {
              setPhonePane("side");
              setTab("schema");
            }}
            className={`${phoneTab(phonePane === "side" && tab === "schema")} -ml-px`}
          >
            Schema <span className="eyebrow ml-1">{fields.length}</span>
          </button>
          <button
            type="button"
            aria-pressed={phonePane === "side" && tab === "result"}
            onClick={() => {
              setPhonePane("side");
              setTab("result");
            }}
            className={`${phoneTab(phonePane === "side" && tab === "result")} -ml-px rounded-r`}
          >
            Result
          </button>
        </div>

        {/* Source pane. Editable until a run lands, then swaps to the cited view so the
            highlights sit on the exact string the model saw. */}
        <section
          onDragOver={(e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
          }}
          onDrop={(e) => {
            if (!hasFiles(e)) return;
            // Always claimed, or the browser navigates away to the dropped file.
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file && !busy) loadPdf(file);
          }}
          className={`panel relative ${
            phonePane === "document" ? "flex" : "hidden"
          } h-[calc(100dvh-5.5rem)] min-h-[420px] flex-col overflow-hidden lg:flex lg:h-auto lg:min-h-0`}
        >
          {dragging && (
            <div
              className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-md border-2 border-dashed border-ink bg-paper/90 text-[15px] font-medium tracking-tight"
              aria-hidden="true"
            >
              Drop a PDF to read its text
            </div>
          )}
          {/* The samples scroll sideways on a phone; the upload button sits outside that
              row so it is on screen without scrolling to find it. */}
          <header className="flex shrink-0 items-start gap-2 border-b border-rule px-2 py-2">
            <h2 className="sr-only">Document</h2>
            <div className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto lg:flex-wrap lg:overflow-visible">
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
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={busy}
              aria-label="Upload PDF"
              className="flex min-h-9 shrink-0 items-center gap-1.5 rounded border border-rule px-3 text-[13px] whitespace-nowrap hover:border-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg
                viewBox="0 0 16 16"
                width="13"
                height="13"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M8 10.5V2.5M4.75 5.5L8 2.25l3.25 3.25M2.5 10.5v2a1 1 0 001 1h9a1 1 0 001-1v-2" />
              </svg>
              <span className="sm:hidden">PDF</span>
              <span className="hidden sm:inline">Upload PDF</span>
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                const file = e.target.files?.[0];
                // Cleared so choosing the same file again still fires a change.
                e.target.value = "";
                if (file) loadPdf(file);
              }}
            />
          </header>

          {sample && (
            <p className="shrink-0 border-b border-rule bg-raise px-4 py-2.5 text-[13px] text-ink-2">
              {sample.note}
            </p>
          )}

          {pdf.status === "reading" && (
            <p
              role="status"
              className="shrink-0 border-b border-rule bg-raise px-4 py-2.5 text-[13px] text-ink-2"
            >
              Reading {pdf.name}…
            </p>
          )}
          {pdf.status === "error" && (
            <p
              role="alert"
              className="shrink-0 border-b border-rule bg-raise px-4 py-2.5 text-[13px] text-flag"
            >
              {pdf.message}
            </p>
          )}
          {pdf.status === "loaded" && (
            <p
              data-pdf-note
              className="shrink-0 border-b border-rule bg-raise px-4 py-2.5 text-[13px] text-ink-2"
            >
              <span className="font-medium text-ink">{pdf.name}</span> · {pdf.pages}{" "}
              {pdf.pages === 1 ? "page" : "pages"}. Read in your browser — only this text is
              sent for extraction, not the file.
              {pdf.truncated && (
                <span className="mt-1 block text-flag">
                  Only the first {MAX_TEXT_CHARS.toLocaleString()} characters fit (through page{" "}
                  {pdf.pagesRead} of {pdf.pages}). Anything after that was not read, so a field
                  that lives there will come back not found.
                </span>
              )}
            </p>
          )}

          {done ? (
            <SourceView
              text={extractedText}
              cells={done.cells}
              numbers={numbers}
              activeKey={activeKey}
              pinnedKey={pinnedKey}
              onHoverKey={setHoverKey}
              onSelectKey={pinFromDocument}
            />
          ) : (
            <textarea
              value={text}
              maxLength={MAX_TEXT_CHARS}
              aria-label="Document text"
              onChange={(e) => {
                setText(e.target.value);
                setSampleId(null);
                // The file note describes this text. Once it is emptied, or after a failed
                // read, the note no longer describes anything.
                if (e.target.value === "" || pdf.status === "error") setPdf({ status: "none" });
                reset();
              }}
              spellCheck={false}
              placeholder="Paste a contract, invoice, report — or drop a PDF here."
              className="min-h-0 flex-1 resize-none bg-transparent px-5 py-5 font-mono text-[12.5px] leading-[1.75] text-ink placeholder:text-ink-3 focus:outline-none"
            />
          )}

          {pinnedCell && numbers.has(pinnedCell.key) && (
            <p className="flex shrink-0 items-baseline gap-2 border-t border-rule bg-raise px-4 py-2.5 text-[13px] lg:hidden">
              <span className="cite-tag">{numbers.get(pinnedCell.key)}</span>
              <span className="shrink-0 font-medium">{pinnedLabel}</span>
              <span className="min-w-0 truncate font-mono">{formatValue(pinnedCell.value)}</span>
            </p>
          )}

          <footer className="flex min-h-[52px] shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-rule py-1.5 pr-3 pl-4">
            {showCited && order.length > 0 ? (
              <div className="-ml-3 flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => step(-1)}
                  aria-label="Previous citation"
                  className={stepButton}
                >
                  <svg
                    viewBox="0 0 16 16"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M10 3.5L5.5 8l4.5 4.5" />
                  </svg>
                </button>
                <span className="eyebrow min-w-[132px] text-center text-ink-2" aria-live="polite">
                  {position < 0
                    ? `${citedCount} cited ${citedCount === 1 ? "span" : "spans"}`
                    : `Citation ${position + 1} of ${order.length}`}
                </span>
                <button
                  type="button"
                  onClick={() => step(1)}
                  aria-label="Next citation"
                  className={stepButton}
                >
                  <svg
                    viewBox="0 0 16 16"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M6 3.5L10.5 8 6 12.5" />
                  </svg>
                </button>
              </div>
            ) : (
              <span className="eyebrow text-ink-3">
                {showCited
                  ? `${citedCount} cited ${citedCount === 1 ? "span" : "spans"}`
                  : `${text.length.toLocaleString()} / ${MAX_TEXT_CHARS.toLocaleString()} chars`}
              </span>
            )}
            {!showCited && (
              <button
                type="button"
                onClick={extract}
                disabled={!canRun}
                className="flex min-h-10 items-center gap-2 rounded bg-ink px-4 text-sm font-medium text-paper hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40 lg:hidden"
              >
                {run.status === "running" ? "Extracting…" : "Extract"}
              </button>
            )}
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
        <section
          className={`panel ${
            phonePane === "side" ? "flex" : "hidden"
          } h-[calc(100dvh-5.5rem)] min-h-[420px] flex-col overflow-hidden lg:flex lg:h-auto lg:min-h-0`}
        >
          <div
            role="tablist"
            aria-label="Schema and result"
            className="hidden shrink-0 flex-wrap items-center gap-x-5 border-b border-rule px-4 lg:flex"
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

          <div ref={sidePane} className="min-h-0 flex-1 overflow-y-auto px-4 pt-1 pb-4">
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
                      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                        <p className="text-xs text-ink-3">
                          {citedCount > 0
                            ? "Click a cited field to pin its span in the document."
                            : "Nothing in this result could be cited."}
                        </p>
                        <div className="flex items-center gap-2">
                          {resultView === "json" && (
                            <button
                              type="button"
                              onClick={copyJson}
                              className={`${segment(false)} rounded`}
                            >
                              {copied ? "Copied" : "Copy"}
                            </button>
                          )}
                          <div className="flex" role="group" aria-label="Result format">
                            <button
                              type="button"
                              aria-pressed={resultView === "table"}
                              onClick={() => setResultView("table")}
                              className={`${segment(resultView === "table")} rounded-l`}
                            >
                              Table
                            </button>
                            <button
                              type="button"
                              aria-pressed={resultView === "json"}
                              onClick={() => setResultView("json")}
                              className={`${segment(resultView === "json")} -ml-px rounded-r`}
                            >
                              JSON
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                    {resultView === "table" ? (
                      <ResultsTable
                        cells={done.cells}
                        fields={fields}
                        numbers={numbers}
                        activeKey={activeKey}
                        pinnedKey={pinnedKey}
                        onHoverKey={setHoverKey}
                        onSelectKey={pinFromRow}
                        scrollPane={sidePane}
                        shown={phonePane === "side"}
                      />
                    ) : (
                      <JsonView
                        cells={done.cells}
                        numbers={numbers}
                        activeKey={activeKey}
                        pinnedKey={pinnedKey}
                        onHoverKey={setHoverKey}
                        onSelectKey={pinFromRow}
                        scrollPane={sidePane}
                        shown={phonePane === "side"}
                      />
                    )}
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
