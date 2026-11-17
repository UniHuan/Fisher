#!/usr/bin/env bash
# Daily pg_dump backup with retention. WAL/PITR remains the managed database's
# responsibility; this script is the portable logical backup and restore seed.
#
# Usage:
#   DATABASE_URL=postgresql://... BACKUP_DIR=/var/backups/szfisher \
#     scripts/backup-postgres.sh
#
# Cron example:
#   15 2 * * * DATABASE_URL=... BACKUP_DIR=/var/backups/szfisher \
#     /opt/szfisher/scripts/backup-postgres.sh >> /var/log/szfisher-backup.log 2>&1
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/szfisher}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="${BACKUP_DIR}/szfisher-${STAMP}.dump"
PARTIAL="${TARGET}.partial"

# Prisma appends ?schema=public, which libpq (pg_dump/pg_restore) rejects.
# Keep other libpq options such as sslmode and remove only the Prisma-only key.
DUMP_URL="${DATABASE_URL}"
if [[ "${DUMP_URL}" == *\?* ]]; then
  URL_BASE="${DUMP_URL%%\?*}"
  URL_QUERY="${DUMP_URL#*\?}"
  URL_QUERY="$(printf '%s' "${URL_QUERY}" | tr '&' '\n' \
    | awk 'NF && $0 !~ /^(schema|connection_limit|pool_timeout|pgbouncer|statement_cache_size|socket_timeout)=/' \
    | paste -sd '&' -)"
  if [[ -n "${URL_QUERY}" ]]; then
    DUMP_URL="${URL_BASE}?${URL_QUERY}"
  else
    DUMP_URL="${URL_BASE}"
  fi
fi

umask 077
mkdir -p "${BACKUP_DIR}"

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump is not installed" >&2
  exit 1
fi
if ! command -v pg_restore >/dev/null 2>&1; then
  echo "pg_restore is not installed" >&2
  exit 1
fi

cleanup() {
  rm -f "${PARTIAL}"
}
trap cleanup EXIT

# Custom format supports selective restore and is verified before becoming visible.
pg_dump \
  --dbname="${DUMP_URL}" \
  --format=custom \
  --compress=6 \
  --no-owner \
  --no-privileges \
  --file="${PARTIAL}"

pg_restore --list "${PARTIAL}" >/dev/null
mv "${PARTIAL}" "${TARGET}"
trap - EXIT

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "${TARGET}" > "${TARGET}.sha256"
else
  shasum -a 256 "${TARGET}" > "${TARGET}.sha256"
fi

# Keep files by age; the paired .sha256 files are removed with the dump.
find "${BACKUP_DIR}" -type f -name 'szfisher-*.dump' -mtime "+${RETENTION_DAYS}" -print -delete
find "${BACKUP_DIR}" -type f -name 'szfisher-*.dump.sha256' -mtime "+${RETENTION_DAYS}" -print -delete

echo "backup written: ${TARGET}"
echo "checksum written: ${TARGET}.sha256"
