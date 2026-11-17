#!/usr/bin/env bash
# Backup and restore rehearsal against a local PostgreSQL database.
# The target database is created with a unique suffix and dropped after verification.
#
# Usage:
#   DATABASE_URL=postgresql://user:pass@localhost:5432/szfisher scripts/rehearse-backup.sh
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

if ! command -v psql >/dev/null 2>&1 || ! command -v pg_restore >/dev/null 2>&1; then
  echo "psql and pg_restore are required" >&2
  exit 1
fi

# libpq does not accept Prisma's ?schema=public query parameter.
SOURCE_URL="${DATABASE_URL%%\?*}"
HOST="$(node -e "process.stdout.write(new URL(process.env.DATABASE_URL).hostname)")"
if [[ "${HOST}" != "localhost" && "${HOST}" != "127.0.0.1" ]]; then
  echo "Rehearsal is limited to localhost, refusing ${HOST}" >&2
  exit 1
fi
if [[ "${SOURCE_URL}" != */* ]]; then
  echo "DATABASE_URL must include a database name" >&2
  exit 1
fi

SOURCE_DB="${SOURCE_URL##*/}"
BASE_PREFIX="${SOURCE_URL%/*}"
TARGET_DB="szfisher_restore_$(date -u +%Y%m%d%H%M%S)"
TARGET_URL="${BASE_PREFIX}/${TARGET_DB}"
DUMP_DIR="$(mktemp -d)"
TABLES=(spot poi spot_poi dictionary admin_user)

cleanup() {
  psql "${SOURCE_URL}" -v ON_ERROR_STOP=1 -q \
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${TARGET_DB}'" \
    >/dev/null 2>&1 || true
  psql "${SOURCE_URL}" -v ON_ERROR_STOP=1 -q \
    -c "DROP DATABASE IF EXISTS \"${TARGET_DB}\"" \
    >/dev/null 2>&1 || true
  rm -rf "${DUMP_DIR}"
}
trap cleanup EXIT

DATABASE_URL="${DATABASE_URL}" BACKUP_DIR="${DUMP_DIR}" \
  scripts/backup-postgres.sh >/dev/null

DUMP_FILE="$(find "${DUMP_DIR}" -maxdepth 1 -name 'szfisher-*.dump' -type f -print -quit)"
if [[ -z "${DUMP_FILE}" ]]; then
  echo "No backup file was produced" >&2
  exit 1
fi

psql "${SOURCE_URL}" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE \"${TARGET_DB}\""
pg_restore \
  --dbname="${TARGET_URL}" \
  --no-owner \
  --no-privileges \
  --single-transaction \
  "${DUMP_FILE}"

printf 'table source_count restore_count\n'
for table in "${TABLES[@]}"; do
  source_count="$(psql "${SOURCE_URL}" -tAc "SELECT count(*) FROM \"${table}\"")"
  restore_count="$(psql "${TARGET_URL}" -tAc "SELECT count(*) FROM \"${table}\"")"
  printf '%s %s %s\n' "${table}" "${source_count}" "${restore_count}"
  if [[ "${source_count}" != "${restore_count}" ]]; then
    echo "Count mismatch for ${table}" >&2
    exit 1
  fi
done

echo "rehearsal passed: ${SOURCE_DB} -> ${TARGET_DB}"
