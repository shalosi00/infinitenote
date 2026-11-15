#!/usr/bin/env python3
"""Deep secret scan over the full history of origin/main (InfiniteNote).

Scans every unique blob reachable from origin/main for credential patterns,
plus tracked-path hygiene (env files, key files, auth files). Never prints
the live token; only reports whether the token literal appears in history.
"""
import re
import subprocess
import sys
from collections import defaultdict

REPO = "/home/z/my-project"

PATTERNS = [
    ("github_token", re.compile(rb"gh[pousr]_[A-Za-z0-9]{20,}")),
    ("github_pat", re.compile(rb"github_pat_[A-Za-z0-9_]{20,}")),
    ("aws_access_key", re.compile(rb"AKIA[0-9A-Z]{16}")),
    ("aws_secret", re.compile(rb"aws_secret_access_key\s*[:=]\s*\S{8,}", re.I)),
    ("private_key", re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY")),
    ("slack_token", re.compile(rb"xox[baprs]-[A-Za-z0-9-]{10,}")),
    ("google_api_key", re.compile(rb"AIza[0-9A-Za-z_\-]{35}")),
    ("openai_key", re.compile(rb"sk-[A-Za-z0-9]{20,}")),
    ("anthropic_key", re.compile(rb"sk-ant-[A-Za-z0-9_\-]{20,}")),
    ("jwt", re.compile(rb"eyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{5,}")),
    ("db_uri_creds", re.compile(rb"(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|amqp)://[^\s:/@]+:[^\s@]+@", re.I)),
    ("auth_token_assignment", re.compile(rb"_authToken\s*=\s*\S{10,}")),
    ("password_assignment", re.compile(rb"(?:password|passwd)\s*[:=]\s*['\"][^'\"\s]{8,}['\"]", re.I)),
    ("remote_url_creds", re.compile(rb"https://[A-Za-z0-9_\-]+:[A-Za-z0-9_\-]+@github\.com")),
    ("x_access_token_url", re.compile(rb"x-access-token:[^@\s]+@")),
]

SUSPECT_PATHS = re.compile(
    r"(^|/)(\.env(\..+)?|\.npmrc|\.netrc|\.git-credentials|credentials?\.json|"
    r"id_rsa(\.pub)?|id_ed25519(\.pub)?|.*\.pem$|.*\.p12$|.*\.pfx$|.*\.key$|secrets?\.(ya?ml|json|txt)$)",
    re.I,
)


def run(*args, binary=False):
    out = subprocess.run(["git", *args], cwd=REPO, capture_output=True, check=True)
    return out.stdout if binary else out.stdout.decode("utf-8", "replace")


def main():
    # Live token literal (for exact-match check only; never printed)
    url = run("remote", "get-url", "origin").strip()
    m = re.search(r":([^@]+)@", url)
    token = m.group(1) if m else None
    token_re = re.compile(re.escape(token).encode()) if token else None

    revs = run("rev-list", "origin/main").split()
    print(f"[i] commits on origin/main: {len(revs)}")

    # Unique blobs + the paths that reference them (across all commits)
    obj_out = run("rev-list", "--objects", "origin/main")
    blob_paths = defaultdict(set)
    blobs = set()
    for line in obj_out.splitlines():
        parts = line.split(" ", 1)
        if len(parts) == 2 and parts[0]:
            blob_paths[parts[0]].add(parts[1])

    # Batch identify blobs via cat-file --batch-check
    all_objs = [p[0] for p in (l.split(" ", 1) for l in obj_out.splitlines()) if p[0]]
    p = subprocess.Popen(
        ["git", "cat-file", "--batch-check"],
        cwd=REPO, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
    )
    payload = ("\n".join(all_objs) + "\n").encode()
    out, _ = p.communicate(payload)
    for line in out.decode().splitlines():
        f = line.split()
        if len(f) >= 3 and f[1] == "blob":
            blobs.add(f[0])
    print(f"[i] unique blobs in history: {len(blobs)}")

    hits = defaultdict(list)  # pattern_name -> list of (blob, path, sample)
    path_flags = set()
    token_hits = 0

    # cat-file --batch over all blobs, scan content
    p = subprocess.Popen(
        ["git", "cat-file", "--batch"],
        cwd=REPO, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    )
    payload = ("\n".join(sorted(blobs)) + "\n").encode()
    out, _ = p.communicate(payload)
    stream = out
    pos = 0
    while pos < len(stream):
        nl = stream.index(b"\n", pos)
        header = stream[pos:nl].decode("utf-8", "replace")
        f = header.split()
        if len(f) >= 3 and f[1] == "blob":
            size = int(f[2])
            data = stream[nl + 1 : nl + 1 + size]
            blob = f[0]
            for name, rx in PATTERNS:
                for mo in rx.finditer(data):
                    sample = mo.group(0)[:24]
                    # mask sample: keep first 4 chars only
                    masked = (sample[:4] + b"...").decode("utf-8", "replace")
                    hits[name].append((blob, ", ".join(sorted(blob_paths.get(blob, {"?"})))[:120], masked))
            if token_re and token_re.search(data):
                token_hits += 1
                hits["LIVE_TOKEN_LITERAL"].append((blob, ", ".join(sorted(blob_paths.get(blob, {"?"})))[:120], "LIVE_TOKEN"))
            pos = nl + 1 + size + 1  # trailing newline after body
        else:
            pos = nl + 1

    # Path hygiene on the current main tree
    tree = run("ls-tree", "-r", "--name-only", "origin/main")
    for path in tree.splitlines():
        if SUSPECT_PATHS.search(path):
            path_flags.add(path)

    print("\n=== SECRET PATTERN HITS (full history of origin/main) ===")
    if not hits:
        print("NONE — clean.")
    for name, lst in hits.items():
        uniq = sorted(set(lst))
        print(f"{name}: {len(uniq)} unique blob(s)")
        for blob, path, sample in uniq[:8]:
            print(f"   blob {blob[:10]} | path: {path} | sample: {sample}")

    print("\n=== SUSPECT FILE PATHS in main tree ===")
    if path_flags:
        for pth in sorted(path_flags):
            print(f"   {pth}")
    else:
        print("NONE — clean.")

    print("\n=== LIVE TOKEN LITERAL in history ===")
    if not token_re:
        print("could not extract token — skipped")
    elif token_hits == 0:
        print("OK — token literal never appears in any blob on main history.")
    else:
        print(f"CRITICAL — token literal found in {token_hits} blob(s)!")

    # also confirm .git/config-style URL never committed
    n = len(hits.get("remote_url_creds", [])) + len(hits.get("x_access_token_url", []))
    print(f"\n[summary] credentialed-URL blobs in history: {n}")


if __name__ == "__main__":
    sys.exit(main())
