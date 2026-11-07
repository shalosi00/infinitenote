/**
 * Typed export failures with stable, machine-readable codes (issue #85).
 *
 * Lives in its own dependency-free module so the app shell can `instanceof`
 * it without dragging the Excalidraw/jsPDF runtime into the main bundle:
 * pdf-export throws, note-app maps `code` to the user-facing message.
 */

export type ExportErrorCode = "emptyPage";

/** English message per export failure code (surfaced as a toast). */
export const EXPORT_ERROR_MESSAGES: Record<ExportErrorCode, string> = {
  emptyPage: "Nothing to export — this page is empty.",
};

export class ExportError extends Error {
  readonly code: ExportErrorCode;

  constructor(message: string, code: ExportErrorCode = "emptyPage") {
    super(message);
    this.name = "ExportError";
    this.code = code;
  }
}
