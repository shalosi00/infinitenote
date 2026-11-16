/**
 * Conventional-commit PR title validation.
 *
 * The release notes, PROJECT_STATUS.md and the dependabot grouping all read
 * PR titles, so a malformed title leaks into every release surface. The
 * majors gate titles in CI (Excalidraw `semantic-pr-title.yml`, Joplin
 * `check-pr-title.yml`, AFFiNE `pr-title-lint.yml`); this repo already
 * writes conventional titles by hand (every merged PR to date conforms) —
 * the `pr-title` workflow runs THIS file (`bun src/lib/pr-title.ts` with
 * the title in `PR_TITLE`) so the practice is enforced, and this module's
 * behavior is pinned by unit tests in the normal test suite.
 *
 * Allowed shapes:
 *   <type>: <subject>
 *   <type>(<scope>): <subject>
 *   <type>!: <subject>
 *   <type>(<scope>)!: <subject>
 *
 * <type> is one of {@link PR_TITLE_TYPES}. <scope> is lowercase
 * letters/digits and `._/-` (matches real scopes in the history: deps,
 * security, sync). The subject must be at least 4 characters. Titles are a
 * single line; surrounding whitespace is tolerated.
 */

export const PR_TITLE_TYPES = [
  "build",
  "chore",
  "ci",
  "docs",
  "feat",
  "fix",
  "perf",
  "refactor",
  "revert",
  "style",
  "test",
] as const;

export interface PrTitleCheck {
  ok: boolean;
  /** Empty when ok; a short human-readable complaint otherwise. */
  reason: string;
}

const TYPE_GROUP = PR_TITLE_TYPES.join("|");
// scope: lowercase word-chars plus ._/- (no spaces, no uppercase)
const PR_TITLE_RE = new RegExp(
  `^(${TYPE_GROUP})(\\([a-z0-9._/-]+\\))?!?: (.+)$`,
);

export function validatePrTitle(title: string): PrTitleCheck {
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "title is empty" };
  }
  if (/[\r\n]/.test(trimmed)) {
    return { ok: false, reason: "title must be a single line" };
  }
  const match = PR_TITLE_RE.exec(trimmed);
  if (!match) {
    // Give the most useful complaint for the common failure shapes.
    const colon = trimmed.indexOf(":");
    if (colon > 0) {
      const head = trimmed.slice(0, colon);
      const scopeMatch = /^([a-z]+)(\([a-z0-9._/-]+\))?!?$/.exec(head);
      if (scopeMatch && !PR_TITLE_TYPES.includes(scopeMatch[1] as never)) {
        return {
          ok: false,
          reason: `unknown type "${scopeMatch[1]}" — allowed: ${TYPE_GROUP}`,
        };
      }
      if (/^[A-Z]/.test(head)) {
        return {
          ok: false,
          reason: `type must be lowercase ("${head}")`,
        };
      }
      const subject = trimmed.slice(colon + 1).trim();
      if (subject.length < 4) {
        return {
          ok: false,
          reason: `subject too short (${subject.length} chars, need >= 4)`,
        };
      }
    }
    return {
      ok: false,
      reason:
        'expected "<type>: <subject>" or "<type>(<scope>): <subject>", ' +
        `type one of: ${TYPE_GROUP}`,
    };
  }
  const subject = match[3];
  if (subject.length < 4) {
    return {
      ok: false,
      reason: `subject too short (${subject.length} chars, need >= 4)`,
    };
  }
  return { ok: true, reason: "" };
}

/** CLI entry — the pr-title workflow runs this file directly under bun. */
if (import.meta.main) {
  const title = process.env.PR_TITLE ?? "";
  const result = validatePrTitle(title);
  if (!result.ok) {
    console.error(
      `::error::PR title check FAILED\n  title: "${title}"\n  problem: ${result.reason}\n` +
        '  expected "<type>: <subject>" or "<type>(<scope>): <subject>" ' +
        `with type one of: ${PR_TITLE_TYPES.join(", ")}`,
    );
    process.exit(1);
  }
  console.log(`PR title OK: "${title}"`);
}
