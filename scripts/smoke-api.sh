#!/usr/bin/env bash
# Post-deploy smoke checks. No credentials are required.
#
# Usage:
#   scripts/smoke-api.sh https://fish-api-staging.unihuan.com
#   SMOKE_ADMIN_ORIGIN=https://fish-admin-staging.unihuan.com \
#     scripts/smoke-api.sh http://127.0.0.1:3000
set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:3000}"
CLIENT_HEADERS=(-H "X-Client-Type: miniprogram" -H "X-Client-Version: 1.0.0")

check_status() {
  local path="$1"
  local expected="$2"
  shift 2
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' "$@" "${BASE_URL}${path}")"
  if [[ "${code}" != "${expected}" ]]; then
    echo "FAIL ${path}: expected ${expected}, got ${code}" >&2
    exit 1
  fi
  echo "ok ${path} (${code})"
}

check_status /health 200
check_status /ready 200
check_status "/api/v1/config" 200 "${CLIENT_HEADERS[@]}"
check_status "/api/v1/dictionaries" 200 "${CLIENT_HEADERS[@]}"
check_status "/api/v1/spots?page=1&page_size=1" 200 "${CLIENT_HEADERS[@]}"

if [[ -n "${SMOKE_ADMIN_ORIGIN:-}" ]]; then
  headers="$(curl -sS -D - -o /dev/null -X OPTIONS \
    -H "Origin: ${SMOKE_ADMIN_ORIGIN}" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: content-type,x-client-type,x-client-version,x-csrf-token" \
    "${BASE_URL}/api/v1/admin/auth/login")"
  if ! grep -qi "access-control-allow-origin: ${SMOKE_ADMIN_ORIGIN}" <<<"${headers}"; then
    echo "FAIL CORS preflight: allowed origin header missing" >&2
    exit 1
  fi
  echo "ok CORS preflight"
fi

echo "smoke checks passed"
