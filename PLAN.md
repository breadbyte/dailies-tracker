
# PLAN.md — Game Login and Reset Reminder Dashboard

## 1. Project Overview

Build a local-first, responsive Single Page Application (SPA) that helps
users manage daily logins, recurring activities, and reset schedules
across multiple games.

The application should make it easy to answer:

- Which games should I log into today?
- Which daily login rewards have I claimed?
- How long until each game's next daily reset?
- Which weekly resets or recurring refreshes are approaching?
- Which games have unfinished daily tasks?
- What should I prioritize before the next reset?
- Can I back up my configuration or move it to another device?

The application must work without registration, cloud storage, or
notification permissions.

### Core requirements

1. Cloudflare Pages hosts the frontend.
2. Cloudflare edge protection challenges suspicious website traffic.
3. The default operating mode is entirely device-local.
4. Firebase Authentication is optional.
5. Push notifications are an optional feature requiring explicit
   user consent.
6. Game reset times are sourced initially from
   Game Time Master.
7. Users can import and export local application data.
8. Countdown calculations execute locally in the browser.
9. All selected services and required features must be usable on
   their free tiers without requiring prepayment.
10. No feature may silently enable a paid service or billing plan.

### Non-goals for the initial release

- A mandatory user account.
- Mandatory cloud synchronization.
- A required backend for countdown calculations.
- Automatic synchronization of all local data to the cloud.
- Guaranteed exact-time notification delivery.
- An authoritative database of every game's possible timer.
- Game automation, account credential collection, or automated
  login into third-party games.

The application tracks and reminds users about game activities.
It does not log in to game accounts on their behalf.

---

## 2. Architecture

### 2.1 Frontend

Use:

- TypeScript
- React
- Vite
- React Router
- Firebase modular Web SDK, only where needed
- IndexedDB for structured local data
- localStorage for small preferences
- Vitest
- React Testing Library
- Playwright for end-to-end tests, if compatible with the chosen
  free development workflow

Keep the frontend independent of any mandatory backend service.

### 2.2 Hosting

Use Cloudflare Pages for:

- Static application assets.
- SPA routing and fallback.
- Application entry points.
- Bundled game-time catalog.
- Static assets and application metadata.

The application must continue working if its optional APIs are
temporarily unavailable.

### 2.3 Website protection

Use Cloudflare's edge-level protection, preferably WAF custom rules
and Managed Challenge where available and appropriate.

The goal is to protect access to the website itself, similar in
principle to Anubis, rather than putting a Turnstile widget inside
the login form.

Requirements:

- Challenge suspicious visitors before serving protected content,
  subject to Cloudflare's available configuration.
- Avoid requiring a challenge for every ordinary interaction.
- Do not place Turnstile in the login flow.
- Do not confuse an embedded Turnstile widget with whole-site
  protection.
- Verify how static assets, deep links, API endpoints, and
  Service Worker registration behave under the chosen rules.
- Configure independent abuse protection for public API endpoints.
- Do not claim that a Cloudflare challenge automatically protects
  every externally accessible service or endpoint.

Prefer Cloudflare's native edge controls over implementing a custom
challenge system unless a specific requirement cannot be met.

Document which routes are protected, which routes are exempt, and why.

### 2.4 Optional backend

Use a separately deployable Cloudflare Worker for optional features
that require server-side execution:

- Push subscription registration and revocation.
- Server-side reminder scheduling.
- Scheduled notification delivery.
- Optional authenticated account synchronization.
- Request validation and abuse controls.

Use Cloudflare D1 only if durable server-side state is needed for
the selected features.

The backend must not be required for the default local-only mode.

### 2.5 Optional account and push architecture

The optional cloud path is:

1. User explicitly enables account or push functionality.
2. Firebase Authentication establishes account identity if requested.
3. The browser registers a notification subscription with the Worker.
4. The Worker stores the minimum required delivery information.
5. A scheduled Worker invocation identifies due reminders.
6. The Worker sends notifications through Firebase Cloud Messaging
   or another approved free-tier push implementation.
7. Delivery results and retry state are recorded.

A device-only user must be able to enable push without being forced
to create a Firebase Authentication account, provided the selected
implementation supports secure device-scoped subscriptions.

---

## 3. Operating Modes

### 3.1 Default: Device-only mode

This is the initial and default mode for every user.

Requirements:

- No registration or login required.
- No notification permission requested.
- No cloud database required.
- No background server scheduling required.
- No account identifier required.
- No network access required for ordinary dashboard use after
  the application and catalog have loaded.
- Game schedules, login history, and preferences remain on-device.
- All countdown calculations execute in the browser.
- Data can be exported and imported manually.

The application must never make account creation appear mandatory
for features that work locally.

### 3.2 Optional: Account mode

Users may choose Firebase Authentication to establish an identity.

