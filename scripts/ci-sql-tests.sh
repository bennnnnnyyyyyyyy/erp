#!/usr/bin/env bash
# CI helper: applies every sql/NNN_*.sql migration in order to a LOCAL, throwaway Supabase database, then runs every sql/tests/NNN_*.sql.
# Reads: sql/*.sql and sql/tests/*.sql. Writes: only to the local database named by DB_URL. It REFUSES any host that is not localhost,
# so it can never touch the real Supabase project. No secrets are used.
# Each SQL test ends with an intentional error "ALL TESTS PASSED (everything rolled back)"; that exact message counts as a pass.
# Usage (after `supabase start`):  bash scripts/ci-sql-tests.sh        Optional: DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
set -u
DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
case "$DB_URL" in
  *@127.0.0.1:*|*@localhost:*) ;;
  *) echo "refusing to run: DB_URL must point at localhost, got a different host"; exit 2 ;;
esac
command -v psql >/dev/null 2>&1 || { echo "psql is not installed"; exit 2; }

echo "== migrations"
for f in $(ls sql/[0-9]*.sql | sort); do
  if ! out=$(psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$f" 2>&1); then
    echo "MIGRATION FAILED: $f"; echo "$out" | tail -25; exit 1
  fi
  echo "applied $f"
done

echo "== sql tests"
fail=0; pass=0
for f in $(ls sql/tests/[0-9]*.sql | sort); do
  out=$(psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$f" 2>&1 || true)
  if echo "$out" | grep -q "ALL TESTS PASSED (everything rolled back)"; then
    echo "PASS $f"; pass=$((pass + 1))
  else
    echo "FAIL $f"; echo "$out" | tail -15; fail=$((fail + 1))
  fi
done
echo "summary: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
