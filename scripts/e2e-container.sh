#!/usr/bin/env bash
# Run the screenshot specs inside the pinned Playwright image.
#
# Why this exists: `tests/screenshots/*.png` are assertions. Text rasterisation
# differs between macOS and Linux (font availability, hinting), so a baseline
# recorded on a laptop does not describe the renderer that gates CI. Both the
# recording and the comparison therefore happen inside one image, pinned to the
# `@playwright/test` version in package.json, and CI runs the same image.
#
# Usage:
#   scripts/e2e-container.sh run      # assert the committed baselines
#   scripts/e2e-container.sh update   # re-record them (review the diff by eye)
set -euo pipefail

mode="${1:-}"
case "$mode" in
  run|update) ;;
  *) echo "usage: scripts/e2e-container.sh run|update" >&2; exit 2 ;;
esac

image="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.62.1-noble}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
update_flag=""
# Explicit re-recording must replace even images whose small structural
# changes still fall below the normal comparison tolerance.
if [ "$mode" = "update" ]; then update_flag="--update-snapshots=all"; fi

# The repository is mounted read-only and copied inside the container so the
# host node_modules (native macOS binaries) can never be reused by the Linux
# renderer, and so an interrupted run cannot leave the checkout half-written.
docker run --rm \
  -v "$repo_root":/src:ro \
  -v "$repo_root/tests/screenshots":"/out/screenshots" \
  -v "$repo_root/test-results":"/out/test-results" \
  -e CI=1 \
  -e UPDATE_FLAG="$update_flag" \
  -w /work "$image" bash --noprofile --norc -euo pipefail -c '
    corepack enable >/dev/null 2>&1 || true
    corepack prepare pnpm@10.20.0 --activate >/dev/null 2>&1 || npm i -g pnpm@10.20.0 >/dev/null 2>&1
    mkdir -p /work
    tar -C /src --exclude=node_modules --exclude=dist --exclude=dist-e2e \
        --exclude=test-results --exclude=playwright-report -cf - . | tar -C /work -xf -
    cd /work
    pnpm install --frozen-lockfile --config.store-dir=/work/.pnpm-store >/tmp/install.log 2>&1 || { tail -40 /tmp/install.log; exit 1; }
    pnpm exec playwright test tests/e2e/screenshots.spec.ts tests/e2e/screenshots-business.spec.ts $UPDATE_FLAG
    if [ -n "$UPDATE_FLAG" ]; then
      cp -f /work/tests/screenshots/*.png /out/screenshots/
      echo "recorded baselines copied back to tests/screenshots/"
    fi
  '