Possible providers:

- Email and password.
- Google sign-in, if enabled and supported by the project.

Requirements:

- Account mode is explicitly opt-in.
- Local data remains available after sign-in.
- Signing out does not delete local data.
- Signing in does not automatically overwrite local data.
- Account identity is not used as proof of ownership without
  server-side verification.
- Account synchronization is a separate feature and must be
  explicitly enabled and designed.

Firebase Authentication alone does not synchronize the application
database between devices.

### 3.3 Optional: Push notification mode

Users can separately enable push notifications.

Requirements:

- Explain the purpose of notifications before requesting permission.
- Request permission only following an explicit user action.
- Register a Service Worker over HTTPS.
- Register a push token or subscription with the Worker.
- Persist necessary schedules server-side when notifications must
  arrive while the application is closed.
- Provide controls to pause, edit, and revoke subscriptions.
- Continue supporting local-only use if push registration fails.

Account mode and push mode are separate choices. Neither should
automatically enable the other.

---

## 4. Technology and Repository Structure

Use npm unless the existing repository establishes a different
package-manager convention.

Suggested structure:

/
  PLAN.md
  AGENTS.md
  README.md
  package.json
  package-lock.json
  tsconfig.json
  vite.config.ts
  vitest.config.ts
  playwright.config.ts
  .env.example
  .gitignore

  public/
    icons/
    manifest.webmanifest

  scripts/
    sync-game-catalog.ts
    validate-game-catalog.ts

  src/
    main.tsx

    app/
      App.tsx
      router.tsx

    components/
      layout/
      ui/
      forms/
      countdown/
      game-card/

    features/
      dashboard/
      games/
      login-tracking/
      schedules/
      reminders/
      settings/
      data-management/
      authentication/

    domain/
      games/
      schedules/
      reminders/
      login-history/

    services/
      catalog/
      clock/
      storage/
      import-export/
      notifications/
      firebase/
      api/

    workers/
      service-worker.ts

    styles/

    types/

    test/

  data/
    game-catalog.json
    game-catalog-metadata.json

  worker/
    src/
      index.ts
      routes/
      middleware/
      services/
      scheduler/
      schemas/
      lib/

    migrations/
    wrangler.toml
    package.json
    tsconfig.json

  tests/
    unit/
    integration/
    e2e/
    fixtures/

Adjust the structure when implementation reveals a concrete need.
Avoid creating empty abstractions or unnecessary packages.

The frontend and Worker must be typechecked and tested independently
where their runtime environments differ.

---

## 5. Local Data Architecture

### 5.1 Storage selection

Use IndexedDB for structured application state.

Use localStorage for small, non-sensitive preferences, such as:

- Theme.
- Display options.
- Dashboard layout.
- Selected display format.

Do not use localStorage as a general-purpose database.

All storage access must pass through a typed application storage layer.

### 5.2 Suggested entities

#### Application preferences

- Theme.
- Display format.
- Preferred locale.
- Default display time zone.
- Dashboard sorting.
- Collapsed or expanded sections.

#### Game selections

- Stable game ID.
- Selected server or region.
- Enabled or disabled status.
- Custom display name, if configured.
- User-specific overrides.
- Notes.

#### Schedule definitions

- Stable schedule ID.
- Game ID.
- Server or region ID.
- Schedule type.
- Time zone or fixed UTC offset.
- Reset time or interval.
- Recurrence definition.
- Enabled status.
- Source catalog revision.
- User override information.

#### Login history

- Game ID.
- Server or region ID.
- Completion date or event timestamp.
- Optional task identifier.
- Optional completion notes.

#### Reminder preferences

- Schedule ID.
- Enabled status.
- Reminder offsets.
- Notification display preferences.

Do not persist continuously updated countdown values. Derive countdowns
from the current time and the next scheduled event.

### 5.3 Data integrity

- Assign stable IDs to user-created records.
- Validate records at the storage boundary.
- Version the local schema.
- Implement explicit migrations.
- Recover safely from malformed or outdated records.
- Avoid silently discarding user data.
- Handle quota errors and unavailable browser storage.
- Use IndexedDB transactions for multi-record changes.
- Provide a recoverable path for destructive operations.

### 5.4 Offline behavior

The core application must not depend on a live API request for:

- Rendering the dashboard.
- Reading saved game selections.
- Calculating countdowns.
- Tracking daily login completion.
- Editing custom schedules.
- Importing or exporting local data.

The initial catalog must be bundled with the application.

If an optional cloud request fails, the local dashboard should remain
usable and display a clear explanation of unavailable features.

---

## 6. Game Time Master Integration

### 6.1 Source

Use the following repository as the initial source of game reset data:

https://github.com/cicerakes/Game-Time-Master

Initial upstream data source:

https://raw.githubusercontent.com/cicerakes/Game-Time-Master/master/game-data.js

