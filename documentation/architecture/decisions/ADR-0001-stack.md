# ADR-0001: Stack

**Status:** Proposed (carried from the previous internal ERP; re-confirm on first commit)
**Date:** 2026-10-28
**Deciders:** {{DECIDERS}}

## Context

{{PRODUCT_NAME}} is a warehouse-first ERP sold to SMEs in Egypt and the GCC. It must serve many
customers, switch modules on per customer, and be workable by several people and AI agents without
drift. This is a new codebase; the stack and the generic foundation were carried over from an
earlier internal ERP.

## Decision

- **TypeScript everywhere**, in one npm-workspaces monorepo (`apps/api`, `apps/web`,
  `packages/shared`). An ERP has many entities and rules; shared types between API and UI catch
  mistakes that plain JS would not.
- **API: Hono on Cloudflare Workers.** Cheap at low
  volume, no servers to manage.
- **Web: React + Vite**, built to static files. Any static host works.
- **Database and auth: Supabase** (Postgres + Supabase Auth). Postgres suits ERP data
  (transactions, constraints, reporting). Supabase Auth gives password, magic link, OAuth and
  SSO-ready sign-in without us storing passwords.
- **Migrations as numbered SQL files** in `sql/`, run by hand in the Supabase SQL Editor.

## Consequences

- One language and one type system across the stack.
- Long-running jobs (big imports, report generation) will need Workers Queues, Cron Triggers or
  a separate worker; Workers have CPU-time limits per request.
- Supabase Auth ties sign-in to Supabase. Moving off it later means migrating users, which is
  possible but not trivial.

## Alternatives considered

- **Next.js on Vercel**: strong full-stack option, but splits the team across two hosting
  models and mixes server and UI code, which makes the tenancy boundary harder to audit.
- **Plain JavaScript**: faster to start, but too loose for an ERP's data model.
- **An off-the-shelf ERP framework (Odoo, ERPNext; see the market research for why we build)**: fast feature coverage, but Python stacks
  we don't run, and their licensing and architecture constrain how we sell.
