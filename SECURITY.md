# Security Policy

InfiniteNote is a local-first note app: your notes live in your browser's
IndexedDB (or your own sync folder) and there is no server, no account and no
telemetry anywhere in the codebase. That architecture shapes this policy —
most of the classic web-app attack surface simply does not exist here, and the
threat model below says explicitly what remains out of scope.

## Supported Versions

Only the latest [release](https://github.com/shalosi00/infinitenote/releases)
is supported with security updates. Please reproduce any finding against it
before reporting.

## Reporting a Vulnerability

Please report vulnerabilities through
[private vulnerability reporting](https://github.com/shalosi00/infinitenote/security/advisories/new)
— **with a proof of concept** that demonstrates the issue. This channel is
private, keeps details out of public issue trackers until a fix ships, and
lets us credit you in the advisory.

- Include: app version, platform (Linux / Android, browser), steps or PoC to
  reproduce, and the impact you actually demonstrated (not the theoretical
  maximum).
- You should get an acknowledgement within a few days. This is a
  small project maintained in spare time — disclosure timelines are
  coordinated with you, defaulting to 90 days.
- We do **not** offer bounties.

For general bugs (crashes, data loss without a security dimension, feature
requests), use the issue templates instead — see
[CONTRIBUTING.md](CONTRIBUTING.md).

## Rules for reporting

Reviewing a finding we cannot reproduce costs as much as fixing a real one,
so a few rules keep the process workable:

- **Verify before submitting.** Confirm the issue exists in the latest
  release and that you actually carried out the steps your conclusion relies
  on. Reports that do not hold up on re-testing may be closed.
- **One active report per finding.** Do not re-file or cross-post the same
  finding to multiple channels.
- **AI-generated reports are not accepted.** Unverified automated findings
  are closed on sight; only send what you reproduced yourself.

## Scope

In scope: application code (`src/`), the Tauri desktop packaging
(`src-tauri/`), the Android TWA shell (`android-twa/`), build and CI
configuration, and anything that can corrupt, exfiltrate or destroy a user's
notes in a scenario the user did not deliberately set up (e.g. XSS through
note content rendered by the app, malicious input via import files).

## Areas outside InfiniteNote's threat model

These follow the browser vendors' own stance (see
[Chromium's security FAQ](https://chromium.googlesource.com/chromium/src.git/+/master/docs/security/faq.md))
— a note app inside a browser sandbox inherits it:

- **Denial of service via imported content.** A crafted note/PDF that freezes
  the tab is recoverable by closing the tab; it is not treated as a security
  vulnerability. Data-integrity bugs (silent content corruption on import)
  are in scope as normal bugs.
- **Physically-local attacks.** Anyone with your unlocked device or disk
  image can read the app's IndexedDB and sync folder. Your OS account, disk
  encryption and screen lock are the controls.
- **Data at rest is not encrypted.** Documented design: notes are stored in
  plain IndexedDB / plain files so they remain inspectable and portable.
  Use OS-level encryption if you need confidentiality at rest.
- **Compromised machines and malicious browser extensions.** Anything with
  page access can read the notes a browser can read; that is the platform's
  responsibility, not the app's.
- **Vulnerabilities in dependencies.** Report those upstream to the affected
  package. We track them here via Dependabot (alerts + security updates) and
  the Advisory-DB cross-check in `scripts/audit-lockfile.py`; see
  [docs/SECURITY_AUDIT_2026-11-15.md](docs/SECURITY_AUDIT_2026-11-15.md)
  for the current measured posture.

## Hardening already in place

For reference, the repo's baseline (measured in the
[2026-11-15 security audit](docs/SECURITY_AUDIT_2026-11-15.md)): CodeQL
analysis, secret scanning with push protection, Dependabot alerts and
automated security fixes, SHA-pinned third-party actions with least-privilege
workflow tokens, required-status branch protection on `main` and `develop`,
and the lockfile Advisory-DB auditor as a local gate command.
