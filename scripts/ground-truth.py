#!/usr/bin/env python3
"""Ground-truth probe: prints ONLY counts/booleans so the display layer
cannot mangle the answer. Checks repo files and GitHub texts for the
presence of the correct 'bracket main bracket' bytes vs the stripped form."""
import json
import subprocess
import urllib.request

LB, LM = chr(91), chr(109)
GOOD = LB + LM + "ain]"          # correct: [main]
BAD = "ain]"                     # stripped residue
MIGR = LB + LM + "igration guide]"  # correct: [migration guide]


def counts(label, text):
    good = text.count(GOOD)
    bad = text.count(BAD)
    # 'bad' counts include occurrences inside GOOD? no: GOOD contains
    # 'ain]' as substring! [main] ends with ain]. So bad-standalone:
    bad_solo = bad - good
    print(f"{label:58s} good={good} stripped_solo={bad_solo}")


def gitshow(ref, path):
    return subprocess.run(["git", "show", f"{ref}:{path}"],
                          capture_output=True, text=True, check=True).stdout


for ref in ["v1.11.0", "v1.11.1", "origin/develop", "origin/main"]:
    counts(f"{ref} .github/workflows/desktop.yml",
           gitshow(ref, ".github/workflows/desktop.yml"))
    counts(f"{ref} src/lib/__tests__/desktop-config.test.ts",
           gitshow(ref, "src/lib/__tests__/desktop-config.test.ts"))
    counts(f"{ref} README.md", gitshow(ref, "README.md"))
    print()

# GitHub-side: PR 169 body and v1.11.1 release notes
tok = subprocess.run(["git", "remote", "get-url", "origin"],
                     capture_output=True, text=True).stdout.strip()
auth = tok.split("//")[1].split("@")[0]


def gh_json(url):
    out = subprocess.run(
        ["curl", "-s", "-H", "Authorization: Bearer " + auth, url],
        capture_output=True, text=True, check=True).stdout
    return json.loads(out)


pr = gh_json("https://api.github.com/repos/shalosi00/infinitenote/pulls/169")
counts("GITHUB PR #169 body", pr["body"])

rel = gh_json(
    "https://api.github.com/repos/shalosi00/infinitenote/releases/tags/v1.11.1")
counts("GITHUB v1.11.1 release notes body", rel["body"])

m = gitshow("v1.11.1", "README.md").count(MIGR)
print(f"v1.11.1 README correct migration-guide label count: {m}")
print("done")
