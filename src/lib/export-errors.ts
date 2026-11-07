/**
 * Typed export failures with stable, locale-independent codes (issue #85).
 *
 * Lives in its own dependency-free module so the app shell can `instanceof`
 * it without dragging the Excalidraw/jsPDF runtime into the main bundle:
 * pdf-export throws, note-app maps `code` to a localized toast.
 */

export type ExportErrorCode = "emptyPage";

export class ExportError extends Error {
  readonly code: ExportErrorCode;

  constructor(message: string, code: ExportErrorCode = "emptyPage") {
    super(message);
    this.name = "ExportError";
    this.code = code;
  }
}