Verify the current repository structure, branch, file path, schema,
and license before implementing the ingestion script.

Do not assume the URL or data structure will remain unchanged.

### 6.2 Source integration strategy

Treat Game Time Master as a reference catalog, not as a live runtime
dependency.

The application must not fetch upstream game data whenever a user
opens the dashboard.

Instead:

1. Retrieve the upstream source during a developer-run or CI catalog
   synchronization operation.
2. Record the exact upstream commit SHA and retrieval timestamp.
3. Parse the source using a controlled extraction mechanism.
4. Do not execute arbitrary downloaded JavaScript.
5. Normalize records into the application's internal schema.
6. Validate the complete output.
7. Generate deterministic JSON catalog artifacts.
8. Run schedule calculation tests.
9. Review material catalog changes.
10. Commit the validated catalog with appropriate attribution.

A network failure or invalid source file must never replace the
last known-good catalog.

### 6.3 Catalog fields

Support the fields present in the upstream data where relevant,
including:

- Game name.
- Server or region name.
- Time zone.
- Daily reset time.
- UTC-based daily reset indicator, if supplied.
- Optional menu or language metadata.
- Icon identifier, if useful and appropriately licensed.

Inspect the real upstream schema before finalizing TypeScript types.
Do not invent upstream fields or assume every game has every field.

### 6.4 Internal catalog model

Normalize the data into a stable, application-owned schema.

Conceptual example:

    interface GameCatalogEntry {
      id: string;
      name: string;
      servers: GameServerDefinition[];
      source: {
        repository: string;
        commit: string;
      };
    }

    interface GameServerDefinition {
      id: string;
      name: string;
      timeZone?: string;
      utcOffsetMinutes?: number;
      dailyReset?: DailyResetDefinition;
    }

    interface DailyResetDefinition {
      localTime?: string;
      utcTime?: string;
      useUtc: boolean;
    }

These interfaces are illustrative. Refine them after inspecting
the upstream source and documenting the normalized schedule model.

### 6.5 Identity and updates

- Use stable internal IDs rather than display names as primary keys.
- Keep game and server identities separate.
- Preserve user selections when the catalog changes.
- Detect removed, renamed, or materially modified entries.
- Warn when upstream changes conflict with user overrides.
- Never silently replace a custom schedule with upstream defaults.
- Let users restore upstream defaults explicitly.
- Support custom games absent from the upstream catalog.
- Keep source revision and attribution traceable.

### 6.6 License and attribution

Inspect the upstream repository's current license and the license
of any assets being reused.

Preserve required notices and attribution. Document modifications
and satisfy applicable source-distribution and license obligations.

Do not assume that transforming JavaScript into JSON removes
applicable license requirements.

Avoid bundling upstream icons or other assets unless their licenses
permit the intended use.

### 6.7 Acceptance criteria

- The application ships with a validated catalog.
- Catalog ingestion is reproducible.
- Catalog updates require no live dependency during normal use.
- Invalid upstream data cannot replace a valid catalog.
- User overrides survive catalog updates.
- Time zone and UTC reset semantics are preserved.
- The exact upstream revision can be identified.
- License documentation is included.

---

## 7. Game Schedule and Time Calculation Engine

### 7.1 Design principles

Implement the schedule engine as a pure TypeScript domain module
independent of React, browser storage, and notification delivery.

Inputs should include:

- Schedule definition.
- Reference timestamp.
- Applicable time zone or UTC rule.

Outputs should include:

- Next occurrence timestamp.
- Previous occurrence, where needed.
- Remaining duration.
- Schedule metadata.
- Validation or calculation errors.

The engine must be deterministic for the same inputs.

### 7.2 Schedule types

Support these types:

1. Daily reset.
2. Weekly reset.
3. Fixed interval refresh.
4. Custom recurring event.
5. One-off event.
6. User-defined schedule.

Do not assume every game has a reset at midnight.

Represent daily resets, weekly resets, energy refreshes, event deadlines,
and other recurring activities as separate schedules when necessary.

### 7.3 Time zone handling

Use a maintained time zone implementation or platform facilities
with explicit, tested IANA time zone handling.

Requirements:

- Support IANA time zone identifiers.
- Support fixed UTC offsets when required by source data.
- Distinguish wall-clock schedules from absolute UTC schedules.
- Handle daylight-saving transitions where applicable.
- Handle midnight and week boundaries correctly.
- Avoid manually calculating daylight-saving rules.
- Avoid applying a UTC offset twice.
- Recalculate upcoming occurrences after relevant schedule changes.

A schedule using a fixed UTC time must not silently become a local
wall-clock schedule.

### 7.4 Countdown rendering

