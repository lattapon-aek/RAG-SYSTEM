#!/usr/bin/env bash
# run_migrations.sh — Run all PostgreSQL migrations in order.
# Idempotent: safe to run multiple times (all migrations use IF NOT EXISTS / IF EXISTS).
#
# Usage:
#   POSTGRES_URL=postgresql://user:pass@host:5432/dbname ./scripts/run_migrations.sh
#
# Or set POSTGRES_URL in your environment / .env file before running.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="${SCRIPT_DIR}/migrations"

# ── Validate connection string ────────────────────────────────────────────────
if [[ -z "${POSTGRES_URL:-}" ]]; then
  echo "ERROR: POSTGRES_URL environment variable is not set." >&2
  echo "  Example: export POSTGRES_URL=postgresql://user:pass@localhost:5432/ragdb" >&2
  exit 1
fi

# ── Ensure psql is available ──────────────────────────────────────────────────
if ! command -v psql &>/dev/null; then
  echo "ERROR: psql not found. Install the PostgreSQL client and retry." >&2
  exit 1
fi

# ── Collect migration files in sorted order ───────────────────────────────────
mapfile -t MIGRATION_FILES < <(find "${MIGRATIONS_DIR}" -maxdepth 1 -name '*.sql' | sort)

if [[ ${#MIGRATION_FILES[@]} -eq 0 ]]; then
  echo "No migration files found in ${MIGRATIONS_DIR}." >&2
  exit 1
fi

echo "Running ${#MIGRATION_FILES[@]} migration(s) against: ${POSTGRES_URL%%@*}@..."

# ── Execute each migration ────────────────────────────────────────────────────
for migration in "${MIGRATION_FILES[@]}"; do
  filename="$(basename "${migration}")"
  echo "  → Applying ${filename} ..."

  if psql "${POSTGRES_URL}" \
       --single-transaction \
       --set ON_ERROR_STOP=1 \
       --file "${migration}" \
       --quiet; then
    echo "    ✓ ${filename} applied successfully."
  else
    echo "ERROR: Migration ${filename} failed. Aborting." >&2
    exit 1
  fi
done

echo "All migrations completed successfully."
