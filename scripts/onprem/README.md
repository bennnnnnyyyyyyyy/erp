# On-premises package (step 1: proof)

Plan: [on-prem deployment plan](../../documentation/planning/2026-11-19-on-prem-deployment-plan.md).

**Status (19 Nov 2026):** the API's Node entry point (`apps/api/src/node.ts`) is built and tested (`apps/api/test/node_entry.test.ts`
serves real HTTP). The Docker Compose package below is written but **has not been run yet**: it needs a Linux server with Docker
(requested from Joe). Expect fixes on the first run.

| File | What it is |
|---|---|
| `docker-compose.yml` | Database (Supabase Postgres), sign-in (GoTrue), PostgREST, our API on Node, the web app behind Caddy, nightly backup |
| `Caddyfile` | One address: `/auth/v1` and `/rest/v1` to sign-in and the database, `/health`, `/v1`, `/r`, `/webhooks` to the API, the rest to the web app |
| `Dockerfile.api`, `Dockerfile.web` | Images built from this repository (the web app is built for the server's address) |
| `backup.sh` | Nightly dump at 02:00 into `BACKUP_DIR`, 14 days kept |
| `settings.example` | The settings (copied to `.env`); the installer (step 4) will write the real `.env` |

## First run on a test server (by hand, until the installer exists)

1. Ubuntu 22.04 or 24.04 with Docker; copy the repository; `cd scripts/onprem && cp settings.example .env`; fill in `.env`.
2. Make `ANON_KEY` and `SERVICE_ROLE_KEY` (JWTs with `role` anon / service_role, signed with `JWT_SECRET`).
3. `docker compose --env-file .env up -d --build`.
4. Apply the migrations in order: every `sql/NNN_*.sql` with `psql` against the `db` container (the installer will do this).
5. Open `PUBLIC_URL`, create the first company, and run the walkthrough.

## Still to do (later steps)

Licence (step 2), short-outage handling (step 3), installer / update / restore scripts (step 4), release images built by CI (step 5).
The API's settings are the same names as the Worker's (`apps/api/src/env.ts`); integrations stay off until their keys are set.
