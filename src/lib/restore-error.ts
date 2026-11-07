/**
 * Typed restore-backup failures with stable, machine-readable codes.
 *
 * Mirrors export-errors.ts (issue #85): a user picking the wrong file is an
 * EXPECTED failure — the app shell maps `code` to the user-facing toast and
 * must not spam console.error (real, unexpected errors still log). Found by
 * the import/export round-trip E2E pass: the restore path used to log every
 * failure, unlike the export path.
 *
 * Dependency-free on purpose so the app shell can `instanceof` it cheaply.
 */

export type RestoreErrorCode = "notABackup";

/** English message per restore failure code (surfaced as a toast). */
export const RESTORE_ERROR_MESSAGES: Record<RestoreErrorCode, string> = {
  notABackup: "Could not restore that backup file.",
};

export class RestoreError extends Error {
  readonly code: RestoreErrorCode;

  constructor(message: string, code: RestoreErrorCode = "notABackup") {
    super(message);
    this.name = "RestoreError";
    this.code = code;
  }
}
