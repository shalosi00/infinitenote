#!/usr/bin/env python3
"""Poll the PR's required checks until they complete. Never prints the token."""
import json
import re
import subprocess
import sys
import time
import urllib.request

SHA = sys.argv[1]
EXPECT = {"lint-typecheck-test", "build-smoke", "e2e"}


def api(path: str) -> dict:
    url = subprocess.check_output(["git", "remote", "get-url", "origin"],
                                  cwd="/home/z/my-project", text=True).strip()
    token = re.match(r"https://[^:]+:([^@]+)@", url).group(1)
    req = urllib.request.Request(
        f"https://api.github.com{path}",
        headers={"Authorization": f"Bearer {token}",
                 "Accept": "application/vnd.github+json"},
    )
    with urllib.request.urlopen(req) as r:
        return json.load(r)


deadline = time.time() + int(sys.argv[2] if len(sys.argv) > 2 else 540)
while time.time() < deadline:
    runs = api(f"/repos/shalosi00/infinitenote/commits/{SHA}/check-runs")["check_runs"]
    named = {r["name"]: r for r in runs if r["name"] in EXPECT}
    lines = []
    done = True
    for name in sorted(EXPECT):
        r = named.get(name)
        if r is None:
            lines.append(f"{name}: queued")
            done = False
        elif r["status"] != "completed":
            lines.append(f"{name}: {r['status']}")
            done = False
        else:
            lines.append(f"{name}: {r['conclusion']}")
    print(time.strftime("%H:%M:%S"), "|", " | ".join(lines), flush=True)
    if done:
        conclusions = {n: named[n]["conclusion"] for n in EXPECT}
        if all(c == "success" for c in conclusions.values()):
            print("ALL_CHECKS_GREEN")
            sys.exit(0)
        print("CHECKS_FINISHED_WITH_FAILURES")
        sys.exit(1)
    time.sleep(45)
print("TIMEOUT_STILL_RUNNING")
sys.exit(2)
