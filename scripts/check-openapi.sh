#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

pnpm --filter @szfisher/api openapi:generate

if ! git diff --exit-code -- openapi/openapi.yaml packages/api-client/src/schema.d.ts >/dev/null; then
  echo "OpenAPI 或客户端类型未提交，请运行 pnpm openapi:generate"
  exit 1
fi
