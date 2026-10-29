# Dailies

A local-first web app for tracking daily game logins, reset countdowns, and
recurring events across multiple games.

- Works with **no account** and **no notifications**.
- Data stays **on your device** (IndexedDB + `localStorage`).
- Countdowns are calculated **in the browser**; no backend is needed.
- Cloud features (sign-in, push reminders) are optional and off by default.

The intended host is Cloudflare Pages. See `PLAN.md` for the full product
specification and implementation phases.

## Status

**Phase 8 of `PLAN.md` is complete.** Phase 7 (website edge protection) is
applied in the repository and documented, but the Cloudflare zone rules and
live verification require an approved deployment.

The app ships a validated Game Time
Master catalog, typed local storage for game selections, custom games, login
completions, schedule overrides, and preferences, a pure schedule engine for
daily, weekly, interval, custom, and one-off schedules, and account-free JSON
backup export and import. The dashboard tracks manual login completion,
upcoming resets, recurring events, and a GitHub-style login activity heatmap
where darker squares mean more distinct games logged that day. Countdowns are
derived from timestamps in the browser, including IANA time zones and
daylight-saving transitions.
Game and region selection plus custom schedule editing live on the Games page;
versioned backup validation, merge/replace previews, and transactional restore
live on the Data page. Optional email/password Firebase Authentication and
server-side ID-token verification live on the Account page and Worker. See
`AGENTS.md` for the current phase and conventions.

## Prerequisites

- **Node.js 22.12 or newer** (`node --version`)
- **pnpm** (`corepack enable pnpm` or `npm install -g pnpm`)
- Optional, for local Worker development: a Cloudflare account is **not**
  required for `wrangler dev`; it is only needed to deploy later.

## Install and run

```sh
pnpm install
pnpm run dev          # http://localhost:5173
```

Production build:

```sh
pnpm run build        # typecheck + vite build -> dist/
pnpm run preview      # serve dist/ locally
```

## Checks

```sh
pnpm run lint
pnpm run typecheck
pnpm run catalog:validate
pnpm run test
pnpm run build
pnpm run worker:typecheck
pnpm run worker:test
```

Or run everything at once with `pnpm run check`. CI should run the same
commands as separate steps (see `PLAN.md` §15.5).

## Worker (optional backend)

The Worker is a **separate** package with its own lockfile, because it
runs in the Cloudflare Workers runtime rather than the browser.

```sh
pnpm --dir worker install
pnpm run worker:dev            # local Worker at http://localhost:8789
pnpm run worker:typecheck
pnpm run worker:test
```

It exposes `GET /api/v1/health` and, when configured, the protected
`GET /api/v1/account`. The account endpoint requires a Firebase ID token and
returns only the identity proven by that token; it stores no account data and
implements no synchronization. When a `STEAMGRIDDB_API_KEY` secret is set, the
Worker also proxies optional `GET /api/v1/artwork?name=...` lookups so the key
never enters the browser bundle. The Worker is not required by, and never
called by, the default device-only app.

## Optional sign-in

Email/password registration, sign-in, sign-out, password recovery, and
account deletion are available on the **Account** page when all four public
Firebase values are configured. Sign-in stays off otherwise, and the app
continues to work fully offline.

- Signing in, signing out, or deleting an account never changes local games,
  schedules, login history, or preferences.
- Account synchronization is not implemented. A signed-in account does not
  upload or restore game data.
- The Worker's `/api/v1/account` endpoint verifies token signatures, issuer,
  audience, subject, `auth_time`, and expiry. It does not trust a client UID.
- Google sign-in and email verification flows are not implemented.
- Passwords are handled by the Firebase SDK and are never stored by Dailies.

Setup, CORS, token-verification, and limitation details are in
[`docs/authentication.md`](docs/authentication.md).

## Edge protection

`public/_headers` adds a restrictive content security policy, clickjacking and
MIME-sniffing protections, and immutable caching for hashed `/assets/*` files;
`public/_redirects` provides the SPA fallback. `tests/unit/edge/` checks that
configuration so it cannot silently regress.

The whole-site challenge, static/API exemptions, and API rate limit are
Cloudflare **zone** configuration, not repository code. The exact expressions,
scope limitations (`*.pages.dev` and `*.workers.dev` are outside the zone),
verification checklist, and rollback steps are in
[`docs/edge-protection.md`](docs/edge-protection.md). The app never calls the
challenge service, and local features keep working if edge protection is
unavailable.

## Configuration

Configuration is environment-specific and never committed.

**Frontend** — public build-time values in `.env.local` (copy from
`.env.example`). Vite only exposes variables prefixed with `VITE_`, and
everything exposed is embedded in the browser bundle, so never put secrets
there. All values are empty by default; the app functions without them.

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | Optional Worker base URL (cloud and artwork features) |
| `VITE_FIREBASE_*` | Optional public Firebase web config (Phase 8) |

**Worker** — secrets and per-environment vars live in `worker/`:

- Non-secret vars are in `worker/wrangler.jsonc` (`ALLOWED_ORIGINS`,
  `FIREBASE_PROJECT_ID`).
