# Optional Firebase Authentication

Sign-in is optional. Device-only mode is the default: with no Firebase values
the Account page explains that sign-in is not configured, and every local
feature continues to work without an account, network call, or notification
permission.

Phase 8 implements:

- Email/password registration and sign-in.
- Sign-out.
- Password recovery by email.
- Firebase authentication-state observation.
- Account deletion with an explicit confirmation.
- Worker-side Firebase ID-token verification for `GET /api/v1/account`.

It does **not** implement synchronization, Google sign-in, email
verification, or any database. Signing in never uploads or changes local game
data.

## Frontend setup

1. Create a Firebase project and register a Web app in the Firebase console.
2. Enable **Authentication → Sign-in method → Email/Password**.
3. Add the app's hostnames under **Authentication → Settings → Authorized
   domains** (for example `localhost` for development and the production
   Pages hostname).
4. Copy the public web-app config into `.env.local`:

```dotenv
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_APP_ID=1:1234567890:web:abc123
```

All four values are required. If only some are present, sign-in is disabled
with a configuration warning and local mode remains usable. These values are
public by design and are embedded in the browser bundle. Never add a Firebase
Admin credential, service-account key, or other secret to a `VITE_` variable.

The Firebase SDK is loaded lazily and only when sign-in is configured. Local
mode does not initialize Firebase.

## Worker setup

The Worker's optional account endpoint is protected by a Firebase ID token.
No secret or Admin SDK is required.

Set these non-secret Worker vars per environment:

| Variable | Purpose |
| --- | --- |
| `FIREBASE_PROJECT_ID` | Must equal the frontend project ID; checks token issuer and audience. |
| `ALLOWED_ORIGINS` | Comma-separated exact frontend origins allowed to call the Worker. |

Leave `FIREBASE_PROJECT_ID` empty to disable the account endpoint with a
`503 auth_not_configured` response. Empty `ALLOWED_ORIGINS` permits only
non-browser callers (requests without an `Origin` header); configure the
frontend origin explicitly for browser use. Wildcards are not supported.

Local development uses `worker/.dev.vars` (copy from
`worker/.dev.vars.example`). Production values are set in `wrangler.jsonc` or
the Cloudflare dashboard. Do not commit `.dev.vars`.

## Token verification

`GET /api/v1/account` requires `Authorization: Bearer <Firebase ID token>` and
returns only:

```json
{ "uid": "...", "email": "...", "emailVerified": true }
```

The Worker verifies:

- RS256 signature against Firebase's published signing certificates.
- Issuer `https://securetoken.google.com/<project>`.
- Audience equal to the configured project ID.
- Non-empty subject (`sub`) and present `auth_time`.
- Expiry and not-before times, with a small clock tolerance.

Signing certificates are fetched from Firebase's public x509 endpoint and
cached according to the response `Cache-Control` lifetime. An unknown key ID
causes at most one forced refresh per minute, so key rotation works without
allowing arbitrary refresh traffic. The endpoint never trusts a client-supplied
UID and returns no internal error detail.

CORS is limited to exact configured origins, with a preflight response that
allows only `GET` and the `Authorization` header. Responses are marked
`Cache-Control: no-store`.

## Content Security Policy

`public/_headers` allows browser connections to the public Firebase
Authentication endpoints already. If a deployment calls the Worker on a
different origin than the Pages site, add that exact origin to `connect-src`
in `public/_headers`, or serve the Worker under a same-origin path.

## Local data behavior

Authentication state is observed from the Firebase SDK, never inferred from a
local boolean. Sign-out and account deletion call only Firebase APIs; they do
not touch IndexedDB, `localStorage`, exports, or game records. Local data is
still available if Firebase is unreachable, misconfigured, or disabled.

## Cost and limitations

Email/password Firebase Authentication is usable on the Firebase Spark plan
without enabling billing, but provider terms can change. Verify the current
Firebase pricing and quotas before production. This repository enables no
billing and deploys nothing automatically.

Known limitations:

- Account deletion may require a recent sign-in; reauthenticate and retry.
- Password recovery depends on Firebase's email-delivery configuration.
- Sign-in requires network access. Local mode does not.
- There is no synchronization, cloud backup, or account data storage.
- User-deletion errors are surfaced without exposing Firebase internals.
