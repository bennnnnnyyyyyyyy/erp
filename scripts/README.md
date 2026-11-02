# Scripts

One-off and operational scripts (imports, data checks, research helpers). Rules:

- Each script says at the top what it reads, what it writes, and whether it touches a database.
- Anything that writes to a database is dry-run by default and needs an explicit flag to apply.
- Scratch output goes to `.temp/` (git-ignored), never into `documentation/` or the repo root.
- Secrets come from environment variables, never from arguments or source.

- `ci-sql-tests.sh`: applies `sql/*.sql` and runs `sql/tests/*.sql` against a local throwaway Supabase database (used by `.github/workflows/sql-tests.yml`). Writes only to localhost and refuses any other host. Not yet run on GitHub; written 2 Nov 2026 without Docker available, so the first run may need small fixes.
