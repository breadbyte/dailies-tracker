# Deployment

How the app is deployed. Nothing is deployed automatically; every deploy needs
an operator and explicit user approval. No billing or paid plan is required for
any command in this document.

## What gets deployed

| Target | Project name | Config | Serves |
| --- | --- | --- | --- |
| Static SPA | `dailies-pages` | `worker/wrangler.pages.jsonc` | The built SPA from `dist/`, including `_headers` and `_redirects` |
| API | `dailies-worker` | `worker/wrangler.jsonc` | `/api/v1/*` (health, account, artwork proxy) |

The Worker and the Pages site are **separate deployments**. The SPA never
bundles Worker code; the Worker's public asset path and Pages Functions are
intentionally unused so the static site stays deployable on its own.

A single Wrangler config cannot be both a Worker config (`main`) and a Pages
config (`pages_build_output_dir`), which is why Pages has its own file.
Commands that target Pages must pass `-c wrangler.pages.jsonc`; without it,
Wrangler auto-detects only `worker/wrangler.jsonc` and treats the project as a
Worker.

## Commands

Run from the repository root:

| Command | What it does |
| --- | --- |
| `pnpm run pages:deploy` | Builds the SPA (`build` runs catalog validation, typecheck, Vite, legal copy) and deploys `dist/` with `wrangler pages deploy` on the production branch `main` |
| `pnpm run worker:deploy` | Runs Worker typecheck + tests (`predeploy`), then `wrangler deploy` |
| `pnpm run deploy` | Worker deploy, then Pages deploy |

Preview deploys of the SPA to a branch other than `main` forward an overriding
flag last, and the last `--branch` wins:

```sh
pnpm run pages:deploy -- --branch=<branch-name>
```

`pages:deploy` always builds first so a stale `dist/` cannot be published. The
synced catalog is validated by the `prebuild` script as part of that build.

## One-time setup (requires user approval)

From `worker/` (`npx wrangler` resolves the correct binary and directory):

1. Authenticate:

   ```sh
   npx wrangler login
   ```

2. Create the Pages project with `main` as the production branch:

   ```sh
   npx wrangler pages project create dailies-pages --production-branch=main
   ```

3. Set the Worker's non-secret vars in `worker/wrangler.jsonc` before the
   first deploy (both ship as empty placeholders):
   - `ALLOWED_ORIGINS`: comma-separated Pages origins allowed to call the API,
     e.g. `https://dailies-pages.pages.dev` plus the production custom domain.
   - `FIREBASE_PROJECT_ID`: the public Firebase project ID. Leave empty only if
     `GET /api/v1/account` should stay disabled.

4. Optional secrets are set with `wrangler secret put`, never committed, and
   never prefixed with `VITE_`:

   ```sh
   npx wrangler secret put STEAMGRIDDB_API_KEY
   ```

   `wrangler secret put` on an existing Worker publishes a new version, so run
   it before or right after the first deploy. For local development, copy the
   placeholder values into `worker/.dev.vars` and never commit real values.

5. Edge protection (WAF challenge and rate-limit rules on the zone) is applied
   separately after deploy; see `docs/edge-protection.md` and its approval
   prerequisites.

## Verification

Run the full repository check before deploying:

```sh
pnpm run check
```

After deploying, verify the SPA and the Worker rather than assuming the tests
cover the deployed surfaces:

1. `https://<pages-hostname>/` loads the dashboard and a deep link such as
   `/games` renders instead of 404 (SPA fallback from `_redirects`).
2. `GET https://<worker-hostname>/api/v1/health` returns `{"status":"ok"}`.
3. A browser page served from the Pages origin can call the Worker without a
   CORS error, which confirms `ALLOWED_ORIGINS` lists the deployed Pages
   origin(s). See `docs/authentication.md` for the CSP implications of remote
   origins and `docs/artwork.md` for the artwork proxy.
4. Run the deployed edge-protection checks in `docs/edge-protection.md`
   ("Deployed checks") and record the date, domain, and results. Those checks
   are not considered passed until they have been run against the deployed
   zone.

## Rollback

- Pages: `npx wrangler pages deployment rollback` (from `worker/`), or pick an
  earlier deployment in the dashboard.
- Worker: redeploy a previous version (`npx wrangler versions list` /
  `npx wrangler versions rollback`), or `git`-checkout an earlier commit and
  run `pnpm run worker:deploy`.
- Edge-protection rollback is described in `docs/edge-protection.md`.

## Constraint reminders

- Keep local/device-only features independent of the Worker; failures of any
  cloud call degrade, they do not crash the UI.
- Never deploy to production without explicit user approval, and never enable
  billing or a paid plan.
- Do not commit real project IDs or secrets in place of the empty placeholders
  in the committed configs; set non-public values with `npx wrangler secret
  put` or in `worker/.dev.vars` (never committed).
