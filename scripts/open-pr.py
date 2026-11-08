#!/usr/bin/env python3
"""Open the PR for fix/save-indicator-flicker -> develop. Never prints the token."""
import json
import re
import subprocess
import urllib.request


def api(method: str, path: str, body: dict | None = None) -> dict:
    url = subprocess.check_output(["git", "remote", "get-url", "origin"],
                                  cwd="/home/z/my-project", text=True).strip()
    token = re.match(r"https://[^:]+:([^@]+)@", url).group(1)
    req = urllib.request.Request(
        f"https://api.github.com{path}",
        data=json.dumps(body).encode() if body else None,
        method=method,
        headers={"Authorization": f"Bearer {token}",
                 "Accept": "application/vnd.github+json"},
    )
    with urllib.request.urlopen(req) as r:
        return json.load(r)


body = """## Summary

Fixes the flickering "Saved" header indicator: Excalidraw reports appState-only changes (pan / zoom / selection / tool switches / scene-restore replay) through onChange, and every one of them used to schedule an autosave of identical content — so the label strobed "Saving…"/"Saved" with zero edits. While root-causing the undo path, a real data bug surfaced (soft-deleted tombstones were persisted), and the new five-viewport overlap audit found one genuine header overflow below 360px. All three are fixed here.

Closes #140

## Changes

- **Content-gated autosave**: `sceneSignature` (id@version:image-status per element + sorted file set, order-independent — z-order edits bump element versions in Excalidraw 0.18, verified in the library source) now gates the stash; the baseline is primed from `initialData`, so the mount replay no longer counts as an edit. Legacy stale-`pending` scenes still normalize through one first save.
- **Undo inside the debounce window** no longer persists: when the scene returns to the persisted state, the pending stash (and its timer) is dropped instead of letting a stale timer write the superseded scene.
- **Tombstone filter**: `sanitizeScene` drops `isDeleted` elements (undo/redo leftovers) and their files at the persistence boundary. They never render but had been written to the DB and leaked into sync folders/backups since v1.0 — polluted pages self-heal through one normalizing save.
- **Deferred label**: "Saving…" appears only after 200ms — fast IndexedDB commits jump straight to "Saved"; slow saves and failures stay honest.
- **Header below 360px**: the theme toggle + separator yield (`max-[360px]:hidden`) instead of overflowing the viewport edge (29px overflow at 320px); theming stays reachable via the sidebar Themes gallery.
- Dev probes committed: `scripts/flicker-probe.ts` (50ms label sampling across idle/select/zoom/pan) and `scripts/header-probe.ts` (header child boxes at 320px). `.gitignore` now excludes `src/lib/__tests_stage__/` (staging-bundle sync dir).

## Testing

- [x] `make test` green — 446 unit tests (+12: `sceneSignature` ×10, tombstone filter ×2)
- [x] `make lint` and `make typecheck` clean
- [x] `make e2e` green — 114 E2E checks (+7), including:
  - new `e2e/save-indicator-calm.spec.ts`: organic autosave still ends on "Saved"; viewport-only churn keeps the label steady (zero transitions in a 1.6s window); an edit undone inside the debounce window never persists (label never moves, reload shows the pre-edit scene)
  - new `e2e/ui-overlap.spec.ts`: pairwise bounding-box + viewport-clipping audit of every visible interactive control in the header, title bar and sidebar at 1280/900/768/390/320 — all clean
  - existing suites unaffected: persistence, imports, exports, round-trips, sync, themes, audio all green
- [x] Flicker probe before/after: idle 6→1 transitions (the 1 is the documented first-boot normalization), select/zoom/pan 2-6→**0**

## Checklist

- [x] Conventional Commit PR title (`fix(canvas): …`)
- [x] PR targets `develop`
- [x] `PROJECT_STATUS.md` updated (overall state, autosave evidence row, totals 446/114, recent-history entry) + `docs/WORKLOG.md` session entry
- [x] No secrets or local-only files in the diff
- [x] Linked issue (`Closes #140`)"""

pr = api("POST", "/repos/shalosi00/infinitenote/pulls", {
    "title": "fix(canvas): calm the save indicator — content-gated autosave + tombstone filter",
    "head": "fix/save-indicator-flicker",
    "base": "develop",
    "body": body,
})
print(f"PR #{pr['number']}: {pr['html_url']}")

# attach to the v1.11.0 milestone
api("PATCH", f"/repos/shalosi00/infinitenote/issues/{pr['number']}", {"milestone": 12})
print("milestone: v1.11.0")