- `FIREBASE_PROJECT_ID` must match the frontend Firebase project for token
  verification; leave it empty to disable the account endpoint.
- `STEAMGRIDDB_API_KEY` is an optional secret that enables artwork proxying.
  Set it with `wrangler secret put STEAMGRIDDB_API_KEY`; leave it unset to keep
  artwork off.
- Local overrides: copy `worker/.dev.vars.example` to `worker/.dev.vars`
  (git-ignored).
- Production secrets: `wrangler secret put <NAME>` — never committed.

Build-time frontend variables and runtime Worker bindings are separate:
changing a Worker binding does not require rebuilding the frontend, and
frontend variables are visible to every visitor.

## Optional artwork

Game cards can optionally show SteamGridDB cover art. Artwork is off by
default, loads lazily, and is cached on the device for 30 days (missing matches
for 7 days). The browser asks the Worker proxy, which holds the API key, so the
key is never exposed to visitors. The per-card picker selects a variant, or
leave it on "Top rated". If the Worker or network is unavailable, the neutral
placeholder remains and the rest of the app is unaffected.

Setup, cache lifetimes, rate-limit handling, attribution, and privacy details
are in [`docs/artwork.md`](docs/artwork.md).

## Data and privacy

Nothing is uploaded by the default mode. No analytics or third-party
scripts are included. Backups are local JSON files downloaded by you; the
application never uploads them.

When optional sign-in is configured and used, email and password credentials
are sent directly to Firebase Authentication. Game data, schedules, and login
history still stay in this browser; sign-in does not enable synchronization.

## Local storage

All persistent access goes through `src/services/storage/`. IndexedDB database
`dailies` (schema version 3) stores game selections, custom games, login
completion history, per-server schedule overrides, and the optional artwork
cache. Small preferences, including the artwork source and per-game artwork
choices, use the `dailies:preferences` `localStorage` key. Records are validated on write
and on read; unsupported
database versions are rejected without changing stored data. Corrupt
preferences are copied to `dailies:preferences:recovery` before defaults are
restored.

## Backups

The **Data** page exports and imports a versioned JSON file with
`format: "dailies-backup"` and `schemaVersion: 1`. It contains preferences,
selected games and regions, custom games, custom schedules, and complete login
completion history. It never contains passwords, authentication tokens, push
subscription endpoints, messaging credentials, or other secrets.

Import validation runs before any write: file size (10 MB maximum), JSON
syntax, format identifier, schema version, every record, derived IDs, time
zones, and reset rules. Duplicate record IDs are rejected. A backup from a
newer schema version is rejected without touching local data.

Merge mode:

- Records are matched by stable ID.
- Selected games, custom games, and custom schedules use their `updatedAt`
  value: a newer imported copy updates the local record; an older or equally
  old copy is skipped, so local edits win ties.
- Login completions are append-only and deduplicated by ID.
- Existing saved preferences are kept. Imported preferences are applied only
  when this profile has no saved preference value.

Replace mode:

- Requires explicit confirmation.
- Clears only the categories selected in the preview, then writes the imported
  records for those categories; unselected categories are untouched.
- Downloads a backup of the current data first.
- Writes all selected record categories in one IndexedDB transaction. A
  failed transaction is aborted, and a preference write is rolled back if the
  database transaction fails.

The baseline fixtures in `tests/fixtures/backups/` pin the schema version and
validation behavior so future migrations can be tested against historical
files. Add a migration function when introducing schema version 2; never make
an existing version silently change meaning.

The same page has a confirmed **Delete all local data** control that removes
the IndexedDB database and preference keys. Export a backup first if the data
may be needed again.

## Schedules and countdowns

`src/domain/schedule/` is pure TypeScript with no React, storage, or network
access. It supports daily, weekly, interval, custom-weekday, and one-off
schedules in IANA time zones, UTC, or fixed UTC offsets. Occurrences are
calculated from an explicit reference timestamp, so sleep, tab suspension, and
clock changes cannot accumulate timer drift. Ambiguous fall-back times resolve
to the earlier occurrence and spring-forward gaps resolve forward. A user
override is resolved at calculation time and never mutates the bundled catalog.

## Game catalog

The bundled catalog lives in `data/game-catalog.json`, with source revision,
retrieval time, counts, and a SHA-256 recorded in
`data/game-catalog-metadata.json`. The app imports it as static data, so the
dashboard never fetches game times at runtime.

Regenerate it from the upstream repository (developer/CI operation only):

```sh
pnpm run catalog:sync
pnpm run catalog:validate
```

`sync` parses the upstream JavaScript as data without executing it. Invalid
upstream or normalized data leaves the previous catalog untouched.

## License and attribution

Game reset data comes from
[Game Time Master](https://github.com/cicerakes/Game-Time-Master) at the
revision recorded in the catalog metadata. The upstream project is
GPL-3.0-only; see `data/ATTRIBUTION.md` and
`data/LICENSE-Game-Time-Master`. Only data is reused; no upstream icon assets
are bundled.
