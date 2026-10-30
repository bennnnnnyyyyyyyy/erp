# What I want to do next (written before touching anything)

Written 2026-10-30. Nothing in this file has been run. Every database step below uses the Supabase CLI (`supabase db query --linked -f ...`) against the linked project, as you asked.

## What I want from you (decisions)
1. **Deploy?** Yes/no for publishing the Worker (adds `/v1/core/people`) and Pages (language switch, names for members). No database work is needed for this; `sql/016` is already applied.
2. **"Activating Stock Requests"**: (a) switch the module on, (b) draft step before submit, or (c) re-open a cancelled/rejected request.
3. **What does "use supa cli" refer to?** I am guessing it means "do any database work through the CLI, not the dashboard". If you meant something specific (a new migration, a data fix, a check), tell me which and I will add it here first.

## What I would run with the Supabase CLI (all read-only unless you approve)
| Step | Command shape | Changes data? |
|---|---|---|
| Re-run all SQL tests | `supabase db query --linked -f sql/tests/NNN_*.sql` | No (each rolls back) |
| Check the audit chain on every org | `select * from audit_verify(<org>)` | No |
| Dry-run retention | `select msg_cleanup(90, true)` | No |
| Advisors / schema list | `supabase db advisors --linked` (if available) | No |

## What I will NOT do without your explicit yes
- Schedule or really run `msg_cleanup(…, false)` (it deletes old finished messages).
- Any `DROP`, `TRUNCATE`, broad `DELETE`, or change to existing customer/demo data.
- Deploy, commit, or touch secrets.

## Next build candidates (after your answers)
- API and screens for approval policies, adjustments, reorder levels, identity binding (database exists, no UI yet).
- Real WhatsApp test (needs your Meta app and three Worker secrets).
