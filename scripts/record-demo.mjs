/**
 * Records the README demo and encodes it to docs/demo.gif + docs/demo.mp4.
 *
 *   npm run record:demo
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
 *   REAL_RUN     JSON {cells:[...]} — when set, /api/extract is answered from this
 *                instead of being called. For recording somewhere the deployment is
 *                unreachable; pass a row from the extraction_runs table so the frames
 *                still show real model output.
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

await page.goto(URL, { waitUntil: "networkidle" });
await page.mouse.move(640, 700);
await wait(1200);

// 1. Run the extraction.
const extract = page.getByRole("button", { name: "Extract" });
await glideTo(extract);
await wait(500);
await extract.click();
await page.getByText("cited spans").waitFor({ timeout: 60000 });

// Bring the results panel up straight away. The payoff frame is highlights on the left
// beside the cited values on the right — every second spent looking at the schema builder
// after the run is a second of the GIF doing nothing.
const resultPanel = page.locator("h2", { hasText: "Result" }).first();
await smoothScrollIntoView(resultPanel, { duration: 650 });
await wait(1600);

// 2. Click two cited fields — the highlight pins and the document scrolls to it.
const rows = page.locator("ul li[role='button']");
for (const name of ["Total fee (USD)", "Governing law"]) {
  const row = rows.filter({ hasText: name }).first();
  await glideTo(row);
  await wait(900);            // hover preview
  await row.click();
  await wait(2000);           // pinned highlight
}

// 3. Rest on the field the document does not contain.
const nullRow = page.locator("ul li").filter({ hasText: "Termination notice" }).first();
await glideTo(nullRow);
await wait(2600);

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
