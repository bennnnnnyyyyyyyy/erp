ERP repository audit
Repository: bennnnnnyyyyyyyy/erp
Audit date: 2 November 2026
Scope: Architecture, database integrity, security, inventory workflows, approvals, auditability, frontend/backend implementation, testing, deployment readiness and ERP functionality.

I am treating this as a technical and product-readiness audit, not just a code-quality review.

One important distinction is already apparent: the repository describes itself as an early-stage ERP foundation with a clickable demo, while explicitly acknowledging that the real inventory module has not yet been built. I will assess implemented functionality separately from planned functionality.

1. Executive assessment
   Not production-ready
   Strong foundation

The project has a better architectural foundation than a typical early-stage ERP prototype. In particular, the database-first approach to approvals, stock movements and multi-tenancy is a good decision.

However, there are still gaps between the architectural promises, implemented functionality, operational readiness and actual user experience.
Area Assessment
Architecture Good
Database design Good
Multi-tenancy Good foundation
Authentication and authorization Good foundation
Inventory integrity Needs fixes
API implementation Good foundation
Frontend UX Needs work
Arabic localization Incomplete
Automated testing Incomplete
Deployment readiness Incomplete
Product completeness Early stage

These are qualitative audit assessments, not measured performance scores.

2. Critical findings
   I identified the following issues from the source code and project documentation.
   Finding 01 — Storage-condition validation
   High

Location: sql/033_inventory_transfers.sql

The transfer validation currently checks:
if it.storage_condition_id is not null
and wt.storage_condition_id is not null
and it.storage_condition_id <> wt.storage_condition_id then
raise exception 'STORAGE_MISMATCH';
end if;

This creates a gap.

If an item requires cold storage but the destination warehouse has no storage condition configured (NULL), the transfer is accepted.

The system should reject a transfer whenever the destination does not satisfy the item's required storage condition.

Recommendation: Enforce an exact compatibility check, including missing destination conditions. Add tests for:

- Cold item → cold warehouse.
- Cold item → ambient warehouse.
- Cold item → warehouse with no condition.
- Ambient item → warehouse with no condition, according to the agreed business rules.
  This matters because incorrect warehouse transfers can compromise inventory integrity.

Finding 02 — Database documentation is inconsistent
High

Location: sql/README.md, README.md, documentation/plans/checklist.md

The documentation does not accurately represent the current implementation.

Examples:

- Root README says the real inventory module has not been built.
- The transfer plan says migration 033 has been applied.
- SQL README documents migrations only through 027 and says migration 025 has not been run.
- The checklist contains older inventory implementation tasks marked incomplete despite newer implementation records.
  This is particularly problematic because multiple AI agents and developers are instructed to use these documents as their source of truth.

Recommendation: Reconcile the migration register, checklist, architecture documentation and root README against the actual repository and Supabase state.

Finding 03 — SQL tests are missing from CI
High

Location: .github/workflows/ci-deploy.yml

There is a GitHub Actions pipeline that runs:

- npm ci
- TypeScript checks
- Application tests
- Web production build
- Cloudflare deployment
  However, it does not execute the SQL integration tests.

This means a code change can pass the automated pipeline without automatically validating database-level business rules.

Recommendation: Introduce a dedicated staging database test job that executes migrations and SQL tests before production deployment. Keep production migrations separately controlled.

Finding 04 — Production deployment is not complete
High

Location: documentation/operations/WORKLOG.md

The latest transfer implementation records:

- Migration 033 applied to Supabase project ggoerp.
- SQL test 029 passed.
- API routes implemented.
- Frontend screens implemented.
- API and web deployment still outstanding.
- Manual browser verification still outstanding.
  Consequently, the new transfer functionality should not be considered available to production users yet.

3. Architecture and security review
   This is one of the stronger areas of the repository.

What is implemented well:

1. React and Vite frontend separated from the Hono API.
2. Cloudflare Workers for API hosting.
3. Supabase PostgreSQL for transactional business logic.
4. Shared TypeScript packages.
5. Organization-based multi-tenancy.
6. User-scoped database clients.
7. Database functions for business mutations.
8. Row-level security.
9. Append-only audit records.
10. Permission checks at both API and database levels.
    The most important architectural decision is ADR-0003.

Instead of allowing the API to make privileged stock changes, the application calls PostgreSQL functions using the authenticated user's JWT.

That gives the database responsibility for enforcing critical rules.

For example:

- A user cannot issue stock without approval.
- A requester cannot approve their own request.
- Stock reservations are handled transactionally.
- Audit records are created alongside the business operation.
- Other organizations cannot access another organization's records.
  The transfer implementation follows this same approach.

Remaining security work:

- Complete real-user testing for invitations and membership changes.
- Verify all database security-definer functions and their execution grants.
- Continue testing cross-organization access on every new module.
- Verify production CSP and API origins against actual deployment configuration.
- Introduce rate limiting for sensitive API and webhook endpoints.
- Perform a separate security review of finance, purchasing and sales.
  I found an earlier security audit dated 30 October and subsequent worklog evidence that migration 025 was applied and its SQL test passed. The older audit document itself has not been reconciled with that later status.

