import { useEffect, useMemo, useState } from 'react';
import type { ArtworkSource } from '../../domain/artwork/types.ts';
import type { GameServerDefinition } from '../../domain/catalog/types.ts';
import type {
  CustomGameRecord,
  GameSelection,
  ScheduleOverride,
} from '../../domain/storage/types.ts';
import { resolveServerSchedule } from '../../domain/schedule/resolve.ts';
import {
  createGameSelectionId,
  listCustomGames,
  listGameSelections,
  listScheduleOverrides,
  loadPreferences,
  removeGameSelection,
  selectGameServer,
  updateGameSelection,
  updatePreferences,
} from '../../services/storage/index.ts';
import { GameArtwork } from '../artwork/GameArtwork.tsx';
import { createGameIndex, type GameIndexEntry } from './gameIndex.ts';
import { ScheduleEditor } from './ScheduleEditor.tsx';

type LoadState =
  | { status: 'loading' }
  | {
      status: 'ready';
      selections: GameSelection[];
      customGames: CustomGameRecord[];
      overrides: ReadonlyMap<string, ScheduleOverride>;
    }
  | { status: 'error'; message: string };

interface BrowseGame extends GameIndexEntry {
  id: string;
}

function matchesQuery(game: BrowseGame, query: string): boolean {
  if (query === '') return true;
  const values = [
    game.name,
    game.menuName ?? '',
    ...Array.from(game.servers.values(), (server) => server.name),
  ];
  return values.some((value) => value.toLocaleLowerCase().includes(query));
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function GamesPage() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [query, setQuery] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busySelectionId, setBusySelectionId] = useState<string | null>(null);
  const [pendingServerId, setPendingServerId] = useState<string | null>(null);
  const [artworkSource, setArtworkSource] = useState<ArtworkSource>('none');

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const [selections, customGames, overrides] = await Promise.all([
          listGameSelections(),
          listCustomGames(),
          listScheduleOverrides(),
        ]);
        if (!active) return;
        setState({
          status: 'ready',
          selections,
          customGames,
          overrides: new Map(overrides.map((entry) => [entry.id, entry])),
        });
        setArtworkSource(loadPreferences().preferences.artworkSource);
      } catch (error) {
        if (!active) return;
        setState({
          status: 'error',
          message: errorMessage(
            error,
            'Saved game data could not be read.',
          ),
        });
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, []);

  const customGames = state.status === 'ready' ? state.customGames : [];
  const index = useMemo(() => createGameIndex(customGames), [customGames]);
  const games = useMemo<BrowseGame[]>(
    () =>
      Array.from(index.entries(), ([id, game]) => ({ id, ...game })),
    [index],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleGames = games.filter((game) =>
    matchesQuery(game, normalizedQuery),
  );

  const selectedIds = new Set(
    state.status === 'ready'
      ? state.selections.map((selection) => selection.id)
      : [],
  );

  async function addSelection(
    gameId: string,
    serverId: string,
  ): Promise<void> {
    setActionError(null);
    setPendingServerId(serverId);
    try {
      const selection = await selectGameServer({ gameId, serverId });
      setState((current) => {
        if (current.status !== 'ready') return current;
        if (current.selections.some((entry) => entry.id === selection.id)) {
          return current;
        }
        return {
          ...current,
          selections: [...current.selections, selection],
        };
      });
    } catch (error) {
      setActionError(
        errorMessage(error, 'The game could not be added.'),
      );
    } finally {
      setPendingServerId(null);
    }
  }

  async function setEnabled(
    selection: GameSelection,
    enabled: boolean,
  ): Promise<void> {
    setActionError(null);
    setBusySelectionId(selection.id);
    try {
      const updated = await updateGameSelection(selection.id, { enabled });
      setState((current) => {
        if (current.status !== 'ready') return current;
        return {
          ...current,
          selections: current.selections.map((entry) =>
            entry.id === updated.id ? updated : entry,
          ),
        };
      });
    } catch (error) {
      setActionError(
        errorMessage(error, 'The game setting could not be saved.'),
      );
    } finally {
      setBusySelectionId(null);
    }
  }

  async function removeSelection(selection: GameSelection): Promise<void> {
    setActionError(null);
    setBusySelectionId(selection.id);
    try {
      await removeGameSelection(selection.id);
      setState((current) => {
        if (current.status !== 'ready') return current;
        return {
          ...current,
          selections: current.selections.filter(
            (entry) => entry.id !== selection.id,
          ),
        };
      });
    } catch (error) {
      setActionError(
        errorMessage(error, 'The game could not be removed.'),
      );
    } finally {
      setBusySelectionId(null);
    }
  }

  function applyOverride(
    selectionId: string,
    override: ScheduleOverride | undefined,
  ): void {
    setState((current) => {
      if (current.status !== 'ready') return current;
      const overrides = new Map(current.overrides);
      if (override === undefined) {
        overrides.delete(selectionId);
      } else {
        overrides.set(selectionId, override);
      }
      return { ...current, overrides };
    });
  }

  function serverName(selection: GameSelection): string {
    return (
      index.get(selection.gameId)?.servers.get(selection.serverId)?.name ??
      selection.serverId
    );
  }

  function serverDefinition(
    selection: GameSelection,
  ): GameServerDefinition | undefined {
    return index.get(selection.gameId)?.servers.get(selection.serverId);
  }

  function changeArtworkSource(next: ArtworkSource): void {
    setActionError(null);
    try {
      const preferences = updatePreferences({ artworkSource: next });
      setArtworkSource(preferences.artworkSource);
    } catch (error) {
      setActionError(
        errorMessage(error, 'The artwork setting could not be saved.'),
      );
    }
  }


  return (
    <section aria-labelledby="games-heading">
      <h1 id="games-heading">Games</h1>
      <p>
        Choose the games and regions you play. Schedules stay on this device and
        work without an account.
      </p>

      {state.status === 'loading' ? (
        <p role="status">Loading saved games…</p>
      ) : null}

      {state.status === 'error' ? (
        <p role="alert">
          Saved games could not be loaded: {state.message}. Other parts of the
          application remain usable.
        </p>
      ) : null}

      {actionError !== null ? <p role="alert">{actionError}</p> : null}

      <section aria-labelledby="artwork-heading">
        <h2 id="artwork-heading">Artwork</h2>
        <p>
          <label>
            Artwork source{' '}
            <select
              value={artworkSource}
              onChange={(event) => {
                changeArtworkSource(event.target.value as ArtworkSource);
              }}
            >
              <option value="none">None (local placeholder)</option>
              <option value="steamgriddb">SteamGridDB</option>
            </select>
          </label>
        </p>
        <p className="reset-meta">
          SteamGridDB artwork is optional. It loads lazily through the
          configured server proxy, is cached on this device, and falls back to a
          neutral placeholder when unavailable. Artwork data from{' '}
          <a
            href="https://www.steamgriddb.com/"
            target="_blank"
            rel="noreferrer"
          >
            SteamGridDB
          </a>
          .
        </p>
      </section>

      {state.status === 'ready' ? (
        <>
          <section aria-labelledby="selected-games-heading">
            <h2 id="selected-games-heading">Your games</h2>
            {state.selections.length === 0 ? (
              <p>No games selected yet. Add one from the list below.</p>
            ) : (
              <ul className="selection-list">
                {state.selections.map((selection) => {
                  const game = index.get(selection.gameId);
                  const server = serverDefinition(selection);
                  const override = state.overrides.get(selection.id);
                  const resolved =
                    server === undefined
                      ? undefined
                      : resolveServerSchedule(server, override?.schedule);
                  const busy = busySelectionId === selection.id;

                  return (
                    <li className="selection-card" key={selection.id}>
                      <div className="selection-card-body">
                        <GameArtwork
                          gameId={selection.gameId}
                          gameName={game?.name ?? selection.gameId}
                          source={artworkSource}
                          allowChoice
                        />
                        <div className="selection-card-content">
                          <div className="selection-heading">
                            <h3>
                              {selection.customDisplayName ??
                                game?.name ??
                                selection.gameId}
                            </h3>
                            <p className="reset-meta">{serverName(selection)}</p>
                          </div>

                          <div className="selection-actions">
                            <label>
                              <input
                                type="checkbox"
                                checked={selection.enabled}
                                disabled={busy}
                                onChange={(event) => {
                                  void setEnabled(
                                    selection,
                                    event.target.checked,
                                  );
                                }}
                              />
                              Enabled
                            </label>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                void removeSelection(selection);
                              }}
                            >
                              Remove {game?.name ?? selection.gameId}
                            </button>
                          </div>

                          {resolved === undefined ? (
                            <p role="alert">
                              This saved server is no longer in the catalog.
                              Remove it or keep it for reference.
                            </p>
                          ) : (
                            <details className="schedule-details">
                              <summary>
                                Edit reset schedule for{' '}
                                {game?.name ?? selection.gameId}
                              </summary>
                              <ScheduleEditor
                                key={`${selection.id}:${override?.updatedAt ?? 'catalog'}`}
                                gameId={selection.gameId}
                                serverId={selection.serverId}
                                schedule={resolved.schedule}
                                hasOverride={override !== undefined}
                                onOverrideChanged={(next) =>
                                  applyOverride(selection.id, next)
                                }
                              />
                            </details>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="catalog-heading">
            <h2 id="catalog-heading">Add games</h2>
            <p>
              <label htmlFor="game-search">Search games or regions</label>
            </p>
            <input
              id="game-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
            />
            <p className="reset-meta" role="status">
              {visibleGames.length} of {games.length} games shown.
            </p>

            {visibleGames.length === 0 ? (
              <p>No games match this search.</p>
            ) : (
              <ul className="catalog-list">
                {visibleGames.map((game) => (
                  <li className="catalog-game" key={game.id}>
                    <h3>{game.name}</h3>
                    <ul className="server-list">
                      {Array.from(game.servers.values(), (server) => {
                        const selectionId = createGameSelectionId(
                          game.id,
                          server.id,
                        );
                        const added = selectedIds.has(selectionId);
                        return (
                          <li key={server.id}>
                            <button
                              type="button"
                              disabled={
                                added || pendingServerId === server.id
                              }
                              aria-label={`Add ${game.name} (${server.name})`}
                              onClick={() => {
                                void addSelection(game.id, server.id);
                              }}
                            >
                              {added ? `Added ${server.name}` : `Add ${server.name}`}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}
