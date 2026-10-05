/**
 * Centre `el` inside `pane` by moving the pane's own scroll position.
 *
 * Deliberately not scrollIntoView(): that walks every scrollable ancestor up to the window
 * and drags the whole page with it. If the pane has nothing to scroll, or is hidden (on a
 * phone only one pane shows at a time), this does nothing.
 */
export function scrollPaneTo(pane: HTMLElement | null, el: HTMLElement | null | undefined) {
  if (!pane || !el) return;
  if (pane.scrollHeight <= pane.clientHeight) return;

  const paneBox = pane.getBoundingClientRect();
  const box = el.getBoundingClientRect();

  // Already comfortably in view: leave the scroll position alone.
  if (box.top >= paneBox.top && box.bottom <= paneBox.bottom) return;

  pane.scrollTo({
    top: pane.scrollTop + box.top - paneBox.top - (pane.clientHeight - box.height) / 2,
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
  });
}
