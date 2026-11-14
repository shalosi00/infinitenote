/**
 * Stale-dialog-dismissal guard (issue #223).
 *
 * Radix `@radix-ui/react-dismissable-layer` 1.2.1 (pulled in by
 * @radix-ui/react-dialog 1.3.x) defers a pointerdown-outside dismissal to the
 * `click` event: the layer arms on `pointerdown` outside, then re-fires the
 * dismissal when the click lands (`handleAndDispatchPointerDownOutsideEvent`
 * via a document-level `once` click listener, plus a `setTimeout(0)` fallback).
 * While a dialog is CLOSING, its DismissableLayer stays armed for the whole
 * exit-animation window (~200-300 ms): a click that RE-OPENS the dialog in
 * that window (Escape, then an immediate click on the same sidebar button)
 * arms the stale dismissal, React's onClick sets open=true, and radix's
 * deferred onDismiss then flips it back to false — the dialog never renders.
 *
 * The app-side signal is exact and needs no timing heuristics: the dismissal
 * carries its ORIGINAL pointerdown event, and a pointerdown that PREDATES the
 * dialog's current open instant cannot belong to this open. Such a dismissal
 * is stale by definition and must be swallowed.
 */

/**
 * True when a dismissal's original interaction predates the dialog's current
 * open instant (both values are DOMHighResTimeStamp milliseconds).
 *
 * `openedAt <= 0` means no open instant was recorded — the guard then never
 * reports stale (defensive: the calling wrapper always stamps before its
 * DismissableLayer can exist, but a zero default must not silently swallow
 * real dismissals if wiring ever changes).
 */
export function isStaleDismissal(originalEventTimeStamp: number, openedAt: number): boolean {
  return openedAt > 0 && originalEventTimeStamp < openedAt;
}
