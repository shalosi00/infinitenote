#!/usr/bin/env python3
"""Fetch the failing e2e check run's job + annotations + log tail. Never prints the token."""
import json
import re
import subprocess
import sys
import urllib.request


def api(path: str, raw: bool = False):
    url = subprocess.check_output(["git", "remote", "get-url", "origin"],
                                  cwd="/home/z/my-project", text=True).strip()
    token = re.match(r"https://[^:]+:([^@]+)@", url).group(1)
    req = urllib.request.Request(
        f"https://api.github.com{path}",
        headers={"Authorization": f"Bearer {token}",
                 "Accept": "application/vnd.github+json"},
    )
    with urllib.request.urlopen(req) as r:
        return r.read() if raw else json.load(r)


sha = sys.argv[1]
runs = api(f"/repos/shalosi00/infinitenote/commits/{sha}/check-runs")["check_runs"]
e2e = next(r for r in runs if r["name"] == "e2e")
print(f"e2e check run id={e2e['id']} conclusion={e2e['conclusion']} details={e2e['details_url']}")

anns = api(f"/repos/shalosi00/infinitenote/check-runs/{e2e['id']}/annotations")
for a in anns[:20]:
    print(f"ANNOTATION [{a.get('annotation_level')}] {a.get('title')}: {a.get('message')[:300]}")

# the check run points at a job — find its logs via the actions run
m = re.search(r"/runs/(\d+)/job/(\d+)", e2e["details_url"] or "")
if m:
    run_id, job_id = m.group(1), m.group(2)
    log = api(f"/repos/shalosi00/infinitenote/actions/jobs/{job_id}/logs", raw=True).decode("utf-8", "replace")
    lines = log.splitlines()
    fails = [i for i, l in enumerate(lines) if "✘" in l or "failed" in l.lower() or "Error:" in l]
    print(f"--- log lines: {len(lines)}, failure markers: {len(fails)} ---")
    for i in fails[:6]:
        for l in lines[max(0, i - 2): i + 18]:
            print(l[:220])
        print("....")
