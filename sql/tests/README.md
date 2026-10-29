# SQL tests

Scripts you paste into the Supabase SQL Editor (run as the default `postgres` role) to prove database rules on a real
database. They create their own throwaway users and organizations and **always roll back**: they finish by raising an
error on purpose, so nothing is left behind and your real data is never changed.

How to read the result:

- `ERROR: ... ALL TESTS PASSED (everything rolled back)` means **pass**.
- `ERROR: ... FAIL T<n>: <what went wrong>` means that check failed. Paste the full text to Claude.
- Any other error (for example about `auth.users`) means the script itself could not set up; paste it too.

Run the whole file at once with nothing else in the editor.

| File | Proves |
|---|---|
| `001_core_isolation_and_audit.sql` | Organization isolation (RLS), the `X-Org-Id` header check, role checks, no direct writes, admin-only functions, append-only and chained audit log, TRUNCATE refused |

Not covered here (needs the API and a real login): the browser path through PostgREST, and a real second sign-in. See the checklist.

Status: run by Ben 2026-10-29, ALL TESTS PASSED. Re-run after every change to `sql/`. Record each run in `documentation/operations/WORKLOG.md`.
