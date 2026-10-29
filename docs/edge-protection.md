# Website edge protection

This runbook covers Phase 7 of `PLAN.md`: protecting the Pages application with
Cloudflare's native edge controls. The application stays device-only; the
challenge is a gate in front of the static UI, not part of the app, and the
app never calls a challenge service.

Two layers are involved:

| Layer | Where it lives | Status |
| --- | --- | --- |
| Response headers, asset caching, SPA fallback | `public/_headers`, `public/_redirects` | Committed and checked by tests |
| WAF challenge, API rate limit, zone/host scope | Cloudflare dashboard or Rulesets API | **External setup required** |

No Cloudflare account, zone, token, or deployment is created by the
repository. Do not apply these rules to production without explicit approval.

## Traffic policy

| Request | Treatment | Why |
| --- | --- | --- |
| Document navigations (`/`, `/games`, `/data`, unknown paths) | Managed Challenge | Protected content is the SPA shell; a challenge is solved once per `cf_clearance` lifetime, not per in-app navigation. |
| Hashed build assets (`/assets/*`) | Exempt | The browser needs them immediately after the challenge; they contain no user data. |
| `/manifest.webmanifest`, `/licenses/*`, `/favicon.ico`, `/robots.txt`, `/sw.js` | Exempt | Required for install metadata, attribution, and future Service Worker registration. |
| `/cdn-cgi/*` | Exempt | Cloudflare challenge-platform resources. |
| `/api/*` | Exempt from the challenge | API clients cannot solve browser challenges. Protect APIs with rate limiting and, later, token verification. |
| Verified bots (`cf.client.bot`) | Exempt from the challenge | Avoids blocking legitimate crawlers. Remove this clause if every automated client must be challenged. |
| `*.pages.dev`, preview/branch hostnames | **Not covered by zone WAF** | They are Cloudflare-owned hostnames outside your zone. Restrict preview access separately or accept that they are public. |
| `*.workers.dev` API | **Not covered by zone WAF** | Only a Worker routed on the zone (`api.example.com` or `example.com/api/*`) is in front of the zone rules. |

The challenge is intentionally **not** a Turnstile widget and is not placed in
a login form. Turnstile and a Siteverify secret are not used in this phase.

The current build registers **no Service Worker**. When Phase 9 adds one, serve
it from a stable root path such as `/sw.js` (already exempt above) and verify
that registration succeeds through the zone rules in a browser.

### Known bypass

The policy challenges requests by path, not by `Accept` header, so a non-browser
client cannot avoid the challenge by sending a different header. A client that
solves the challenge (or a verified crawler) can still read the static shell.
That is acceptable: the device-only app stores no server-side user data. This
is deterrence and abuse reduction, not an authorization boundary for future
APIs. Keep API protection independent.

## Cloudflare setup

Apply to the **zone that serves the production custom domain**, in this order.
The rules fit the Free plan (5 custom rules, 1 rate limiting rule, no regex).

### 1. Exempt non-document traffic (custom rule, first)

- **Name:** `Dailies - exempt static and API traffic`
- **Expression:**

  ```txt
  starts_with(http.request.uri.path, "/assets/")
  or starts_with(http.request.uri.path, "/licenses/")
  or starts_with(http.request.uri.path, "/cdn-cgi/")
  or starts_with(http.request.uri.path, "/api/")
  or http.request.uri.path in {"/manifest.webmanifest" "/favicon.ico" "/robots.txt" "/sw.js"}
  ```

- **Action:** Skip
- **Skip:** remaining custom rules (`ruleset: current`) only. Do **not** skip
  all security products.

When a new public file is added at the site root, add it here. Files under
`public/` are copied to the build output; only the directories and names above
are exempt.

### 2. Challenge the application shell (custom rule, second)

- **Name:** `Dailies - managed challenge for app shell`
- **Expression:**

  ```txt
  not cf.client.bot
  ```

- **Action:** Managed Challenge

This challenges every request that rule 1 did not skip. If the dashboard
rejects `cf.client.bot` for the current plan, use `true` instead and accept that
verified crawlers are challenged too.

