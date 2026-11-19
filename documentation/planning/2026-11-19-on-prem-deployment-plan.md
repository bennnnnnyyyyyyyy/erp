# On-premises deployment with a licence — plan (19 Nov 2026)

**Status:** plan for Ben and Joe to review; nothing built. **Asked by:** Joe, via Ben, 19 Nov 2026. **No customer, date or server spec yet.**

## 1. Goal

A customer can run the ERP on their own server, inside their own network, under a licence we issue. The same product and code as the
cloud version; the customer's data never leaves their server unless they choose.

## 2. Ben's decisions (19 Nov)

| Question | Decision |
|---|---|
| Internet on the server | **Not known yet:** the design must work fully offline and use the internet when it is there |
| Licence | **A signed licence file** we issue; checked on the server, no call home needed |
| Licence limits | **Expiry date, number of users, number of companies, modules** |
| At expiry | **Warnings from 30 days before, 14 days' grace, then read-only** (data can still be seen and exported) |
| Install and updates | **Docker Compose** (one package, one command) |
| Backups | **Built-in nightly backup** with one-command restore; their IT may replace or extend it |
| First step | **This written plan only** |
| Edition | **Same code and releases as the cloud for now**, built so a separate on-prem edition can be split off quickly if needed |
| AI assistant, voice notes | **Not sent abroad.** We publish the requirements to run an equivalent local model through Ollama on their own hardware; the owner points the app at it. Not tested by us yet (no suitable machine) |
| Updates | **Their IT runs `./update` when we send a release** (online or from USB); nothing updates on its own |
| Support access | **Only when they open it** (a support bundle with no business data, or a remote session they start) |
| Servers | **Linux (Ubuntu) first**; Windows Server with Docker later if a customer needs it |

### Egypt: legal points (Ben, 19 Nov; to be confirmed by an Egyptian lawyer)

| Topic | Decision |
|---|---|
| Personal data (Law 151/2020) | The customer is the data controller and holds any PDPC licence. **Data stays on their server:** nothing is sent abroad by default (AI off, licence offline); our support bundle holds no personal data. We give a short data-protection note listing what the system stores and where |
| Tax records (Unified Tax Procedures Law 206/2020) | **Nothing is ever deleted.** After the licence expires the data stays viewable (read-only) and a full export (CSV and database dump) is always allowed, licensed or not |
| ETA e-invoicing and e-receipts | **The customer holds their own ETA credentials and e-signature token (USB token or HSM) on their server;** we never hold them. Submission needs the internet; documents wait in a queue while offline |
| Licence agreement (EULA) and guide | **Arabic and English, Arabic prevails;** Egyptian law and courts; reviewed by an Egyptian lawyer. Covers copyright (IP Law 82/2002), no reverse engineering, the licence limits, and that the data is the customer's |

## 3. What runs on the customer's server

Today the cloud version is: web app (Cloudflare Pages) → API (Cloudflare Worker, Hono) → Supabase (Postgres, sign-in, PostgREST).
On-prem, one Docker Compose package holds all of it:

