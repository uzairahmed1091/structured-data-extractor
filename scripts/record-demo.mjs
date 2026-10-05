/**
 * Records the README demo and encodes it to docs/demo.gif + docs/demo.mp4.
 *
 *   npm run record:demo        (reads overrides from .env.local, if present)
 *
 * Playwright can only emit .webm, which GitHub will not render in a README, so the webm
 * is treated as an intermediate: it lands in a temp directory, gets encoded, and is
 * deleted. ffmpeg comes from the `ffmpeg-static` devDependency rather than the system,
 * so this works on Windows without installing anything.
 *
 * Environment overrides:
 *   DEMO_URL     page to record         (default: the deployed site)
 *   CHROME_PATH  browser executable     (default: Playwright's bundled Chromium)
 *   GIF_WIDTH    output width in px     (default: 800)
 *   GIF_FPS      frames per second      (default: 10)
 *   GIF_COLORS   palette size           (default: 48)
 *   DEMO_PDF     set to 0 to skip the PDF opening and record the cached sample instead
 *   REAL_RUN     JSON {cells:[...]} — when set, /api/extract is answered from this
 *                instead of being called. For recording somewhere the deployment is
 *                unreachable; pass a row from the extraction_runs table so the frames
 *                still show real model output. Its spans index the sample's own text,
 *                so this also skips the PDF opening.
 *
 * What gets recorded, in order: the pitch, a PDF going in, the extraction, a result row
 * pinning its source, a highlight pinning its row, the stepper walking citations, the
 * field that comes back null, and the same result as JSON.
 *
 * The PDF opening sends the document as the visitor's own text, so that one extraction is
 * a real, uncached call on the shared demo key — a few seconds on camera and one run
 * against the hourly limit.
 */

import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

const URL = process.env.DEMO_URL ?? "https://structured-data-extractor.vercel.app/";
const WIDTH = Number(process.env.GIF_WIDTH ?? 800);
const FPS = Number(process.env.GIF_FPS ?? 10);
const COLORS = Number(process.env.GIF_COLORS ?? 48);

// The replayed spans belong to the sample text, not to text read back out of a PDF.
const WITH_PDF = process.env.DEMO_PDF !== "0" && !process.env.REAL_RUN;

const OUT_DIR = "docs";
const GIF = path.join(OUT_DIR, "demo.gif");
const MP4 = path.join(OUT_DIR, "demo.mp4");

if (!ffmpegPath) {
  console.error("ffmpeg-static did not resolve a binary. Run: npm i -D ffmpeg-static");
  process.exit(1);
}

const workDir = mkdtempSync(path.join(tmpdir(), "cited-extract-demo-"));
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
);

const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  recordVideo: { dir: workDir, size: { width: 1280, height: 800 } },
});

// Playwright's video has no cursor, so clicks look unmotivated. Draw one that follows
// the real mouse position and pulses on click.
await context.addInitScript(() => {
  window.addEventListener("DOMContentLoaded", () => {
    const dot = document.createElement("div");
    dot.id = "__cursor";
    dot.style.cssText = `
      position:fixed;left:0;top:0;width:18px;height:18px;border-radius:50%;
      background:rgba(15,19,23,.82);border:2px solid #fff;
      box-shadow:0 1px 6px rgba(0,0,0,.45);
      z-index:2147483647;pointer-events:none;
      transform:translate(-50%,-50%);transition:width .12s,height .12s;`;
    document.body.appendChild(dot);
    document.addEventListener("mousemove", (e) => {
      dot.style.left = e.clientX + "px";
      dot.style.top = e.clientY + "px";
    }, true);
    document.addEventListener("mousedown", () => {
      dot.style.width = "30px"; dot.style.height = "30px";
    }, true);
    document.addEventListener("mouseup", () => {
      dot.style.width = "18px"; dot.style.height = "18px";
    }, true);
  });
});

const page = await context.newPage();

if (process.env.REAL_RUN) {
  const replay = JSON.parse(process.env.REAL_RUN);
  await page.route("**/api/extract", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        runId: "replay",
        cached: false,
        model: replay.model ?? "gpt-4o-mini",
        cells: replay.cells,
        stats: {},
        durationMs: replay.durationMs ?? 2140,
      }),
    }),
  );
}