- Store timestamps, not decrementing counters.
- Derive remaining duration from the current timestamp.
- Update visible countdown text on a reasonable interval.
- Recalculate immediately when the tab becomes visible again.
- Recalculate after system sleep or resume.
- Recalculate after a time zone or schedule change.
- Avoid accumulating timer drift.
- Avoid making an API request for each countdown update.

Use a shared clock abstraction to make calculations testable.

### 7.5 Test cases

Test:

- Daily reset before and after the reset boundary.
- Weekly reset at the week boundary.
- UTC resets.
- Local wall-clock resets.
- Fixed interval refresh.
- Daylight-saving spring-forward and fall-back transitions.
- Leap days.
- Midnight transitions.
- Invalid time zones.
- Invalid schedule definitions.
- Large clock jumps and suspended tabs.
- User overrides of catalog schedules.

---

## 8. Dashboard and User Experience

### 8.1 Main dashboard

Display:

- Selected games.
- Current server or region.
- Time remaining until the next reset.
- Daily login completion state.
- Upcoming weekly resets.
- Other configured recurring events.
- Outstanding daily activities.
- Optional reminder status.

### 8.2 Game management

Users should be able to:

- Search the bundled catalog.
- Select games and server regions.
- Enable or disable games.
- Add custom games.
- Edit schedules.
- Restore catalog defaults.
- Remove games.
- Configure reminder offsets when reminders are enabled.

Removing a game must not delete unrelated data.

### 8.3 Login tracking

Provide a simple daily completion mechanism.

Requirements:

- Mark a daily login as completed.
- Undo an accidental completion.
- Track completion by game and applicable server.
- Handle reset boundaries using the schedule definition.
- Keep completion history local by default.
- Avoid claiming that the application verified an actual game login.

### 8.4 Accessibility

- Keyboard-accessible controls.
- Visible focus indicators.
- Appropriate labels and accessible names.
- Readable countdowns.
- Responsive layout for mobile and desktop.
- Reduced-motion support.
- Clear error messages.
- No reliance on color alone to indicate completion.

---

## 9. Local Data Import and Export

### 9.1 Requirements

Provide Settings > Data Management with:

- Export data.
- Import data.
- Merge imported data.
- Replace selected data.
- Validation preview.
- Import history or result summary.
- Clear-data controls with confirmation.

The feature must work offline and without Firebase Authentication.

### 9.2 Backup format

Use a versioned JSON format owned by the application.

Example:

    {
      "format": "game-reminder-backup",
      "schemaVersion": 1,
      "exportedAt": "ISO-8601 timestamp",
      "appVersion": "application version",
      "data": {
        "preferences": {},
        "selectedGames": [],
        "customGames": [],
        "gameSchedules": [],
        "loginCompletionHistory": [],
        "reminderPreferences": []
      }
    }

This is a conceptual example. Define actual TypeScript types and
runtime validation before implementing the feature.

### 9.3 Export behavior

1. User selects Export Data.
2. Read the selected local data categories.
3. Validate and serialize the records.
4. Generate a JSON Blob.
5. Download a file with a date-based filename.
6. Report success or a useful error.

Export operations must not upload user data.

Include:

- Selected games and server regions.
- Custom games and schedules.
- Preferences.
- Login completion history.
- Local reminder preferences.

Exclude:

- Passwords.
- Firebase authentication tokens.
- Service credentials.
- FCM registration tokens.
- Push subscription endpoints and encryption keys.
- Internal backend operational state.

### 9.4 Import validation

Before modifying storage:

- Validate the file size.
- Parse JSON without executing imported content.
- Validate the format identifier.
- Validate the schema version.
- Validate all record fields and IDs.
- Validate time zones and reset rules.
- Reject unsupported data versions.
- Detect duplicate and conflicting records.
- Present a preview with counts and warnings.

Never import executable JavaScript or evaluate imported values.

### 9.5 Merge behavior

- Use stable IDs for record identity.
- Do not duplicate existing game or server entries.
- Preserve existing local edits by default.
- Never silently replace a custom schedule with catalog defaults.
- Define explicit conflict resolution.
- Report added, updated, skipped, and rejected records.
- Use deterministic rules for completion-history conflicts.
- Apply changes transactionally.

### 9.6 Replace behavior

- Clearly explain what will be replaced.
- Require explicit confirmation.
- Create a recoverable local backup before destructive changes.
- Replace only the categories selected by the user.
- Do not alter Firebase Authentication state.
- Do not silently revoke push subscriptions.
- Preserve data outside the requested replacement scope.

### 9.7 Migrations and testing

- Include schemaVersion.
- Maintain migration functions for supported older versions.
- Reject unknown future versions without changing storage.
- Test import/export round trips.
- Test malformed and oversized files.
- Test merge conflicts.
- Test failed transactions.
- Test importing into a fresh browser profile.
- Test that exported files contain no credentials.

---

## 10. Notification Architecture

Notifications are optional and disabled by default.