| Container | What it is | Notes |
|---|---|---|
| `db` | Postgres (Supabase's image) | All migrations `sql/001…` applied by the update script |
| `auth` | Supabase Auth (GoTrue) | Sign-in, invitations, password reset; email through the customer's own mail server (SMTP) if they have one |
| `rest` | PostgREST | What the API calls today; unchanged |
| `api` | Our API on Node (Hono's Node adapter) | Same code as the Worker; small adapter for the two rate limiters and the 5-minute job |
| `web` | The built web app behind a web server (Caddy or nginx) | HTTPS with the customer's certificate, or a self-signed one inside their network |
| `backup` | Nightly `pg_dump` to a folder they choose | Keeps 14 days; restore script |

Minimum server (to confirm with a load test): 4 CPU cores, 8 GB RAM, 100 GB SSD, Linux (Ubuntu 22.04/24.04) or Windows Server with
Docker. Up to about 50 users.

## 4. What changes in our code

Small, because the API uses almost nothing Cloudflare-specific (checked 19 Nov: two rate limiters and a cron; the rest is settings):

1. **Node entry point** for the API next to the Worker one (`apps/api/src/node.ts`): same Hono app; rate limiting in memory; the
   5-minute job (`jobs/outbox.ts`, `jobs/fx.ts`) run by a timer.
2. **Settings from environment variables** instead of Wrangler: database and sign-in addresses, allowed origins, keys. One `.env`
   file the installer writes.
3. **Licence check** (section 5) in the API and the database.
4. **Features that need the internet** switch themselves off cleanly when it is missing: ETA e-invoicing submission, WhatsApp,
   Telegram, Paymob, Bosta, Shopify, exchange rates, the AI assistant. Screens say "needs an internet connection" instead of failing.
   ETA documents can wait in a queue and be submitted when the connection returns.
5. **CI builds the on-prem images** (API and web) for each release tag and runs the SQL tests against the on-prem database image.

No change to tenancy, RLS, approvals or the audit log: an on-prem server is the same multi-company system with one or a few companies.

## 5. The licence

**File:** a small JSON document plus our signature (Ed25519). We keep the private key (never in the repo, never on a customer server);
the public key is built into the product.

```
{ "licenceId": "L-2026-0001", "customer": "Example Trading", "issued": "2026-12-01", "expires": "2027-12-01",
  "maxUsers": 25, "maxCompanies": 2, "modules": ["inventory", "purchasing", "sales", "finance", "accounting"],
  "serverId": "optional: ties the licence to one server" }
```

**Checks:**
- On start-up and daily, the API verifies the signature and dates. A file that is changed by even one character fails the signature.
- **Users:** a new member cannot be added past `maxUsers` (active members across all companies).
- **Companies:** a new company cannot be created past `maxCompanies`.
- **Modules:** only listed modules can be switched on (`org_modules`).
- The database enforces the same limits (a settings row written only by the licence import function), so a call around the API does
  not get past them; every licence import is in the audit log.

**Expiry:** from 30 days before, owners see a banner. After the expiry date, 14 days' grace with a stronger banner. Then **read-only**:
everyone can still sign in, see, print and export; nothing new can be posted. A new licence file lifts it at once.

**Issuing:** a small internal tool (a script at first) takes the customer's details and signs the file. Renewals are a new file sent
by email; the owner uploads it in Settings → Licence. Online or offline, the same.

**Honest limit:** a determined customer with full control of the server can always tamper with software they run. The licence keeps
honest customers honest and makes tampering a clear breach of contract; the contract does the rest.

## 6. Install, updates and support

- **Install:** we send a package (or a private registry login when online) and a one-page guide. `./install` asks for the licence
  file, the server address and the email settings, writes `.env`, starts the containers and creates the first owner.
- **Updates:** each release is a version number. `./update` pulls (or loads from USB when offline) the new images, takes a backup,
  runs the new migrations, restarts, and checks health. If a migration fails, it stops and restores the backup.
- **Versions:** on-prem customers get the stable releases, not every merge; we keep at most the last two versions supported.
- **Support:** a "support bundle" button for owners exports logs and versions (no business data) to send us. Remote access only if
  the customer opens it.

## 7. Backups

Nightly `pg_dump` of the database to a folder they choose (another disk or a network share), 14 days kept, checked by a test restore
once a month into a scratch database. `./restore <file>` brings the server back to that night. Their IT may switch it off and use
their own backups instead; the guide says what must be included.

## 8. Rollout (in order, each reviewed before the next)

1. **Proof on one machine:** Docker Compose running the current app with a test licence; the walkthrough passes on it.
2. **Licence:** file format, signing tool, checks in the API and database, Settings → Licence screen, expiry banners and read-only
   mode, with tests.
3. **Offline behaviour:** every internet feature degrades cleanly; ETA queue.
4. **Install, update, backup and restore scripts**, tested on a clean Ubuntu server and on Windows with Docker.
5. **Release process:** tagged releases build the images; an install guide in Arabic and English.
6. **Pilot** with the first customer.

## 9. Open questions (any decision above can still change while the work is under way)

**For Joe:**
1. **Internet:** will the first customers' servers have the internet? (Decides how much of section 4.4 comes first.)
2. **Pricing:** yearly licence including updates and support, a one-off licence plus yearly support, or per user per year?
3. **Installation:** Ben's view: as is usual for on-prem software, **we install the first two or three customers ourselves** (remote
   or on site, often as a paid setup) to prove the guide, then their IT or a local partner installs from the guide.
4. **Servers:** Ben's view: **Ubuntu Linux first**. Do the customers you have in mind run Windows only?

**Decided later:**
5. **Licence signing key:** who holds it and where (to decide before the first licence is issued; never in the repo or a laptop file).

**For a lawyer (Egypt):** the data-protection note, the EULA, and whether on-prem customers need anything from us for their PDPC
licence.

**For the accountant:** ETA from a customer's own server with their own token (expected to be the same as the cloud set-up).
