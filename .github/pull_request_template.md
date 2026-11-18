## Summary

<!-- What does this PR do and why? 1-3 sentences. -->

## Feature preview

<!-- For new user-facing features: attach a screenshot or recording (drag & drop into this section) so reviewers see the change before reading the code. Delete this section for non-feature PRs. (AppFlowy's PR-template practice, majors-research wave 9.) -->

## Changes

<!-- Bullet list of the meaningful changes. -->

## Testing

- [ ] `make test` green (new/updated unit tests for `src/lib` logic)
- [ ] `make lint` and `make typecheck` clean
- [ ] `make e2e` run for risky/UI changes (175 checks, local)

## Checklist

- [ ] Conventional Commit PR title (`feat:`, `fix:`, `chore:`, `docs:`, `ci:`, `test:`)
- [ ] PR targets `develop` (releases: `develop → main` with `release:` title)
- [ ] `PROJECT_STATUS.md` updated (status rows / `In flight` / `Next up` / `Last updated`)
- [ ] No secrets or local-only files in the diff (`.env`, `db/`, logs, screenshots dir)
- [ ] Linked issue (`Closes #N`) or explains why none exists
