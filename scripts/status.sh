#!/usr/bin/env bash
# =============================================================================
# scripts/status.sh — quick project status snapshot for humans and AI agents.
# Answers "where does the project stand?" without reading the whole codebase.
# Full detail lives in PROJECT_STATUS.md (kept up to date in every PR).
# =============================================================================
set -eu
cd "$(dirname "$0")/.."

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'no-git')"
HEAD="$(git log -1 --pretty='%h %s' 2>/dev/null || echo '-')"
DIRTY="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
TEST_CASES="$(grep -rhE '^\s*(test|it)\(' src/lib/__tests__/*.test.ts 2>/dev/null | wc -l | tr -d ' ')"
TODOS="$(grep -rn 'TODO' src --include='*.ts' --include='*.tsx' 2>/dev/null | wc -l | tr -d ' ')"

echo "================================================================"
echo " InfiniteNote — status snapshot  ($(date '+%Y-%m-%d %H:%M'))"
echo "================================================================"
echo " branch:        $BRANCH"
echo " head:          $HEAD"
echo " dirty files:  $DIRTY"
echo " TODOs in src: $TODOS"
echo " unit tests:   ~$TEST_CASES cases (make test)"
echo "----------------------------------------------------------------"
echo " CI:             https://github.com/shalosi00/infinitenote/actions"
echo "----------------------------------------------------------------"
echo " PROJECT_STATUS.md (first 18 lines):"
echo ""
sed -n '1,18p' PROJECT_STATUS.md
