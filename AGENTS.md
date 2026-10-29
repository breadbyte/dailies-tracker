# AGENTS.md — Working in this repository

Guidance for coding agents and contributors. `PLAN.md` is the source of
truth for product scope; this file covers how to work in the repo.

## Project summary

A local-first SPA that tracks game daily logins, reset countdowns, and
reminders. Device-only mode is the default and must always work without
accounts, network calls, or notification permission. Cloud features
(Firebase auth, push reminders) are optional, separate, and opt-in.

## Layout

- `src/` — React + TypeScript SPA (Vite).
  - `app/` route table (`router.tsx`) and root (`App.tsx`).
  - `features/` page-level slices; `components/` shared layout and UI.
  - `domain/` pure TypeScript rules (schedule engine, no React/DOM).
  - `services/` typed access to storage, catalog, clock, import/export.
  - `test/` Vitest setup.
- `tests/` — `integration/`, `unit/`, `e2e/`, `fixtures/`.
- `worker/` — **standalone** Cloudflare Worker package (own lockfile).
- `scripts/` — dev/CI tooling (Node, `.mjs` and later `.ts`).
- `data/` — bundled/validated catalog artifacts (added in Phase 2).
- `docs/` — operational runbooks (edge protection, deployment).

## Commands

Run from the repository root:

| Command | Purpose |
| --- | --- |
| `pnpm install` | Install frontend dependencies |
| `pnpm run dev` | Vite dev server on http://localhost:5173 |
| `pnpm run build` | Typecheck, then production build to `dist/` |
| `pnpm run preview` | Serve the production build |
| `pnpm run lint` | ESLint |
| `pnpm run typecheck` | Frontend + `scripts/` typecheck |
| `pnpm run test` | Vitest unit/integration tests |
| `pnpm run check` | All frontend checks + Worker typecheck/tests |
| `pnpm --dir worker install` | Install Worker dependencies (separate) |
| `pnpm run worker:dev` | `wrangler dev` (local Worker) |
| `pnpm run worker:typecheck` | Worker typecheck |
| `pnpm run worker:test` | Worker tests |
| `pnpm run pages:deploy` | Build the SPA, then deploy it to Cloudflare Pages |
| `pnpm run worker:deploy` | Typecheck + test the Worker, then `wrangler deploy` |
| `pnpm run deploy` | Worker deploy, then Pages deploy |

## Conventions

- **Package manager:** pnpm (`pnpm-lock.yaml`). Do not commit
  `package-lock.json`. Root and `worker/` lockfiles are separate; pin
  tool versions the same way in both unless a runtime difference requires
  otherwise.
- **TypeScript:** `~6.0.3`, pinned deliberately. typescript-eslint does not
  support TypeScript 7 yet, so do not bump to 7.x until it does. Run both
  `typecheck` and `lint` after dependency changes.
- **Imports:** ESM with explicit `.ts`/`.tsx` extensions
  (`allowImportingTsExtensions`); no `.js` re-export tricks.
- **Tests:** Vitest + React Testing Library. Tests live under `tests/` or
  next to source as `*.test.ts(x)`. Never report an unrun test as passing.
- **Storage:** all persistent access goes through `src/services/storage/`.
  `localStorage` is for small preferences only; IndexedDB for records.
- **Domain purity:** `src/domain/` must not import React, browser globals,
  or storage code. Inject the clock for anything time-dependent.
- **Countdowns:** derive from timestamps, never persist ticking values.
- **Worker:** `worker/src/env.ts` is hand-written only while there are no
  bindings. Once D1/secrets exist, run `pnpm run worker:types` and use the
  generated `Env` instead of hand-editing it.
- **Cloud optionality:** local features must never depend on the Worker.
  Guard all cloud calls; failures degrade, they do not crash the UI.

## Safety rules

- Never commit secrets, real Firebase config, `.env*` (except
  `.env.example`), or `worker/.dev.vars`. Never prefix secrets with `VITE_`.
