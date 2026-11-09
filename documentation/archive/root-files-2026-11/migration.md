"""
We are starting a NEW product in a NEW repo and migrating the reusable parts of this
repo into it. Do not modify or delete anything in this (old) repo.

OLD repo: this one.
NEW repo: [absolute path to the new, empty repo folder]
Product name: [name]

## The new product (context)

A warehouse-first ERP for SMEs in Egypt and the GCC that hold stock. Core ideas
under test: manager approval on outgoing stock (the approval must really block the
stock movement), an append-only audit log, and a messaging layer so approvals and
tasks can happen over WhatsApp and voice later. Pricing in EGP, modules switched on
per organization. It is NOT the internal GGO ERP (no CRM, time tracking, HR or
payroll). Research behind it is in research/ (I will add it).

## Step 1: inspect, then propose. Do not copy anything yet.

Read the whole repo and give me a migration plan as a table with three groups:

1. KEEP AS IS (copy unchanged): generic foundation, e.g. monorepo layout and tooling
   (apps/api, apps/web, packages/shared, sql/), Supabase auth and JWT handling,
   tenant resolution, permission and module guards, standard API responses, the
   module-driven web shell, org_id tenancy (sql/001_tenancy_core.sql), the
   append-only audit_log and its API route, ADR-0001 and ADR-0002.
2. KEEP BUT REWRITE: things with GGO/CRM/time-tracking wording or assumptions
   (agents.md, README, branding, product name, seed data, module manifest, docs
   index).
3. LEAVE BEHIND: CRM and time-and-attendance planning and code, MVP_PLAN.md,
   MASTER_PLAN.md, discovery answers, old checklist and worklog entries, anything
   GGO-specific.
   For each file or folder give: path, group, one-line reason. List anything you are
   unsure about separately. Wait for my approval of the table.

## Step 2: migrate (after I approve)

- Copy group 1 into the new repo, preserving structure. Run typecheck and tests in
  the new repo and fix only what the move broke.
- Our documentation and AI work-log system is the standard for the new repo: bring
  over agents.md, the documentation folder structure, the worklog and checklist
  mechanism, the module plan template, the research/teardown template, and the ADR
  format. Reset their CONTENT (empty worklog, empty checklist, no old module
  plans) but keep their STRUCTURE and rules. Carry over every convention that tells
  AI agents how to log work, so nothing about that process is lost.
- Rewrite group 2 for the new product; do not leave "GGO ERP", CRM or timesheet
  references. Flag any you could not decide.
- Do not copy secrets, .env files, node_modules, build output or git history.
- Do NOT pre-create inventory logic yet beyond an empty module folder following the
  existing module conventions (apps/api/src/modules/<key>, apps/web/src/modules/<key>,
  packages/shared/src/modules/<key>, sql/NNN*<key>*\*.sql, tables prefixed by module).

## Step 3: new repo documents

Create in the new repo:

- README.md: what the product is, the hypotheses, how to run it.
- PRODUCT_BRIEF.md: scope, module list, what is out of scope, the first vertical
  slice (item -> outgoing stock request -> manager approves -> issue -> audit log
  entry; the approval channel is abstracted so WhatsApp/voice can plug in later).
- agents.md: rewritten for this product, keeping our logging rules, plus these
  rules: study competitors' behaviour only and never copy their code (GPL/LGPL);
  every stock movement and approval writes to the audit log; approvals are enforced
  in the data layer, not only in the UI; every table has org_id with isolation tests.
- research/: placeholder README (I will add the research files).
- WORKLOG.md: first entry describing this migration.

## Step 4: report

Finish with: what was copied, rewritten and left behind; test results; open
questions. Make one commit in the new repo only after I confirm."""