/**
 * Scroll a target into view over a fixed duration.
 *
 * Playwright's scrollIntoViewIfNeeded() snaps instantly, which on camera reads as a
 * glitch rather than a movement. CSS `behavior: "smooth"` is the obvious replacement but
 * is unusable for a recording rig: its duration is browser-defined and unknowable, it
 * fires no completion event, and it degrades to an instant jump under
 * prefers-reduced-motion — silently putting the snap back. So tween scrollTop by hand:
 * the duration is ours, the promise resolves exactly when the movement ends, and no
 * media query can switch it off.
 */
async function smoothScrollIntoView(locator, { duration = 450 } = {}) {
  await locator.evaluate((el, ms) => new Promise((resolve) => {
    // scrollIntoView walks to the right container for us; doing it by hand means finding
    // the nearest actually-scrollable ancestor, which here is the results column.
    let scroller = el.parentElement;
    while (scroller) {
      const overflow = getComputedStyle(scroller).overflowY;
      const scrollable = overflow === "auto" || overflow === "scroll";
      if (scrollable && scroller.scrollHeight > scroller.clientHeight) break;
      scroller = scroller.parentElement;
    }
    scroller ??= document.scrollingElement;

    const view = scroller === document.scrollingElement
      ? { top: 0, height: window.innerHeight }
      : (({ top, height }) => ({ top, height }))(scroller.getBoundingClientRect());
    const box = el.getBoundingClientRect();

    // Already comfortably in frame: don't spend a beat of the recording on a no-op.
    if (box.top >= view.top && box.bottom <= view.top + view.height) return resolve();

    const from = scroller.scrollTop;
    const to = from + box.top - view.top - (view.height - box.height) / 2;
    const started = performance.now();
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

    (function frame(now) {
      const t = Math.min(1, (now - started) / ms);
      scroller.scrollTop = from + (to - from) * ease(t);
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    })(started);
  }), duration);
}

/** Move the pointer in small steps so the cursor reads as travelling, not teleporting. */
async function glideTo(locator, { steps = 22 } = {}) {
  await smoothScrollIntoView(locator);
  const box = await locator.boundingBox();
  if (!box) throw new Error("no bounding box for target");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps });
  return box;
}

const wait = (ms) => page.waitForTimeout(ms);

console.log({
  URL,
  WIDTH,
  FPS,
  COLORS,
  WITH_PDF,
  CHROME_PATH: process.env.CHROME_PATH,
  REAL_RUN: process.env.REAL_RUN
});

/**
 * Glide to a cited span in the document. A span that wraps is an inline box whose
 * bounding-box centre can fall outside the text, so aim at its first line instead.
 */
async function glideToSpan(locator, { steps = 22 } = {}) {
  await smoothScrollIntoView(locator);
  const point = await locator.evaluate((el) => {
    const first = el.getClientRects()[0];
    return { x: first.left + Math.min(first.width / 2, 60), y: first.top + first.height / 2 };
  });
  await page.mouse.move(point.x, point.y, { steps });
  return point;
}

/**
 * The sample contract as a PDF, made here so the recording needs no fixture file. It is
 * printed by a second, unrecorded browser context and handed to the page's real file
 * input, so what the frames show is the app reading an actual PDF.
 */
async function sampleAsPdf(text) {
  const printer = await browser.newContext();
  const sheet = await printer.newPage();
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  await sheet.setContent(
    `<pre style="margin:0;font:9pt/1.5 'Courier New',monospace;white-space:pre-wrap">${escaped}</pre>`,
  );
  const buffer = await sheet.pdf({
    format: "Letter",
    margin: { top: "1in", right: "1in", bottom: "1in", left: "1in" },
  });
  await printer.close();
  return buffer;
}

await page.goto(URL, { waitUntil: "networkidle" });
await page.mouse.move(640, 700);
const pdf = WITH_PDF ? await sampleAsPdf(await page.locator("textarea").inputValue()) : null;
await wait(1400);

// The page opens on the pitch. Hold it for a beat, then bring the tool up so it fills
// the frame — the workspace is one viewport tall, so centring it is the same as docking it.
await smoothScrollIntoView(page.locator("#workspace"), { duration: 800 });
await wait(700);