- Never execute downloaded JavaScript (catalog ingestion must parse, not
  evaluate). Treat upstream game data as untrusted input.
- Do not enable billing, paid plans, or deploy to production without
  explicit user approval.
- Preserve user data across migrations, catalog updates, and imports;
  custom schedules must never be silently replaced by catalog defaults.
- Keep changes scoped to the current `PLAN.md` phase.

## Phases

Work through `PLAN.md` §16 one phase at a time and report changes, commands,
passed/unrun checks, limitations, and remaining acceptance criteria at the
end of each phase.

## Current status

- **Phase 1 complete** (scaffolding, tooling, Worker skeleton, docs).
- **Phase 2 complete** (Game Time Master ingestion, bundled validated
  catalog, attribution).
- **Phase 3 complete** (typed IndexedDB storage, preferences, selections,
  custom games, login completions, migrations and recovery).
- **Phase 4 complete** (pure time-zone-aware schedule engine, schedule
  overrides, live dashboard countdowns, deterministic boundary and
  daylight-saving tests).
- **Phase 5 complete** (dashboard, catalog search and region selection,
  persisted schedule overrides, manual login completion and undo,
  upcoming-reset and recurring-event views).
- **Phase 6 complete** (versioned JSON backup export, validated import
  preview, merge/replace workflows, transactional restore, and historical
  schema fixtures).
- **Phase 7 partially applied** (Pages security headers, SPA fallback checks,
  and the edge-protection runbook are committed). The Cloudflare zone challenge
  and rate-limit rules, plus live verification, still require an approved
  deployment; see `docs/edge-protection.md`.
- **Phase 8 complete** (optional email/password Firebase Authentication,
  authentication-state handling, local-data preservation, and Worker ID-token
  verification for `GET /api/v1/account`). Account synchronization remains out
  of scope; see `docs/authentication.md`.
- **Login activity heatmap** (GitHub-style calendar; darker squares mean more
  distinct games logged per day) and **optional SteamGridDB artwork** via the
  Worker secret proxy are implemented. See `docs/artwork.md`.
- Catalog commands: `pnpm run catalog:sync` and
  `pnpm run catalog:validate`. Source data and license notes live in
  `data/`; `scripts/catalog.ts` parses upstream JavaScript as data and never
  executes it.

## Game card artwork (SteamGridDB)

- Game cards may optionally use artwork fetched from SteamGridDB. Keep this
  integration optional: the app must remain fully usable in device-only mode
  without accounts, API credentials, or network access, and bundled/local
  artwork or a neutral fallback must continue to work.
- Make artwork source and variant user-selectable. Include SteamGridDB as an
  option rather than replacing existing artwork behavior.
- When SteamGridDB is selected, default to the **top-rated grid image** for
  the matched game. Define “top-rated” using the API's documented rating or
  ordering semantics; do not assume the first result is highest-rated unless
  the API guarantees that ordering. Provide a picker so users can choose a
  different available grid image.
- Protect the SteamGridDB API from rate limiting:
  - Cache game lookups and image results locally, including negative/no-match
    results, and reuse cached results across views and app restarts.
  - Deduplicate concurrent requests for the same game and avoid fetching the
    same artwork repeatedly while rendering cards.
  - Use bounded, sequential or conservatively throttled requests; do not issue
    one request per card render or bulk-fetch the whole catalog.
  - Respect API rate-limit responses and `Retry-After` when present. Apply
    exponential backoff with jitter, stop retrying after a small bounded
    number of attempts, and surface a non-fatal fallback on failure.
  - Fetch lazily for visible/selected games, and avoid automatic refresh loops.
  - Keep API credentials out of client bundles and local exports. If the API
    requires a secret credential, route requests through an explicitly
    configured server-side proxy; never add a secret to a `VITE_` variable.
- Document cache lifetime/refresh behavior, attribution or licensing
  requirements, and any required API key setup. Tests should cover caching,
  request deduplication, rate-limit/backoff handling, missing matches, and
  fallback behavior.
- Do not enable paid services, billing, or production deployment without
  explicit user approval.
