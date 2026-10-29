# Optional SteamGridDB artwork

Game cards can show cover artwork from
[SteamGridDB](https://www.steamgriddb.com/). The integration is optional and
off by default. Device-only mode, schedules, countdowns, login history,
backups, and the calendar heatmap all work without it.

## How it works

1. The browser asks the separately deployed Worker for artwork by game name:
   `GET /api/v1/artwork?name=<game name>`.
2. The Worker calls SteamGridDB's autocomplete search and grid endpoints with
   the secret API key. It matches the exact game name when possible, otherwise
   the first search result, and returns validated HTTPS image URLs.
3. The browser caches the result in IndexedDB and reuses it across views and
   app restarts. Images load directly from SteamGridDB's CDN with
   `referrerPolicy="no-referrer"`.

The API key never enters the browser bundle, a `VITE_` variable, or a backup.
If the Worker is not configured or unreachable, cards keep a neutral initial
placeholder.

## Setup

### Local Worker

```sh
cp worker/.dev.vars.example worker/.dev.vars
# Set ALLOWED_ORIGINS=http://localhost:5173 and STEAMGRIDDB_API_KEY in the file.
pnpm --dir worker install
pnpm run worker:dev            # http://localhost:8789
```

Then point the frontend at the Worker for local development only
(`.env.development.local`, so a production build does not bake in localhost):

```sh
VITE_API_BASE_URL=http://localhost:8789
```

Port `8789` avoids the common Wrangler default `8787`, which collides with
other local gateways (for example Caveman Cloud's `caveman-proxy`). Override
with `wrangler dev --port` if needed.

`worker/.dev.vars` is git-ignored. Never prefix the key with `VITE_`.

### Production

```sh
pnpm --dir worker exec wrangler secret put STEAMGRIDDB_API_KEY
```

Then:

- Add the frontend origin to `ALLOWED_ORIGINS` in `worker/wrangler.jsonc`.
- If the Worker is on a separate origin, set `VITE_API_BASE_URL` and add that
  exact origin to `connect-src` in `public/_headers`.
- `img-src` already permits `https://cdn2.steamgriddb.com` and
  `https://cdn.steamgriddb.com` for the returned images.

## Caching and request protection

- Successful lookups: 30 days.
- Confirmed no-match: 7 days.
- Proxy/network failures: 5 minutes (short backoff cache, not a permanent
  miss).
- Per-game chosen artwork is stored in local preferences so it survives restarts
  and is included in JSON backups.
- Only games whose cards are rendered request artwork. Requests are
  deduplicated per normalized game name, serialized with a one-second minimum
  interval, and retried at most three times.
- Retries use exponential backoff with jitter. A `429` response's
  `Retry-After` is honored (capped at 30 seconds).
- The Worker also caches successful payloads for one hour as a best-effort
  cross-client cache.

There is no automatic refresh loop. If artwork changes upstream, clear the
`artworkCache` IndexedDB store or wait for the cached entry to expire.

## Variant selection

The default image is the grid with the highest SteamGridDB `score` returned for
the matched game. Ties keep the API's returned order. On the Games page, each
selected game card has an "Artwork" toggle that opens a swatch grid of the
available grids as thumbnails; picking a swatch stores the chosen grid ID for
that game. Hovering (or keyboard-focusing) a swatch enlarges it, shows a large
floating preview next to it, and temporarily applies that image to the card;
leaving restores the committed artwork. The starred swatch selects the
automatic top-rated grid and removes the override. The Dashboard shows the
chosen image without the picker.

The picker is a variant control for the selected artwork source; selecting
"None" disables all artwork requests.

## Attribution and privacy

Artwork is provided by [SteamGridDB](https://www.steamgriddb.com/); obey its
API terms and attribution requirements when enabling the integration. Image
requests go directly to SteamGridDB's CDN, so its CDN can see the visitor's IP
address and requested image. Requests use no referrer, and no game data,
schedule, login history, or account data is sent to SteamGridDB.
