# Preview deploys (sample-data build on Cloudflare Pages)

A preview is a copy of a branch's web app, published at an address of its own so people can look at it without running anything.
It is built from the **sample-data build** (`npm run build:demo`): no API, no database, no sign-in, no real data.

## Run one

1. Merge `.github/workflows/preview-deploy.yml` to `main` once. (GitHub lists a manual workflow only when its file is on the
   default branch.)
2. GitHub > Actions > **Preview deploy (sample-data build)** > **Run workflow**, choose the branch to preview in "Use workflow from",
   leave **Include the Design Lab** ticked if you want the Lab, then run it.
3. When it finishes, the run summary shows the two addresses: this deployment and the branch address, for example
   `https://<branch>.erp-demo-bas.pages.dev`. The branch address updates each time the workflow runs on that branch.

By hand, from a checkout of the branch (needs a Cloudflare login, `npx wrangler login`):

```
npm run build:demo -w apps/web          # add DESIGN_LAB=1 in front to include the Design Lab (PowerShell: $env:DESIGN_LAB='1')
npx wrangler pages deploy apps/web/dist --project-name erp-demo --branch <branch-name>
```

## Rules

- **Never run it on `main`.** `--branch main` is the project's production deployment, i.e. the public demo. The workflow refuses.
- The address is public: anyone with the link can open it. Sample data only.
- The Design Lab (`components/DesignLab.tsx`) is in a build only when `DESIGN_LAB=1` is set for that build. The normal build and the
  production deploy (`ci-deploy.yml`) never set it. The preview workflow fails if the Lab is in a build that should not have it. Do not
  add `DESIGN_LAB` to `ci-deploy.yml`.
- The Lab loads Google Fonts from the internet when a font other than Plex is chosen: fine for a preview, not for the product.
- This does not touch the real app (`erp-live`), the API Worker or the database. A preview of the real app is not possible as
  things stand: the API only accepts requests from `https://erp-live.pages.dev` (`ALLOWED_ORIGINS` in `apps/api/wrangler.toml`), and
  it would read production data.
