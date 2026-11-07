/**
 * Quick notes — pure helpers, no I/O.
 *
 * OneNote-style quick capture: a dedicated "Quick Notes" notebook/section
 * plus a "today" daily page. Dates are LOCAL calendar days (a daily page is
 * a user-facing concept — UTC would split evenings across two pages).
 */

/** Name of the auto-managed notebook + section (created on first use). */
export const QUICK_NOTES_NOTEBOOK_NAME = "Quick Notes";
export const QUICK_NOTES_SECTION_NAME = "Quick Notes";

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Local calendar date key, e.g. "2026-10-19" — the daily page title. */
export function todayKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Title for a fresh quick note: "Quick note 2026-10-19 14:32:07" (24h clock).
 * Seconds resolution (issue #95): two quick notes inside one minute must
 * not collide into identical titles. */
export function quickNoteTitle(d: Date = new Date()): string {
  return `Quick note ${todayKey(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** Matches titles that are exactly a daily page key ("YYYY-MM-DD"). */
const DAILY_TITLE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True when a page title is exactly a daily date key — the Today target. */
export function isDailyPageTitle(title: string): boolean {
  return DAILY_TITLE_RE.test(title);
}
