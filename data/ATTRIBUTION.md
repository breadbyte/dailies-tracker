# Game Time Master attribution

The bundled catalog in this directory is derived from **Game Time Master**:

- Repository: <https://github.com/cicerakes/Game-Time-Master>
- Source file: [`game-data.js`](https://github.com/cicerakes/Game-Time-Master/blob/8576bda6481210f3ba24342fa242cb06fb9e6b5d/game-data.js)
- Source revision: `8576bda6481210f3ba24342fa242cb06fb9e6b5d`
- Upstream commit date: `2026-10-26T13:51:22Z`
- Upstream license: **GNU General Public License v3.0 only** (`GPL-3.0-only`).
  The repository ships the GPLv3 text and does not state an "or later" option,
  so the catalog treats it as version 3 only.
- License text: [`LICENSE-Game-Time-Master`](./LICENSE-Game-Time-Master)

## Modifications

The synchronization script in `scripts/catalog.ts` (with
`scripts/catalog-lib.ts`) reads the upstream JavaScript as **data**. It does not
evaluate or execute the downloaded file. It then:

- groups game/server records into a game → servers model;
- derives stable slug IDs from upstream names;
- normalizes unpadded reset times (for example `4:00`) to `HH:mm`;
- represents the upstream `utcDailyReset` flag as
  `dailyReset.basis: "utc"` (otherwise `"local"`);
- retains upstream icon identifiers but **does not bundle any icon assets**;
- sorts games and servers by ID so output bytes are deterministic;
- validates the normalized catalog before replacing the previous artifacts.

The exact upstream revision and a SHA-256 of the generated catalog are recorded
in `game-catalog-metadata.json`.

## License obligations

The normalized catalog (`game-catalog.json`) is a derivative of the upstream
GPL-3.0-only data and is distributed under **GPL-3.0-only**. If you redistribute
this application together with the catalog, you must comply with GPL-3.0-only
for that data, including preserving notices and providing the corresponding
source: the upstream `game-data.js` at the recorded commit plus the
normalization scripts in this repository.

The upstream game icons and other upstream assets are not included. Only icon
identifier strings are retained; no icon images are redistributed.

## Regenerating

```sh
npm run catalog:sync
npm run catalog:validate
```

`sync` contacts GitHub for the current `master` commit. To regenerate from a
pinned revision or a local file:

```sh
node --experimental-strip-types scripts/catalog.ts sync \
  --commit <40-char-sha> --source /path/to/game-data.js
node --experimental-strip-types scripts/catalog.ts sync --commit <40-char-sha>
```

If the upstream source cannot be fetched or fails validation, the existing
catalog and metadata are left unchanged.