### 10.1 Local notification mode

Provide a local notification option only when supported by the
browser and operating system.

Requirements:

- Request permission following an explicit user action.
- Register a Service Worker over HTTPS.
- Show notifications when the application is active and the relevant
  APIs are available.
- Reconcile due reminders when the application resumes.
- Explain the limitations of browser-only scheduling.

Do not claim that setTimeout, setInterval, or a Service Worker
automatically guarantees delivery while the application is closed.

### 10.2 Server-delivered push mode

Use Firebase Cloud Messaging for supported browsers, or another
compatible Web Push implementation if it better satisfies the
free-tier constraints.

Requirements:

- Register the Service Worker.
- Request notification permission.
- Obtain an FCM token or push subscription.
- Register the subscription with the Worker.
- Persist necessary schedules server-side.
- Run scheduled processing through a Cloudflare Cron Trigger.
- Send notifications through an appropriate push provider.
- Track delivery attempts and retryable failures.
- Remove invalid or expired subscriptions.
- Allow subscription revocation.

All sender credentials must remain server-side.

### 10.3 Device-only push subscriptions

A user must be able to enable push without creating a Firebase
Authentication account if the selected implementation supports it.

Requirements:

- Use a securely managed device-scoped subscription.
- Do not treat a public device ID as a secret.
- Validate and limit subscription-registration requests.
- Associate schedules with the correct subscription.
- Prevent arbitrary callers from sending messages to arbitrary devices.
- Keep subscription data separate from ordinary game configuration.

### 10.4 Durable reminder scheduling

Use D1 if the optional push implementation requires persistent state.

Persist only what is necessary:

- Push subscription or FCM registration information.
- Device-scoped ownership information.
- Reminder schedule.
- Time zone or absolute event timestamps.
- Enabled/disabled status.
- Next delivery time.
- Idempotency key.
- Last attempt and delivery state.

Use atomic claiming or equivalent concurrency control to avoid
duplicate sends when scheduled jobs overlap.

### 10.5 Scheduling accuracy

- Use the shared schedule engine's rules and absolute timestamps.
- Recalculate upcoming occurrences when schedules change.
- Avoid unnecessary per-second server polling.
- Process due reminders in bounded batches.
- Respect free-tier CPU and execution limits.
- Implement safe retry behavior.
- Accept that push delivery may be delayed.

The countdown is the source of truth; notifications are reminders.

### 10.6 Browser compatibility

- Detect unsupported notification APIs.
- Detect permission denial.
- Explain when background push is unavailable.
- Provide a fallback to the dashboard.
- Do not repeatedly prompt users who have declined permission.
- Document platform-specific installation or browser requirements.

### 10.7 Export/import interaction

Do not export active push credentials or subscription endpoints.

Imported reminder preferences may be restored, but push delivery must
remain disabled until the user explicitly enables it on that device.

A backup restored to a new device must not assume that the old device's
push subscription is transferable.

---

## 11. Firebase Authentication and Optional Synchronization

### 11.1 Authentication

Use the Firebase modular Web SDK.

Support:

- Email/password registration.
- Sign-in.
- Sign-out.
- Password recovery.
- Optional Google sign-in.
- Authentication-state observation.
- Account deletion flow where supported and appropriate.

Firebase Authentication is not required for the default application.

### 11.2 Security

- Never store passwords in application storage.
- Never treat a local boolean as proof of authentication.
- Do not accept client-supplied UIDs as proof of resource ownership.
- Verify Firebase ID tokens server-side on protected Worker endpoints.
- Check signatures, issuer, audience, subject, and expiration.
- Use a maintained verification implementation compatible with
  the Cloudflare Workers runtime.
- Do not assume the Firebase Admin SDK runs unchanged in Workers.
- Apply authorization checks to each protected operation.

A successful login does not automatically grant access to every
server-side resource.

### 11.3 Synchronization

Account synchronization is optional and should be implemented only
after local storage, export/import, and core schedules are stable.

Requirements:

- Keep local data usable without network access.
- Provide explicit enablement.
- Define merge and conflict-resolution rules.
- Never silently replace local data.
- Distinguish account-level game configuration from device-specific
  preferences and push subscriptions.
- Allow users to export their data independently of synchronization.
- Document server-side data retention and deletion.

Do not require a cloud database for Firebase login alone.

---

## 12. API Design

Implement the API only for optional server-side features.

Use a versioned prefix such as /api/v1.

### 12.1 Device and reminder endpoints

Potential endpoints:

- POST /api/v1/devices/register
- POST /api/v1/devices/unregister
- GET /api/v1/devices/status
- PUT /api/v1/devices/reminders
- DELETE /api/v1/devices/reminders/:id

These are conceptual contracts; refine them according to the chosen
push provider and ownership model.

### 12.2 Account endpoints

