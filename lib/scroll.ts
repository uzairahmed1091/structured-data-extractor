/**
 * Centre `el` inside `pane` by moving the pane's own scroll position.
 *
 * Deliberately not scrollIntoView(): that walks every scrollable ancestor up to the window
 * and drags the whole page with it. If the pane isn't actually scrolling (the stacked
 * phone layout, where the page scrolls instead) this does nothing, which is the point —
 * tapping one side should never yank the page to the other.
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
