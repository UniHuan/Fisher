#!/usr/bin/env bash
# Use the pnpm installed by actions/setup-node or pnpm/action-setup in CI, and
# fall back to Corepack in a developer shell where pnpm is not on PATH.
set -euo pipefail
if command -v pnpm >/dev/null 2>&1; then
  exec pnpm "$@"
fi
exec corepack pnpm "$@"
