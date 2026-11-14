import { describe, expect, it } from "bun:test";
import { isStaleDismissal } from "../dialog-dismiss-guard";

/**
 * Unit pins for the stale-dialog-dismissal guard (issue #223).
 *
 * The E2E shape this logic serves — Escape closes the sync dialog and the
 * very next click re-opens it — is e2e/sync.spec.ts HWR-style serial flow;
 * the radix 1.3.x deferred pointerdown-outside dismissal fired 8 ms after
 * the re-open and killed it (measured store trajectory: `open false -> true`
 * then radix `onOpenChange(false)` 8 ms later). These pins hold the exact
 * predicate the wrappers apply.
 */
describe("isStaleDismissal (issue #223 stale-dialog-dismissal guard)", () => {
  it("a dismissal whose pointerdown predates the open instant is stale", () => {
    // the measured race: pointerdown at t, the wrapper stamps open at t+2ms,
    // radix's deferred dismiss fires with the ORIGINAL pointerdown's stamp
    expect(isStaleDismissal(1581.4, 1583.1)).toBe(true);
  });

  it("an interaction after the open instant is a real dismissal request", () => {
    // scrim click / outside click on an open dialog must keep dismissing
    expect(isStaleDismissal(5000, 1583.1)).toBe(false);
  });

  it("a dismissal with no recorded open instant is never stale (defensive)", () => {
    expect(isStaleDismissal(1581.4, 0)).toBe(false);
    expect(isStaleDismissal(1581.4, -1)).toBe(false);
  });

  it("equality is not stale — the interaction belongs to the open", () => {
    expect(isStaleDismissal(1583.1, 1583.1)).toBe(false);
  });

  it("fractional DOMHighResTimeStamp ordering follows the plain number comparison", () => {
    expect(isStaleDismissal(100.0001, 100.0002)).toBe(true);
    expect(isStaleDismissal(100.0002, 100.0001)).toBe(false);
  });

  it("a stale dismissal from a PREVIOUS open cycle is still caught after a re-open", () => {
    // open at t0, close, re-open at t1: the stale dismissal armed during the
    // first exit carries a pre-t1 pointerdown stamp
    expect(isStaleDismissal(1000, 1400)).toBe(true);
  });
});
