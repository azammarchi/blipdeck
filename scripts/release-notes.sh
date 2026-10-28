#!/usr/bin/env bash
# Prints release notes for a tag: the commits since the previous tag, grouped
# by Conventional Commit type. Used by .github/workflows/release.yml; run it
# by hand to preview: bash scripts/release-notes.sh v1.2.0
set -euo pipefail

tag="${1:?usage: release-notes.sh <tag>}"
previous="$(git describe --tags --abbrev=0 "$tag^" 2>/dev/null || true)"
range="${previous:+$previous..}$tag"

section() {
  local title="$1" types="$2" lines
  # "type(scope): description" → "- **scope:** description (abc1234)"
  lines="$(git log --no-merges --format='%s%x09%h' "$range" |
    grep -E "^($types)(\([^)]*\))?!?: " |
    grep -vE '^chore\(release\)' |
    sed -E 's/^[a-z]+\(([^)]*)\)!?: (.*)\t(.*)$/- **\1:** \2 (\3)/; s/^[a-z]+!?: (.*)\t(.*)$/- \1 (\2)/' || true)"
  if [[ -n "$lines" ]]; then
    printf '## %s\n\n%s\n\n' "$title" "$lines"
  fi
}

echo "<!-- Write a short opening paragraph here: what this release is about. -->"
echo
section "Features" "feat"
section "Fixes" "fix"
section "Performance" "perf"
section "Documentation" "docs"
section "Maintenance" "refactor|test|ci|chore|style|build"
if [[ -n "$previous" ]]; then
  echo "**Full changes:** https://github.com/${GITHUB_REPOSITORY:-azammarchi/blipdeck}/compare/$previous...$tag"
fi