If synchronization is implemented:

- GET /api/v1/account
- GET /api/v1/account/games
- PUT /api/v1/account/games
- GET /api/v1/account/reminders
- PUT /api/v1/account/reminders

All account-specific endpoints require verified authentication
and server-side authorization.

### 12.3 Request validation

- Validate request methods.
- Validate content types.
- Enforce body-size limits.
- Validate all external inputs.
- Apply appropriate CORS rules.
- Return consistent JSON errors.
- Avoid leaking stack traces or secrets.
- Avoid caching sensitive responses in shared caches.
- Apply rate limits to abuse-prone public endpoints.

Do not expose an unauthenticated endpoint that sends arbitrary
notification messages to arbitrary recipients.

### 12.4 Public diagnostics

An optional health endpoint may report service availability.

Do not expose secret values, internal credentials, detailed
infrastructure information, or unnecessary operational metadata.

---

## 13. Free-Tier and No-Prepayment Constraints

This is a mandatory project requirement.

### 13.1 General rules

- No mandatory paid subscription.
- No mandatory billing account.
- No required prepayment.
- No dependence on trial credits or promotional credits.
- No automatic upgrade to a paid plan.
- No paid dependency required for the default operating mode.
- No paid dependency required for the optional mode unless the
  architecture is explicitly reconsidered and approved.
- No silent billing activation.
- No reliance on unlimited free usage.

Provider pricing and free-tier terms can change. Verify current
official documentation before implementation and deployment.

### 13.2 Intended service usage

Cloudflare Pages:
- Static frontend hosting.

Cloudflare Workers:
- Optional API and scheduled reminder processing.

Cloudflare D1:
- Optional durable subscription and reminder storage.

Firebase Authentication:
- Optional user identity using supported no-cost features.

Firebase Cloud Messaging:
- Optional push delivery using supported no-cost features.

Game Time Master:
- Upstream reference data retrieved during catalog synchronization,
  not a mandatory runtime service.

### 13.3 Quota exhaustion

The application must remain usable if optional service quotas are
exhausted.

Examples:

- If Worker requests are exhausted, local features continue working.
- If scheduled processing cannot run, pending server reminders may
  be delayed or missed; report the limitation where detectable.
- If push delivery fails, preserve schedules and provide a retry path.
- If remote account synchronization fails, do not corrupt local data.
- If upstream catalog retrieval fails, keep the bundled catalog.

Do not implement aggressive retries that amplify quota consumption.

### 13.4 Deployment safety

Before deploying:

1. Verify each service's current free-tier terms.
2. Confirm whether a payment method is required.
3. Confirm no billing account is mandatory for the chosen configuration.
4. Verify current quotas and runtime limitations.
5. Confirm no paid services are enabled by default.
6. Document how to disable optional cloud features.
7. Require explicit approval for any change that introduces billing.

Do not create or enable a paid plan to work around a free-tier limit.

---

## 14. Environment Configuration and Secrets

Frontend configuration may include public values such as:

- VITE_FIREBASE_API_KEY
- VITE_FIREBASE_AUTH_DOMAIN
- VITE_FIREBASE_PROJECT_ID
- VITE_FIREBASE_APP_ID
- VITE_API_BASE_URL

Only include Firebase configuration values intended for public clients.

Worker configuration may include:

- FIREBASE_PROJECT_ID
- ALLOWED_ORIGINS
- Environment-specific operational settings.

Potential secret bindings, only if the selected implementation
requires them:

- FCM sender credentials or an appropriate signing credential.
- Web Push private key.
- Other required server-side signing secrets.

Do not introduce a Turnstile secret unless the final edge-protection
design actually requires server-side Siteverify for a separate use case.

Never expose secrets through VITE_ variables or bundle them into
the frontend.

Document the distinction between build-time frontend variables
and runtime Worker bindings.

Keep development, preview, and production configuration separate.

Do not commit actual credentials to the repository.

---

## 15. Testing Strategy

### 15.1 Unit tests

Cover:

- Schedule parsing and validation.
- Daily and weekly reset calculations.
- UTC and local-time behavior.
- Daylight-saving transitions.
- Fixed interval refreshes.
- Countdown formatting.
- Storage serialization and migrations.
- Import/export round trips.
- Merge and replace behavior.
- Catalog normalization and validation.
- User overrides and catalog updates.
- Notification scheduling calculations.

### 15.2 Integration tests

Cover:

- IndexedDB transactions.
- Recovery from corrupted local records.
- Failed imports leaving existing data intact.
- Worker request validation.
- Firebase token verification.
- Authorization checks.
- Subscription registration and revocation.
- Scheduled reminder idempotency.
- Retry handling.
- Invalid push subscriptions.
- Rate-limit behavior.

Use mocks or test doubles for external services where practical.

### 15.3 End-to-end tests