Managed Challenge issues a clearance cookie, so CSS, JavaScript, the manifest,
and client-side route changes do not re-challenge during normal use.
`Set-Cookie` and the clearance lifetime are controlled by Cloudflare; see the
zone's security settings.

### 3. Rate-limit the public API

Create one **rate limiting rule** (not a custom rule):

- **Name:** `Dailies - API rate limit`
- **Expression:** `starts_with(http.request.uri.path, "/api/")`
- **Characteristics:** IP
- **Period:** 10 seconds (the Free-plan period)
- **Requests:** 30
- **Action:** Block for 10 seconds

The Free plan includes exactly one rate limiting rule with path/IP matching and
10-second periods. This protects the current `GET /api/v1/health` endpoint and
is a placeholder policy for future endpoints; it is not a substitute for
authentication on protected APIs.

Only apply this if the Worker is reachable through the zone. A Worker on
`*.workers.dev` is outside the zone and needs its own abuse controls before it
exposes anything other than the health check.

## Verification

### Repository checks (automatic)

```sh
pnpm run build
pnpm run test
pnpm run check
```

`tests/unit/edge/edgeConfig.test.ts` parses `public/_headers` and
`public/_redirects` and fails if the SPA fallback, security headers, or
immutable asset caching regress.

### Local Pages emulation (optional)

```sh
pnpm run build
npm run worker:pages:dev -- --port 8788
```

`worker:pages:dev` runs `wrangler pages dev ../dist` from `worker/`, where
`../dist` is the built SPA at the repository root. Run it through the script
rather than invoking `wrangler` from the repository root: `../dist` only
resolves correctly with `worker/` as the working directory, and a wrong path
makes Pages serve an empty asset bucket where every request, including `/`,
returns a blank `404`.

With no `--port` the server inherits `dev.port` (`8789`) from
`worker/wrangler.jsonc`. Extra arguments after `--` are forwarded to Wrangler.

Then check that `/` and a deep link such as `/games` return the app shell,
`/manifest.webmanifest` returns JSON, and a hashed `/assets/*` request carries
the headers from `_headers`. This exercises Pages routing and headers locally;
it does not exercise the zone WAF.

### Deployed checks (after approval)

Use a private/incognito window against the production custom domain:

1. `/` shows a Cloudflare challenge, then the dashboard after solving it.
2. A hard navigation to `/games` and `/data` does the same and renders the
   route instead of a 404.
3. Reloading and moving between routes inside the app does not re-challenge
   before the clearance expires.
4. `/manifest.webmanifest` and a hashed `/assets/*.js` URL load without a
   challenge and with `Cache-Control: ... immutable` on the asset.
5. `GET /api/v1/health` returns `{"status":"ok"}` without a challenge; repeated
   bursts hit the rate limit with a blocked response.
6. `curl -I -H 'Accept: text/html' https://<domain>/` reports a challenge
   response (for example, `cf-mitigated: challenge`) for an unauthenticated
   client. An ordinary browser then completes the challenge.
7. A request to the `*.workers.dev` API, if any, confirms that it is **not**
   covered by the zone rules.

Record the date, zone, rule names, and results. Do not report these checks as
passed until they have been run against the deployed zone.

## Rollback

- Disable or delete the two custom rules in **Security > WAF > Custom rules**.
  The app is static and remains usable without them.
- Delete the API rate limiting rule if it causes false positives.
- No application data or local storage is affected by edge changes.
- Do not use "Block" for document navigations; rollback is faster than an
  outage investigation.

## Free-tier notes

Checked against Cloudflare's documentation in October 2026:

- WAF custom rules: 5 rules on Free; Managed Challenge and the Skip action are
  available; regex is not.
- Rate limiting: 1 rule on Free; path/IP matching and 10-second period and
  mitigation timeout.
- Cloudflare Pages static hosting and custom domains: no payment method is
  required for the configuration described here.

Recheck the current plan terms before applying. These rules do not require a
paid add-on, and the repository does not enable billing.

## Remaining external work

- Create the Pages project and custom domain in the zone.
- Add the two custom rules and the rate limiting rule with approval.
- Run the deployed checks above and record the result.
- Decide how preview deployments and any `*.workers.dev` endpoint are exposed.
- Revisit the content security policy when Phases 8 and 9 add remote origins.
