# Agent skills (vendored from mattpocock/skills)

This directory is **repo tooling for AI-assisted development** — it is not part
of the shipped app. It vendors the promoted skill set from
[mattpocock/skills](https://github.com/mattpocock/skills) ("Skills For Real
Engineers") so every agent session working on InfiniteNote has the same
engineering discipline available: red-green TDD, disciplined bug diagnosis,
two-axis code review, spec/ticket planning, and architecture care.

- **Source:** https://github.com/mattpocock/skills
- **Pinned at:** commit `4ae2317ddb22b046e26455e4f9c9b3aaaf62212d` (2026-10-31)
- **License:** MIT © Matt Pocock — see [LICENSE](./LICENSE)
- **Included:** the two promoted buckets, `engineering/` (20 skills) and
  `productivity/` (7 skills) — exactly the set the upstream plugin ships.
- **Excluded:** `in-progress/` (beta, not shipped upstream), `misc/` (frozen),
  and `deprecated/`.

## How agents use these

Before starting work that matches a skill, read its `SKILL.md` and any
companion files it references (they live in the same folder). Skills are
reference discipline, not apps to run. The highest-leverage ones for this repo:

| Situation | Skill to read first |
|---|---|
| Building a feature or fixing a bug test-first | `engineering/tdd/SKILL.md` |
| A bug is reported / something behaves wrong | `engineering/diagnosing-bugs/SKILL.md` |
| Reviewing a branch before opening a PR | `engineering/code-review/SKILL.md` |
| Designing or deepening a module | `engineering/codebase-design/SKILL.md` |
| Shaping a PR body | `engineering/pr/SKILL.md` |
| Planning a large chunk of work | `engineering/to-spec`, `to-tickets`, `wayfinder` |
| Writing docs that agents must follow | `productivity/writing-for-agents/SKILL.md` |
| Which skill fits? | `engineering/ask-matt/SKILL.md` (the router) |

Full inventories with one-line descriptions: [engineering/README.md](./engineering/README.md)
and [productivity/README.md](./productivity/README.md).

## Maintenance

Re-vendor deliberately: replace the two bucket directories, update the pinned
commit above, keep the LICENSE, and check the upstream CHANGELOG for behaviour
changes. Local adaptations are allowed (these are meant to be hacked on) —
but record any deliberate divergence in the worklog entry for that cycle.