Cover:

- First launch without an account.
- Selecting games and server regions.
- Tracking daily logins.
- Editing a custom reset schedule.
- Importing and exporting a backup.
- Restoring a backup into a fresh browser profile.
- Signing in without losing local data.
- Enabling and disabling push notifications.
- Application use when APIs are unavailable.
- Responsive layouts and keyboard accessibility.

### 15.4 Security and resilience

Verify:

- No credentials are present in exported files.
- Invalid JSON cannot execute code.
- Malformed catalog data cannot replace valid data.
- Authentication is not inferred from browser storage.
- Protected endpoints reject invalid tokens.
- Subscription endpoints cannot be used to send arbitrary messages.
- CORS and request limits behave as configured.
- Optional cloud failures do not break the local dashboard.

### 15.5 CI

Run:

- Lint.
- Typecheck.
- Unit tests.
- Integration tests where configured.
- Production frontend build.
- Worker build or validation.
- Catalog validation.
- Additional end-to-end tests when the environment supports them.

Never report an unexecuted test as passing.

---

## 16. Implementation Phases

### Phase 1: Repository inspection and scaffolding

- Inspect existing files and tooling.
- Identify the package manager and project conventions.
- Create or update PLAN.md and AGENTS.md.
- Scaffold the frontend if needed.
- Configure TypeScript, linting, testing, and build scripts.
- Establish separate frontend and Worker development commands.
- Document prerequisites and environment configuration.

Acceptance criteria:
- A clean dependency installation succeeds.
- Frontend typechecking succeeds.
- Worker typechecking succeeds if a Worker is scaffolded.
- The frontend builds.
- Automated tests run.
- No secrets are committed.

### Phase 2: Game Time Master ingestion

- Inspect the upstream repository and its license.
- Confirm the actual data schema and supported reset semantics.
- Implement the catalog extraction and normalization script.
- Generate the bundled JSON catalog.
- Record the source revision and attribution.
- Add catalog validation tests.
- Preserve the last known-good catalog on failures.

Acceptance criteria:
- Catalog generation is reproducible.
- Catalog records validate against the internal schema.
- The application can load the catalog without network access.
- Upstream errors cannot destroy valid local artifacts.

### Phase 3: Local-first storage

- Implement typed IndexedDB storage.
- Implement localStorage preferences.
- Define stable IDs and schema migrations.
- Implement game selection and custom game records.
- Add local login completion tracking.
- Add storage recovery and error handling.

Acceptance criteria:
- The application works without Firebase.
- Game data survives reloads.
- Storage failures do not crash the entire application.
- Local data is validated at storage boundaries.

### Phase 4: Schedule engine

- Implement the pure schedule domain model.
- Add daily, weekly, interval, and custom recurrence types.
- Implement time zone-aware calculations.
- Handle UTC-based resets and daylight-saving exceptions.
- Add deterministic unit tests.
- Integrate live countdowns into the dashboard.

Acceptance criteria:
- The dashboard calculates resets without API calls.
- Countdown values recover correctly after sleep or tab suspension.
- Schedule tests cover boundaries and time zone transitions.
- Custom schedules override defaults without destroying catalog data.

### Phase 5: Dashboard and login tracking

- Implement the dashboard.
- Add game and region selection.
- Add login completion controls.
- Add upcoming-reset and recurring-event views.
- Add custom schedule editing.
- Add responsive layouts and accessibility improvements.

Acceptance criteria:
- Core features work offline.
- The app does not require registration.
- Daily login completion is persisted locally.
- Countdown and reset displays use the shared schedule engine.

### Phase 6: Local import and export

- Implement the versioned JSON format.
- Implement export downloads.
- Implement file parsing and validation.
- Add import preview.
- Implement merge and replace workflows.
- Implement transactional updates and recovery.
- Add historical migration fixtures.

Acceptance criteria:
- Import and export work without an account.
- Backups restore to a fresh browser profile.
- Invalid imports never partially overwrite local data.
- Merge and replace behavior is documented and tested.
- No authentication or push credentials are exported.

### Phase 7: Website edge protection

- Configure Cloudflare edge protection.
- Apply challenge rules to appropriate website traffic.
- Verify static asset and SPA routing behavior.
- Verify Worker endpoints and Service Worker registration.
- Document exemptions and API-specific protections.
- Avoid login-specific Turnstile challenges.

Acceptance criteria:
- The configured edge challenge behaves as intended.
- Normal users can access the application.
- Deep links and required assets function.
- Local application features do not depend on the challenge service
  being called during every interaction.

### Phase 8: Optional Firebase Authentication

- Configure Firebase Authentication.
- Implement registration, sign-in, sign-out, and recovery.
- Add authentication-state handling.
- Preserve local data during authentication changes.
- Add Worker ID-token verification if protected APIs are introduced.
- Keep account synchronization out of scope until explicitly designed.

