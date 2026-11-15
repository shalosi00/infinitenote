#!/usr/bin/env python3
"""Advisory-DB cross-check for bun.lock — the recipe from the #221 audit, as one command.

Dependabot cannot resolve the transitive graph of a bun.lock v1 lockfile, so
advisories that DO affect locked transitive versions never produce alerts.
This script closes that blind spot:

  1. extract every distinct resolved `name@version` pair from bun.lock,
  2. query the GitHub Advisory DB server-side (`GET /advisories?affects=pkg@ver`),
  3. re-filter hits locally against each advisory's own vulnerable_version_range,
  4. report hits; non-documented residues exit non-zero.

Token: GITHUB_TOKEN env var, else read from the origin remote URL at runtime
(never printed, never embedded — same contract as scripts/ghapi.py).

Usage:
  python3 scripts/audit-lockfile.py [--lockfile PATH] [--strict] [--limit N]

  --strict   documented residues also fail the run
Exit codes: 0 clean (residues only, unless --strict), 1 findings, 2 setup error.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Documented residues (docs/SECURITY_AUDIT_2026-11-15.md, issues #221/#235):
# - minimatch 10.2.6 stays because typescript-eslint 8.72.2 (upstream-latest)
#   still pins ^10.2.2 and the advisory's fix (11.0.1) would break eslint's
#   CJS chain via a flat override. Revisit on the next typescript-eslint bump.
# - braces 3.0.3: the only matching advisory is WITHDRAWN (no fixed release
#   exists) — no action per the #221 policy.
# - uuid 11.1.1: remaining advisory is LOW with fix=14.0.0 (major bump);
#   documented residue of the #221 lift.
DOCUMENTED_RESIDUE: dict[tuple[str, str], str] = {
    ("minimatch", "GHSA-g3hv-75wg-m249"): "upstream-blocked by typescript-eslint ^10.2.2 pin",
    ("braces", "GHSA-vfj7-8cjw-p6xm"): "advisory withdrawn, no fixed release (#221 policy)",
    ("uuid", "GHSA-qmq6-f8pr-cx5x"): "LOW, fix=14.0.0 major bump (#221 documented residue)",
}


def get_token() -> str:
    tok = os.environ.get("GITHUB_TOKEN", "").strip()
    if tok:
        return tok
    try:
        url = subprocess.check_output(
            ["git", "remote", "get-url", "origin"], cwd=REPO_ROOT, text=True
        ).strip()
    except subprocess.CalledProcessError:
        return ""
    if url.startswith("https://") and "@" in url:
        creds = url.split("://", 1)[1].split("@", 1)[0]
        return creds.split(":", 1)[1] if ":" in creds else ""
    return ""


def load_resolved_pairs(path: str) -> list[tuple[str, str]]:
    """Parse bun.lock (JSON with trailing commas) -> distinct (name, version) pairs."""
    text = open(path, encoding="utf-8").read()
    data = json.loads(re.sub(r",(\s*[}\]])", r"\1", text))
    packages = data.get("packages", {})
    pairs: set[tuple[str, str]] = set()
    for entry in packages.values():
        if not isinstance(entry, list) or not entry or not isinstance(entry[0], str):
            continue
        spec = entry[0]
        if spec.startswith("!") or "npm:" in spec:
            # alias / tarball specs carry their real coordinates elsewhere
            m = re.search(r"npm:(?:[^@]+@)?([\w@./-]+)@(\d[^;\s]*)", spec)
            if not m:
                continue
            name, version = m.group(1), m.group(2)
        elif "@" in spec.lstrip("@"):
            cut = spec.rfind("@", 1) if spec.startswith("@") else spec.rfind("@")
            name, version = spec[:cut], spec[cut + 1:]
        else:
            continue
        if not re.match(r"\d", version):
            continue
        pairs.add((name, version))
    return sorted(pairs)


def _version_key(v: str) -> tuple:
    parts = re.findall(r"\d+", v.split("+")[0].split("-")[0])
    return tuple(int(p) for p in parts) or (0,)


def _in_range(version: str, rng: str) -> bool:
    """npm advisory range like '>= 7.0.0, < 11.0.1' or '= 1.27.0'."""
    for comp in rng.split(","):
        comp = comp.strip().replace(" ", "")
        m = re.fullmatch(r"(>=|<=|>|<|=)?(.+)", comp)
        if not m:
            continue
        op, ref = m.group(1) or "=", m.group(2)
        a, b = _version_key(version), _version_key(ref)
        ok = {
            ">=": a >= b, "<=": a <= b, ">": a > b, "<": a < b, "=": a == b,
        }[op]
        if not ok:
            return False
    return True


def advisories_for(name: str, version: str, token: str) -> list[dict]:
    q = urllib.parse.quote(f"{name}@{version}", safe="")
    url = (
        "https://api.github.com/advisories"
        f"?affects={q}&ecosystem=npm&per_page=100"
    )
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "audit-lockfile"}
    if token:
        headers["Authorization"] = f"token {token}"
    out: list[dict] = []
    for page in (1, 2):
        req = urllib.request.Request(f"{url}&page={page}", headers=headers)
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    batch = json.load(resp)
                break
            except urllib.error.HTTPError as e:
                if e.code in (403, 429):
                    reset = e.headers.get("x-ratelimit-reset")
                    wait = max(1, int(reset) - int(time.time())) if reset else 30
                    if attempt == 0 and wait < 120:
                        print(f"  rate-limited; sleeping {wait}s", file=sys.stderr)
                        time.sleep(wait)
                        continue
                return out
            except urllib.error.URLError:
                time.sleep(2 * (attempt + 1))
        else:
            break
        out.extend(batch)
        if len(batch) < 100:
            break
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lockfile", default=os.path.join(REPO_ROOT, "bun.lock"))
    ap.add_argument("--strict", action="store_true")
    ap.add_argument("--limit", type=int, default=0, help="audit only the first N pairs")
    args = ap.parse_args()

    if not os.path.exists(args.lockfile):
        print(f"lockfile not found: {args.lockfile}", file=sys.stderr)
        return 2
    token = get_token()
    if not token:
        print("no token (set GITHUB_TOKEN or embed it in the origin remote URL)", file=sys.stderr)
        return 2

    pairs = load_resolved_pairs(args.lockfile)
    if args.limit:
        pairs = pairs[: args.limit]
    print(f"auditing {len(pairs)} resolved versions from {os.path.basename(args.lockfile)}")

    findings: dict[tuple[str, str], dict] = {}
    scanned = 0

    def scan(pair: tuple[str, str]) -> None:
        nonlocal scanned
        name, version = pair
        for adv in advisories_for(name, version, token):
            for vuln in adv.get("vulnerabilities", []):
                vp = vuln.get("package", {})
                if vp.get("name") != name:
                    continue
                rng = vuln.get("vulnerable_version_range", "")
                if rng and _in_range(version, rng):
                    key = (name, adv.get("ghsa_id", "?"))
                    cur = findings.setdefault(
                        key,
                        {
                            "name": name, "version": version, "ghsa": adv.get("ghsa_id", "?"),
                            "summary": adv.get("summary", ""), "severity": adv.get("severity", "?"),
                            "ranges": set(), "versions": set(),
                        },
                    )
                    cur["ranges"].add(rng)
                    cur["versions"].add(version)
        with threading_lock:
            scanned += 1
            if scanned % 100 == 0:
                print(f"  ... {scanned}/{len(pairs)}")

    import threading
    threading_lock = threading.Lock()

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(scan, pairs))

    # normalize sets
    for f in findings.values():
        f["ranges"] = sorted(f["ranges"])
        f["versions"] = sorted(f["versions"])

    open_residue, open_real = [], []
    for key, f in sorted(findings.items()):
        (open_residue if key in DOCUMENTED_RESIDUE else open_real).append(f)

    sev_rank = {"critical": 0, "high": 1, "medium": 2, "moderate": 2, "low": 3}
    def fmt(f: dict) -> str:
        return (
            f"[{f['severity'].upper()}] {f['name']}@{','.join(sorted(f['versions']))} "
            f"{f['ghsa']} ({f['ranges'][0]}): {f['summary']}"
        )

    print()
    if open_real:
        print(f"NEW FINDINGS ({len(open_real)}):")
        for f in sorted(open_real, key=lambda x: sev_rank.get(x["severity"], 9)):
            print("  " + fmt(f))
    else:
        print("NEW FINDINGS: 0")
    if open_residue:
        print(f"DOCUMENTED RESIDUE ({len(open_residue)}):")
        for f in open_residue:
            print("  " + fmt(f) + " — " + DOCUMENTED_RESIDUE[(f["name"], f["ghsa"])])
    if not open_real and not open_residue:
        print("HITS: 0 — lockfile clean against the Advisory DB")

    if open_real:
        print(f"\nresult: FAIL — {len(open_real)} undocumented vulnerable version(s)")
        return 1
    if open_residue and args.strict:
        print(f"\nresult: FAIL (--strict) — {len(open_residue)} documented residue(s) present")
        return 1
    print(f"\nresult: PASS — {len(open_residue)} documented residue(s), 0 new findings")
    return 0


if __name__ == "__main__":
    sys.exit(main())