// 1. A PDF goes in. The schema stays as it is; only the document changes.
if (pdf) {
  const upload = page.getByRole("button", { name: "Upload PDF" });
  await glideTo(upload);
  await wait(400);
  const chooser = page.waitForEvent("filechooser");
  await upload.click();
  await (await chooser).setFiles({
    name: "services-agreement.pdf",
    mimeType: "application/pdf",
    buffer: pdf,
  });
  await page.locator("[data-pdf-note]").waitFor({ timeout: 30000 });
  await wait(1700);
}

// 2. Run the extraction. The right pane switches to the Result tab by itself, so the
// payoff frame — highlights on the left beside the cited values on the right — arrives
// without any scrolling.
const extract = page.getByRole("button", { name: "Extract", exact: true });
await glideTo(extract);
await wait(500);
await extract.click();
await page.locator("ul[data-results]").waitFor({ timeout: 60000 });
await wait(1500);

// Every step below names a field. On a live run a field can come back not found, and a
// row with nothing to cite is not a button — so each step is skipped rather than failed.
const rows = page.locator("ul[data-results] li button");
const row = (name) => rows.filter({ hasText: name }).first();
const span = (key) => page.locator(`mark.cite[aria-label$=" for ${key}"]`).first();
const exists = async (locator) => (await locator.count()) > 0;

// 3. Click a cited field — it pins, and the document scrolls to its numbered highlight.
if (await exists(row("Total fee (USD)"))) {
  await glideTo(row("Total fee (USD)"));
  await wait(700);           // hover preview
  await row("Total fee (USD)").click();
  await wait(1700);          // pinned highlight
}

// 4. The link runs the other way too: click a highlight and the result list scrolls to
// the row it belongs to.
if (await exists(span("auto_renews"))) {
  const point = await glideToSpan(span("auto_renews"));
  await wait(500);
  await page.mouse.click(point.x, point.y);
  await wait(1800);
}

// 5. Step through the citations in reading order. Both panes follow.
const next = page.getByRole("button", { name: "Next citation" });
if (await exists(next)) {
  await glideTo(next);
  await wait(300);
  for (let i = 0; i < 2; i++) {
    await next.click();
    await wait(1200);
  }
}

// 6. Rest on the field the document does not contain.
const nullRow = page.locator("ul[data-results] li").filter({ hasText: "Termination notice" }).first();
await glideTo(nullRow);
await wait(2200);

// 7. The same result as the JSON a caller would get.
const json = page.getByRole("button", { name: "JSON", exact: true });
await glideTo(json);
await wait(400);
await json.click();
await page.mouse.move(640, 760, { steps: 14 });
await wait(2400);

await wait(600);
await page.close();          // the video is only flushed once the page closes
await context.close();
await browser.close();

const webm = readdirSync(workDir).find((f) => f.endsWith(".webm"));
if (!webm) {
  console.error(`No .webm was written to ${workDir} — recording failed.`);
  process.exit(1);
}
const source = path.join(workDir, webm);
const palette = path.join(workDir, "palette.png");

const ff = (args) => execFileSync(ffmpegPath, ["-y", "-v", "error", ...args]);

// Two passes: build a palette tuned to this clip, then map frames onto it. A single-pass
// GIF of a mostly-white page with one accent colour bands badly.
const chain = `fps=${FPS},scale=${WIDTH}:-1:flags=lanczos`;
ff(["-i", source, "-vf", `${chain},palettegen=max_colors=${COLORS}:stats_mode=diff`, palette]);
ff([
  "-i", source, "-i", palette,
  "-lavfi", `${chain}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
  GIF,
]);
ff(["-i", source, "-movflags", "+faststart", "-pix_fmt", "yuv420p",
    "-vf", "scale=1280:-2", "-crf", "26", MP4]);

rmSync(workDir, { recursive: true, force: true });

for (const f of [GIF, MP4]) {
  const { size } = await import("node:fs").then((fs) => fs.statSync(f));
  console.log(`${f}  ${(size / 1024 / 1024).toFixed(1)} MB`);
}
