"use client";

/**
 * In-page find bar — OneNote "Find on this page" parity (issue #301).
 *
 * A small floating, NON-modal bar in the browser-find shape: input,
 * honest "n of m" counter, prev/next buttons, close. Mounted by note-app
 * only while `findOpen` is true, KEYED by nothing — the store closes it
 * on page switches (selectPage/revealSelection set `findOpen: false`),
 * so stale element ids from a previous page can never navigate.
 *
 * Zero effects by design (the react-hooks/set-state-in-effect rule and
 * the wave-12 prefill lesson): every state change is event-driven —
 * typing recomputes matches and jumps to the first one, Enter/Shift+Enter
 * (and the buttons) cycle with wrap-around via stepMatchIndex, Esc is
 * handled by the app's capture-phase global handler (it also returns
 * focus to the canvas). The input is the keyboard home: focus never
 * leaves it while cycling, so navigation keeps working.
 *
 * Matching policy lives in src/lib/page-find.ts (pure, unit-pinned);
 * selection + scrolling live in the canvas's CanvasApi (gotoFindMatch —
 * the shape-library auto-select precedent, scrollToContent for the
 * viewport). The bar itself never touches the scene.
 */
import { useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/lib/store";
import type { CanvasApi } from "@/lib/excalidraw-utils";
import { stepMatchIndex, type PageFindMatch } from "@/lib/page-find";

export function FindBar({ getApi }: { getApi: () => CanvasApi | null }) {
  const setFindOpen = useAppStore((s) => s.setFindOpen);
  const requestCanvasFocus = useAppStore((s) => s.requestCanvasFocus);
  const [query, setQuery] = useState("");
  const [count, setCount] = useState(0);
  const [position, setPosition] = useState(0); // 1-based; 0 = no current match
  const idxRef = useRef(-1);

  const close = () => {
    setFindOpen(false);
    // browser-find semantics: closing the bar hands the keyboard back to
    // the canvas (the store's canvasFocus bump focuses the interactive
    // container — the wave-13 wrapper listener made that reliable)
    requestCanvasFocus();
  };

  /** Recompute matches for the query and navigate to the target index
   *  (wrap-around via the pinned stepMatchIndex). One navigation = one
   *  gotoFindMatch (select + scroll); the input keeps DOM focus. */
  const navigate = (q: string, target: number) => {
    const api = getApi();
    const matches: PageFindMatch[] = q && api ? api.findMatches(q) : [];
    setCount(matches.length);
    if (!q) {
      idxRef.current = -1;
      setPosition(0);
      return;
    }
    if (!matches.length) {
      idxRef.current = -1;
      setPosition(0);
      return;
    }
    const idx = stepMatchIndex(target, matches.length, 0);
    idxRef.current = idx;
    setPosition(idx + 1);
    api?.gotoFindMatch(matches[idx]);
  };

  const counterText = !query
    ? ""
    : count === 0
      ? "No matches"
      : `${position} of ${count}`;

  return (
    <div
      data-testid="find-bar"
      className="absolute right-3 top-3 z-40 flex items-center gap-1 rounded-lg border bg-background/95 p-1.5 shadow-md backdrop-blur-sm"
      role="search"
      aria-label={"Find on this page"}
    >
      <Input
        data-testid="find-input"
        autoFocus
        value={query}
        onChange={(e) => {
          const q = e.target.value;
          setQuery(q);
          navigate(q, 0);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const delta = e.key === "ArrowUp" || e.shiftKey ? -1 : 1;
            const from = idxRef.current === -1 ? 0 : idxRef.current + delta;
            navigate(query, from);
          }
        }}
        placeholder={"Find on page"}
        aria-label={"Find on this page"}
        className="h-8 w-44 text-sm sm:w-56"
      />
      <span
        data-testid="find-counter"
        className="min-w-16 px-1 text-center text-xs tabular-nums text-muted-foreground"
        aria-live="polite"
      >
        {counterText}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        aria-label="Previous match"
        data-testid="find-prev"
        disabled={count === 0}
        onClick={() => navigate(query, idxRef.current === -1 ? 0 : idxRef.current - 1)}
      >
        <ChevronUp className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        aria-label="Next match"
        data-testid="find-next"
        disabled={count === 0}
        onClick={() => navigate(query, idxRef.current === -1 ? 0 : idxRef.current + 1)}
      >
        <ChevronDown className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        aria-label="Close find bar"
        data-testid="find-close"
        onClick={close}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
