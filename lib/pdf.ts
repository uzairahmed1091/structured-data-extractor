/**
 * Turns a PDF into the plain string the rest of the app already works on.
 *
 * This runs in the browser. The file is read locally and only its text is posted for
 * extraction — the same string that fills the editor, so a visitor can see (and fix)
 * exactly what the model will be given, and the citation offsets index into what is on
 * screen. Nothing here re-parses for rendering; see the note at the top of lib/locate.ts.
 *
 * Only PDFs with a text layer work. A scan is a picture of a page and would need OCR,
 * which this does not do — it says so instead of returning an empty document.
 */

import { MAX_TEXT_CHARS } from "./extract";

export const MAX_PDF_BYTES = 15 * 1024 * 1024;

/** The parts of a pdf.js text item this module reads. */
export type PdfTextItem = {
  str: string;
  /** Baseline position, PDF units, origin bottom-left. */
  x: number;
  y: number;
  width: number;
  height: number;
  hasEOL: boolean;
};

export type PdfText = {
  text: string;
  pages: number;
  /** Pages whose text made it into `text`. Less than `pages` only when truncated. */
  pagesRead: number;
  truncated: boolean;
};

export type PdfErrorCode = "not_pdf" | "too_large" | "encrypted" | "no_text" | "unreadable";

const MESSAGES: Record<PdfErrorCode, string> = {
  not_pdf: "That file is not a PDF.",
  too_large: `That PDF is over ${MAX_PDF_BYTES / 1024 / 1024} MB.`,
  encrypted: "That PDF is password-protected, so its text can't be read.",
  no_text:
    "That PDF has no text layer — it looks like a scan. Reading it would need OCR, which this demo doesn't do.",
  unreadable: "That PDF couldn't be read. It may be damaged.",
};

export class PdfError extends Error {
  constructor(public code: PdfErrorCode) {
    super(MESSAGES[code]);
    this.name = "PdfError";
  }
}

type Line = {
  text: string;
  y: number;
  height: number;
  left: number;
  right: number;
  /** Holds a widened gap, so it is a table row or a label/value pair, not prose. */
  spaced: boolean;
  /** Separated from the line before it by a vertical jump. */
  blockStart: boolean;
};

/**
 * One page's items to text, in the order the PDF draws them.
 *
 * pdf.js has already done the hard part: it marks line ends and puts a whitespace item
 * wherever the pen jumps sideways. Three things are added on top.
 *
 * A wide jump becomes several spaces rather than one, so the cells of a table row stay
 * visibly apart ("PT-40   12" rather than "PT-40 12"). A vertical jump of more than two
 * line heights becomes a blank line, which keeps paragraphs and blocks separate. And a
 * line of prose that runs to the right margin is joined to the next one: the PDF broke it
 * to fit a page, and keeping that break makes the editor wrap every line twice.
 *
 * None of this can move a citation. Matching collapses whitespace, so a quote locates
 * the same whether a break is a newline, a space, or six of them.
 *
 * Drawing order is trusted rather than re-sorting by position, because sorting by
 * position merges the lines of side-by-side columns into each other.
 */
