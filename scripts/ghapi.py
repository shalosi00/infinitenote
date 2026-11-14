#!/usr/bin/env python3
"""Durable GitHub API helper for InfiniteNote repo work (scripts/ghapi.py).

Reads the token from the origin remote URL — the token is NEVER printed,
logged, or written anywhere. Usage:

  python3 scripts/ghapi.py <api-path> [method] ['{"json":"body"}']

  python3 scripts/ghapi.py pulls?state=open
  python3 scripts/ghapi.py issues/193 PATCH '{"state": "closed"}'
"""
import json
import subprocess
import sys
import urllib.error
import urllib.request

REPO = "shalosi00/infinitenote"


def _token() -> str:
    url = subprocess.run(
        ["git", "remote", "get-url", "origin"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    # https://user:token@github.com/...  or  https://token@github.com/...
    if "@" not in url:
        raise SystemExit("origin remote has no embedded token")
    auth = url.split("://", 1)[1].split("@", 1)[0]
    tok = auth.split(":", 1)[1] if ":" in auth else auth
    return tok


def api(path: str, method: str = "GET", body: dict | None = None):
    tok = _token()
    url = f"https://api.github.com/repos/{REPO}/{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"token {tok}")
    req.add_header("Accept", "application/vnd.github+json")
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        payload = e.read().decode()
        try:
            return {"_status": e.code, **json.loads(payload)}
        except Exception:
            return {"_status": e.code, "message": payload[:300]}


if __name__ == "__main__":
    path = sys.argv[1]
    method = sys.argv[2] if len(sys.argv) > 2 else "GET"
    body = json.loads(sys.argv[3]) if len(sys.argv) > 3 else None
    print(json.dumps(api(path, method, body), indent=1))