Acceptance criteria:
- Login is optional.
- Signing out does not delete local data.
- Local mode remains functional when Firebase is unavailable.
- Protected endpoints verify tokens independently.

### Phase 9: Optional push notifications

- Choose FCM or a compatible Web Push implementation after verifying
  free-tier requirements and browser support.
- Implement permission and subscription management.
- Implement Worker endpoints.
- Add D1 migrations if required.
- Add Cron Trigger scheduling.
- Implement due-job claiming, retries, and idempotency.
- Add subscription cleanup and revocation.
- Test without Firebase Authentication if device-only push is supported.

Acceptance criteria:
- Push is disabled by default.
- Users explicitly opt in.
- Server-delivered reminders can arrive while the app is closed,
  subject to browser, OS, network, and provider limitations.
- Schedules remain durable across Worker invocations.
- Duplicate scheduled invocations do not cause uncontrolled duplicate
  notifications.
- All required services remain within verified no-cost limits.

### Phase 10: Optional account synchronization

Implement only after local storage, import/export, and the core
schedule engine are stable.

- Define synchronized data types.
- Define conflict resolution and migration behavior.
- Keep device-specific preferences separate.
- Keep push subscriptions separate.
- Add authenticated API endpoints only where necessary.
- Provide explicit synchronization controls.

Acceptance criteria:
- Synchronization never silently overwrites local data.
- Local mode works without the backend.
- Users can still export their data independently.
- Account ownership is enforced server-side.

### Phase 11: Deployment and documentation

- Configure Cloudflare Pages.
- Configure optional Worker deployment.
- Configure Firebase only for enabled features.
- Configure environment-specific settings.
- Add CI checks.
- Document local development and production deployment.
- Document current free-tier quotas and setup limitations.
- Document backups, data recovery, and notification behavior.
- Verify billing constraints before deployment.

Acceptance criteria:
- A clean checkout can be installed and run from the README.
- Production frontend assets build reproducibly.
- Optional backend deployment is documented.
- No paid service is silently enabled.
- Production deployment requires explicit approval.

---

## 17. OpenCode Execution Rules

### Before implementation

1. Read this plan and inspect the existing repository.
2. Identify existing architecture and preserve useful work.
3. Verify current provider documentation for uncertain APIs.
4. Identify dependencies that would require payment or a billing account.
5. Resolve significant architecture conflicts before implementing.
6. Create a prioritized checklist for the next phase.

### During implementation

1. Work incrementally, one phase at a time.
2. Keep changes scoped to the current phase.
3. Run relevant tests and typechecks after each phase.
4. Report failures honestly.
5. Do not invent credentials, project IDs, or successful deployment results.
6. Do not overwrite existing user work without inspection.
7. Update documentation when interfaces or workflows change.
8. Mark acceptance criteria complete only after verification.
9. Keep local-only features independent of optional cloud services.
10. Preserve existing local data during migrations and imports.

### Cost and deployment safeguards

- Never enable billing or a paid plan without explicit approval.
- Never deploy to production without explicit approval.
- Never introduce a paid dependency without explaining the alternative.
- Recheck free-tier terms before adding cloud services.
- If a free-tier requirement cannot be satisfied, stop and explain
  the limitation before implementing the affected feature.

### External data safeguards

- Treat upstream game data as untrusted input.
- Do not execute downloaded JavaScript.
- Validate generated catalog artifacts.
- Keep upstream source revisions traceable.
- Preserve applicable license notices.
- Do not let catalog updates silently modify user-owned schedules.

### Reporting

At the end of each phase, report:

- Changes made.
- Files added or modified.
- Commands executed.
- Tests and checks passed.
- Tests not run and why.
- Known limitations.
- Remaining acceptance criteria.
- Any external setup still required.

---

## 18. Definition of Done

The initial release is complete when:

- The SPA is hosted on Cloudflare Pages.
- Website access is protected by the configured edge challenge.
- The default application works without registration.
- Game Time Master data is bundled and validated.
- The dashboard calculates daily and other configured reset times locally.
- Users can select games, track daily logins, and configure schedules.
- Local data persists between sessions.
- Users can export and import their data offline.
- Import conflicts are handled safely.
- Custom schedules survive catalog updates.
- No notification permission is requested by default.
- Optional Firebase Authentication does not interfere with local data.
- Optional push reminders use durable server-side scheduling.
- Notification delivery limitations are documented.
- Required services are verified to work without prepayment.
- Optional cloud failures do not break local functionality.
- Automated checks pass.
- Setup, backup, deployment, and troubleshooting documentation exists.
- No production deployment or paid billing configuration occurs
  without explicit approval.

The local-first release must remain useful even if Firebase, the Worker,
D1, push delivery, or the upstream GitHub repository is unavailable.