export function pageToText(items: PdfTextItem[]): string {
  const lines: Line[] = [];
  let text = "";
  let y = 0;
  let height = 0;
  let left = 0;
  let right = 0;
  let spaced = false;
  // Width of an average character on the current line, for sizing gaps.
  let charWidth = 0;

  const flush = () => {
    const done = text.replace(/\s+$/, "");
    if (done !== "") {
      const prev = lines.at(-1);
      const drop = prev ? prev.y - y : 0;
      const unit = Math.max(prev?.height ?? 0, height, 1);
      lines.push({
        text: done,
        y,
        height,
        left,
        right,
        spaced,
        // Further down than two line heights, or back up the page (a new column).
        blockStart: prev !== undefined && (drop > unit * 2 || drop < -unit),
      });
    }
    text = "";
    height = 0;
    spaced = false;
    charWidth = 0;
  };

  for (const item of items) {
    const str = item.str.replace(/\u0000/g, "");
    if (str.trim() === "") {
      // A gap. pdf.js reports its width, so a column gap can be told from a word space.
      if (text !== "" && str !== "") {
        const unit = charWidth || height * 0.5;
        const count = unit > 0 ? Math.round(item.width / unit) : 1;
        if (count >= 2) spaced = true;
        text += " ".repeat(count >= 2 ? Math.min(count, 6) : 1);
      }
    } else {
      if (text === "") {
        y = item.y;
        left = item.x;
      }
      height = Math.max(height, item.height);
      right = item.x + item.width;
      if (item.width > 0) charWidth = item.width / str.length;
      text += str;
    }
    if (item.hasEOL) flush();
  }
  flush();

  if (lines.length === 0) return "";
  const pageLeft = Math.min(...lines.map((l) => l.left));
  const measure = Math.max(...lines.map((l) => l.right)) - pageLeft;

  let out = "";
  lines.forEach((line, i) => {
    if (i > 0) {
      const prev = lines[i - 1];
      const wrapped =
        !line.blockStart &&
        !prev.spaced &&
        !line.spaced &&
        measure > 0 &&
        prev.right - pageLeft >= measure * 0.9;
      out += line.blockStart ? "\n\n" : wrapped ? " " : "\n";
    }
    out += line.text;
  });
  return out;
}

/**
 * Pages to one document, stopping at the character limit the API enforces.
 *
 * A page break is a blank line and nothing more. A visible marker ("— page 2 —") would be
 * text the document does not contain, sitting where a model could quote it; and a quote
 * that runs across a page break still locates, because matching collapses whitespace.
 */
export function joinPages(
  pageTexts: string[],
  totalPages: number = pageTexts.length,
  limit: number = MAX_TEXT_CHARS,
): PdfText {
  let text = "";
  let pagesRead = 0;
  let truncated = false;

  for (const page of pageTexts) {
    if (page.trim() !== "") {
      const next = text === "" ? page : `${text}\n\n${page}`;
      if (next.length > limit) {
        text = next.slice(0, limit);
        truncated = true;
        pagesRead++;
        break;
      }
      text = next;
    }
    pagesRead++;
  }

  if (pagesRead < totalPages) truncated = true;
  return { text, pages: totalPages, pagesRead, truncated };
}

/** Browser only: loads pdf.js on first use, so a visitor who never uploads never pays for it. */
export async function readPdf(file: File): Promise<PdfText> {
  const named = /\.pdf$/i.test(file.name);
  if (file.type !== "application/pdf" && !named) throw new PdfError("not_pdf");
  if (file.size > MAX_PDF_BYTES) throw new PdfError("too_large");

  const data = new Uint8Array(await file.arrayBuffer());
  // "%PDF-" may sit a little way in; the spec allows leading bytes.
  const head = String.fromCharCode(...data.subarray(0, 1024));
  if (!head.includes("%PDF-")) throw new PdfError("not_pdf");

  // The legacy build is the one that runs on browsers a couple of years old.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const task = pdfjs.getDocument({ data });
  try {
    const pdf = await task.promise;
    const pageTexts: string[] = [];
    let chars = 0;

    // Stop once the limit is passed: the rest would be cut off anyway.
    for (let n = 1; n <= pdf.numPages && chars <= MAX_TEXT_CHARS; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const items: PdfTextItem[] = [];
      for (const item of content.items) {
        if (!("str" in item)) continue; // marked-content markers carry no text
        items.push({
          str: item.str,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width,
          height: item.height,
          hasEOL: item.hasEOL,
        });
      }
      const text = pageToText(items);
      pageTexts.push(text);
      chars += text.length + 2;
      page.cleanup();
    }

    const result = joinPages(pageTexts, pdf.numPages);
    if (result.text.trim() === "") throw new PdfError("no_text");
    return result;
  } catch (err) {
    if (err instanceof PdfError) throw err;
    const name = err instanceof Error ? err.name : "";
    throw new PdfError(name === "PasswordException" ? "encrypted" : "unreadable");
  } finally {
    await task.destroy().catch(() => {});
  }
}