4. Inventory and ERP functionality
   The inventory implementation is more substantial than the root README suggests.

The repository contains functionality for:
Capability Implementation
Items and warehouses Implemented
Stock ledger Implemented
Stock reservations Implemented
Stock requests Implemented
Manager approvals Implemented
Multiple approval policies Implemented
Stock adjustments Implemented
Batch tracking Implemented
Expiry management Implemented
FEFO issuing Implemented
Reorder levels Implemented
Inventory transfers Implemented
In-transit stock Implemented
Purchase orders Implemented
Supplier invoices Implemented
Sales orders Implemented
Customer invoices Implemented
Expenses and payments Implemented
Owner insights Implemented

These statuses mean that corresponding code and database functionality exist; they do not mean every feature is fully deployed or production-verified.

Important missing or incomplete ERP capabilities:

- Partial transfer receipts.
- More comprehensive inventory reporting.
- Advanced list filters and saved views.
- Bulk actions and pagination.
- CSV import and onboarding.
- Complete purchasing and sales workflows.
- Accounting integrations.
- Egyptian e-invoicing.
- Billing and subscription management.
- More comprehensive warehouse workflows.
  The product brief correctly treats several of these as later development waves.

5. Frontend and user experience
   The existing UI audit in the repository identified several issues. I reviewed those findings as part of this audit.
   Existing UI audit findings
   Finding Severity
   Most screens are not translated into Arabic High
   Dates and formatting remain English-oriented High
   Large initial JavaScript bundle (~642 kB) Medium
   Buttons have small touch targets Medium
   Basic list functionality Medium
   Limited reusable component library Medium
   Native browser confirmation pop-ups Low
   Accessibility improvements needed Low

Source: documentation/reviews/2026-11-02-ui-audit.md

My additional recommendation is to prioritize the warehouse experience.

The primary users are likely to spend considerable time working with:

- Stock tables.
- Transfer screens.
- Approval queues.
- Item details.
- Receiving and issuing workflows.
  These screens should be designed around operational speed, not simply desktop administration.

A warehouse employee should be able to identify available stock, create a request and track its status without navigating several unrelated pages.

The mobile experience deserves particular attention, even though the first release is a web application.

6. Testing and quality assurance
   The testing approach is promising, particularly the SQL tests.

The transfer test suite covers:

- Unauthorized approvals.
- Self-approval.
- Reservation and release.
- In-transit stock.
- Batch tracking.
- Expiry preservation.
- Quarantined batches.
- Storage-condition mismatches.
- Cross-organization isolation.
- Append-only records.
- Multiple approvals.
- Audit-chain integrity.
  The worklog reports that test 029 passed and rolled back its test data.

There are still important gaps:
Test category Assessment
TypeScript type checking Reported passing
Shared package tests Reported passing
API tests Reported passing
SQL business-rule tests Reported passing
Multi-tenant isolation SQL coverage exists
Real-user API integration Incomplete
Browser testing Incomplete
Mobile responsiveness Not fully verified
Production monitoring Incomplete
Automated SQL regression testing Missing from CI

I did not execute the repository's test suite locally during this audit. The passing results above are based on the repository's recorded worklog, test artifacts and implementation evidence.

7. Recommended development priorities
   I would organize the next development cycle into four stages.
   Phase 1 — Stabilization
   First priority

- [ ] Fix storage-condition validation.
- [ ] Add missing SQL regression tests.
- [ ] Reconcile migration documentation.
- [ ] Verify API permission boundaries.
- [ ] Complete real-user invitation tests.
- [ ] Verify production environment configuration.

  Phase 2 — Deployment and operational validation

- [ ] Deploy the latest API.
- [ ] Deploy the latest frontend.
- [ ] Run authenticated end-to-end workflows.
- [ ] Test inventory transfers with multiple roles.
- [ ] Test approval and rejection.
- [ ] Test warehouse receiving and dispatch.
- [ ] Verify backup and recovery procedures.

  Phase 3 — Usability

- [ ] Complete Arabic localization.
- [ ] Improve mobile layouts.
- [ ] Add list filters and pagination.
- [ ] Implement code splitting.
- [ ] Improve reusable UI components.
- [ ] Improve reporting and navigation.

  Phase 4 — Product expansion

- [ ] Complete purchasing workflows.
- [ ] Complete sales workflows.
- [ ] Implement ETA e-invoicing.
- [ ] Implement customer billing.
- [ ] Develop accounting exports.
- [ ] Validate WhatsApp approval demand with customers.

8. Final verdict
   My assessment is that the project has a credible technical foundation and a meaningful differentiator: database-enforced warehouse approvals combined with an eventual WhatsApp/voice workflow.

However, it is not yet a complete, production-ready ERP.

The biggest risk is not the technology stack. It is the gap between implementation and verification.

The project should avoid expanding into more modules before stabilizing its existing functionality, reconciling its documentation and completing production validation.

My recommendation: Finish Phase 1 and Phase 2 before adding another major ERP module.
