# Test plan — internal page links (OneNote "Copy Link to Page" parity)

Issue #295 (wave 13, v1.17.0). Every E2E id below is pinned in
`e2e/page-links.spec.ts`; every unit id group in
`src/lib/__tests__/page-links.test.ts`.

## Policy (pure module `src/lib/page-links.ts`)

- `PAGE_LINK_SCHEME` is `infinitenote:page`; links are `infinitenote:page/<id>`.
- `pageLinkFor` builds the URL from a page id: null for null/undefined/empty/
  whitespace-only ids, ids over `PAGE_LINK_MAX_ID_LENGTH`, and ids carrying
  whitespace or an extra path segment; surrounding whitespace is trimmed.
- `isPageLink` accepts only the scheme WITH an id segment (`infinitenote:page`
  alone is foreign); audio/pdf/file schemes, https URLs, data: URLs and
  prefix-spoofing longer scheme names (`infinitenote:page2/…`) are rejected.
- `pageLinkTargetOf` round-trips with `pageLinkFor`; tolerates surrounding
  whitespace (clipboard pastes often carry a trailing newline) but rejects
  interior whitespace, extra segments and over-cap ids; EVERY foreign or
  malformed link returns null — the canvas then treats it as a foreign link
  (Excalidraw default), never a broken navigation.
- Toast lines are pinned verbatim: copy success ("Page link copied — paste it
  on any page (it opens that page)."), copy failure ("Could not copy the page
  link."), missing target ("That page no longer exists — the link is broken.").

## E2E (`e2e/page-links.spec.ts`, welcome seed)

- **PL-E01** — the "Link to page…" picker lists every alive page EXCEPT the
  currently open one ("Start here" excluded), with breadcrumb meta lines
  naming the target's notebook ("Brainstorm" → Welcome Notebook, "Page 1" →
  My Notebook); clicking a row inserts the link and toasts
  `Linked to "Brainstorm".`; the scene gains exactly one element.
- **PL-E02** — the inserted element is a text element whose `link` carries
  `infinitenote:page/<id>` with the target page title as its label; clicking
  the element navigates to the target page (Brainstorm opens, 0 elements).
- **PL-E03** — the sidebar's "Copy link to page" writes the scheme URL to the
  clipboard (toast: "Page link copied…"); a plain Ctrl+V on another page
  inserts the linked title element (toast: `Linked to "Start here".`), and the
  pasted link navigates back to the source page. Covers the full
  copy → paste → navigate round trip OneNote teaches.
- **PL-E04** — trashing the target page turns the link broken: clicking it
  toasts "That page no longer exists — the link is broken." and does NOT
  navigate; the picker no longer offers the trashed target (alive filter).
  The selection stays on the open page through the trash (the
  nextSelectionAfterPageDelete behavior: a live page in the current section
  keeps the selection).

## Invariants covered elsewhere

- Scene persistence / sync / backups / version history: text elements with a
  `link` field are ordinary scene content — no changes needed, exercised by
  the existing round-trip specs.
- Foreign element links keep Excalidraw's default behavior (open in a new
  tab): `onLinkOpen` only acts on `infinitenote:page` links; the paste path
  only intercepts them (`isPageLink` false → return false → default paste).
- `validateEmbeddable` is untouched: page links are text elements, not
  embeddables — the gate continues to accept only audio/PDF/file embeds.
