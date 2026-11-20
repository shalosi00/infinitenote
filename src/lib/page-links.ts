/**
 * Internal page links — pure policy for the OneNote "Copy Link to Page"
 * parity (wave 13). No DOM, no engine, no Excalidraw imports: everything
 * here runs identically in the browser bundle, in bun unit tests and
 * during SSR.
 *
 * A page link is a TEXT element whose Excalidraw `link` field carries the
 * `infinitenote:page/<id>` marker scheme — the audio/PDF/file-chip marker
 * precedent (those embeddables proved the scheme survives Excalidraw's
 * `sanitizeUrl`, which only rewrites `data:` links to about:blank). There
 * is NO payload: the target page lives in the same local database, so the
 * link is just an id reference, and a pasted or picked link renders as a
 * normal, user-editable text element (OneNote's pasted hyperlink shape).
 *
 * Navigation is handled by the canvas's `onLinkOpen` (the event is
 * cancelable — `preventDefault()` stops Excalidraw's default
 * `window.open`): the id is resolved through the store, and a missing or
 * trashed target toasts instead of navigating.
 */

/**
 * Marker scheme for internal page links. It is also the key the canvas
 * checks before navigation: any OTHER element link keeps Excalidraw's
 * default behavior (open in a new tab), exactly as before.
 */
export const PAGE_LINK_SCHEME = "infinitenote:page";

/** Sanity cap on an id inside a link (UUIDs are 36 chars; be generous). */
export const PAGE_LINK_MAX_ID_LENGTH = 200;

/**
 * Build the link URL for a page id, or null when the id is not linkable.
 * Rejected: empty, whitespace, anything over the length cap, and ids
 * that would embed a second path segment (they would parse as a foreign
 * link later).
 */
export function pageLinkFor(pageId: string | null | undefined): string | null {
  if (!pageId) return null;
  const id = pageId.trim();
  if (!id || id.length > PAGE_LINK_MAX_ID_LENGTH) return null;
  if (id.includes("/") || /\s/.test(id)) return null;
  return `${PAGE_LINK_SCHEME}/${id}`;
}

/** Does this element link mark the element as an internal page link? */
export function isPageLink(link: string | null | undefined): boolean {
  return pageLinkTargetOf(link) !== null;
}

/**
 * Extract the target page id from a page link, or null. The id must be
 * non-empty, within the length cap, and free of whitespace and extra
 * path segments — a malformed link is a FOREIGN link to the canvas
 * (default window.open), never a broken navigation. Surrounding
 * whitespace is tolerated (clipboard text often carries a trailing
 * newline); interior whitespace is not.
 */
export function pageLinkTargetOf(link: string | null | undefined): string | null {
  if (typeof link !== "string") return null;
  if (!link.startsWith(`${PAGE_LINK_SCHEME}/`)) return null;
  const rest = link.slice(PAGE_LINK_SCHEME.length + 1);
  const id = rest.trim();
  if (!id || id.length > PAGE_LINK_MAX_ID_LENGTH) return null;
  if (id.includes("/") || /\s/.test(id)) return null;
  return id;
}

/**
 * The exact toast lines (unit-tested — the pdf-attachment.ts pattern:
 * copy lives in the pure module so UI and tests assert one truth).
 */
export function pageLinkCopiedToast(): string {
  return "Page link copied — paste it on any page (it opens that page).";
}

export function pageLinkCopyFailedToast(): string {
  return "Could not copy the page link.";
}

export function pageLinkMissingToast(): string {
  return "That page no longer exists — the link is broken.";
}
