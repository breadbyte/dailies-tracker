import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { ArtworkSource } from '../../domain/artwork/types.ts';
import { getScheduleOccurrence } from '../../domain/schedule/compute.ts';
import { formatRemaining } from '../../domain/schedule/format.ts';
import type {
  Schedule,
  ScheduleOccurrence,
} from '../../domain/schedule/types.ts';
import { resolveServerSchedule } from '../../domain/schedule/resolve.ts';
import { isCompletionInCurrentCycle } from '../../domain/tracking/login.ts';
import type { LoginCompletion } from '../../domain/storage/types.ts';
import {
  deleteLoginCompletion,
  getLatestLoginCompletion,
  listAllLoginCompletions,
  listCustomGames,
  listGameSelections,
  listScheduleOverrides,
  loadPreferences,
  recordLoginCompletion,
} from '../../services/storage/index.ts';
import { GameArtwork } from '../artwork/GameArtwork.tsx';
import { createGameIndex } from '../games/gameIndex.ts';
import {
  formatOccurrence,
  scheduleSummary,
} from '../schedules/scheduleText.ts';
import { CalendarHeatmap } from './CalendarHeatmap.tsx';
import { useNow } from './useNow.ts';

interface DashboardEntry {
  id: string;
  gameId: string;
  serverId: string;
  displayName: string;
  artworkName: string;
  serverName: string;
  schedule: Schedule;
  latestCompletion?: LoginCompletion;
}

type LoadState =
  | { status: 'loading' }
  | {
      status: 'ready';
      entries: DashboardEntry[];
      completions: LoginCompletion[];
      artworkSource: ArtworkSource;
    }
  | { status: 'error'; message: string };

interface RenderedEntry {
  entry: DashboardEntry;
  occurrence: ScheduleOccurrence;
  loginRecorded: boolean;
}

function isRecurringEvent(schedule: Schedule): boolean {
  return (
    schedule.kind === 'weekly' ||
    schedule.kind === 'custom' ||
    schedule.kind === 'interval'
  );
}

interface DashboardData {
  entries: DashboardEntry[];
  completions: LoginCompletion[];
  artworkSource: ArtworkSource;
}

async function loadDashboardData(): Promise<DashboardData> {
  const [selections, customGames, overrides, completions, preferences] =
    await Promise.all([
      listGameSelections(),
      listCustomGames(),
      listScheduleOverrides(),
      listAllLoginCompletions(),
      Promise.resolve(loadPreferences()),
    ]);
  const index = createGameIndex(customGames);
  const overrideIds = new Map(
    overrides.map((override) => [override.id, override.schedule]),
  );

  const entries: DashboardEntry[] = [];
  for (const selection of selections) {
    if (!selection.enabled) continue;
    const game = index.get(selection.gameId);
    const server = game?.servers.get(selection.serverId);
    if (game === undefined || server === undefined) continue;

    const resolved = resolveServerSchedule(
      server,
      overrideIds.get(selection.id),
    );
    entries.push({
      id: selection.id,
      gameId: selection.gameId,
      serverId: selection.serverId,
      displayName: selection.customDisplayName ?? game.name,
      artworkName: game.name,
      serverName: server.name,
      schedule: resolved.schedule,
    });
  }

  return {
    entries: await Promise.all(
      entries.map(async (entry) => {
        const latestCompletion = await getLatestLoginCompletion(
          entry.gameId,
          entry.serverId,
        );
        return latestCompletion === undefined
          ? entry
          : { ...entry, latestCompletion };
      }),
    ),
    completions,
    artworkSource: preferences.preferences.artworkSource,
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function DashboardPage() {
  const now = useNow();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const data = await loadDashboardData();
        if (active) setState({ status: 'ready', ...data });
      } catch (error) {
        if (!active) return;
        setState({
          status: 'error',
          message: errorMessage(
            error,
            'Local game data could not be read.',
          ),
        });
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, []);

  const rendered: RenderedEntry[] =
    state.status === 'ready'
      ? state.entries
          .map((entry) => {
            const occurrence = getScheduleOccurrence(entry.schedule, now);
            return {
              entry,
              occurrence,
              loginRecorded: isCompletionInCurrentCycle(
                entry.latestCompletion?.completedAt,
                occurrence,
              ),
            };
          })
          .sort((left, right) => {
            const leftRemaining =
              left.occurrence.remainingMs ?? Number.POSITIVE_INFINITY;
            const rightRemaining =
              right.occurrence.remainingMs ?? Number.POSITIVE_INFINITY;
            return (
              leftRemaining - rightRemaining ||
              left.entry.displayName.localeCompare(right.entry.displayName)
            );
          })
      : [];

  const recordedCount = rendered.filter((item) => item.loginRecorded).length;
  const artworkSource: ArtworkSource =
    state.status === 'ready' ? state.artworkSource : 'none';
  const nextReset = rendered.find(
    (item) => item.occurrence.nextAt !== null,
  );
  const recurring = rendered.filter((item) =>
    isRecurringEvent(item.entry.schedule),
  );

  async function toggleLogin({
    entry,
    loginRecorded,
  }: RenderedEntry): Promise<void> {
    setActionError(null);
    setPendingId(entry.id);
    try {
      if (loginRecorded) {
        if (entry.latestCompletion === undefined) {
          throw new Error('No saved completion was found to undo.');
        }
        await deleteLoginCompletion(entry.latestCompletion.id);
        setState((current) => {
          if (current.status !== 'ready') return current;
          return {
            ...current,
            entries: current.entries.map((item) =>
              item.id === entry.id
                ? { ...item, latestCompletion: undefined }
                : item,
            ),
            completions: current.completions.filter(
              (completion) =>
                completion.id !== entry.latestCompletion?.id,
            ),
          };
        });
      } else {
        const completion = await recordLoginCompletion({
          gameId: entry.gameId,
          serverId: entry.serverId,
          completedAt: new Date().toISOString(),
        });
        setState((current) => {
          if (current.status !== 'ready') return current;
          return {
            ...current,
            entries: current.entries.map((item) =>
              item.id === entry.id
                ? { ...item, latestCompletion: completion }
                : item,
            ),
            completions: [completion, ...current.completions],
          };
        });
      }
    } catch (error) {
      setActionError(
        errorMessage(error, 'The login completion could not be saved.'),
      );
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section aria-labelledby="dashboard-heading">
      <h1 id="dashboard-heading">Dashboard</h1>
      <p>
        Reset countdowns are calculated on this device from saved schedules.
        No network request is made and no account is required.
      </p>

      {state.status === 'loading' ? (
        <p role="status">Loading your saved games…</p>
      ) : null}

      {state.status === 'error' ? (
        <p role="alert">
          Saved games could not be loaded: {state.message}. The rest of the
          application remains usable.
        </p>
      ) : null}

      {actionError !== null ? <p role="alert">{actionError}</p> : null}

      {state.status === 'ready' && rendered.length === 0 ? (
        <p>
          No games are selected yet. <Link to="/games">Choose games and regions</Link>{' '}
          to start tracking resets.
        </p>
      ) : null}

      {state.status === 'ready' ? (
        <section aria-labelledby="login-activity-heading">
          <h2 id="login-activity-heading">Login activity</h2>
          <p className="reset-meta">
            Each square counts distinct games with a recorded login on that
            day. More games make a darker square.
          </p>
          <CalendarHeatmap
            completions={state.completions}
            now={now}
          />
        </section>
      ) : null}

      {rendered.length > 0 ? (
        <>
          <p className="dashboard-summary">
            {rendered.length} enabled{' '}
            {rendered.length === 1 ? 'game' : 'games'}; {recordedCount} login
            {recordedCount === 1 ? '' : 's'} recorded this reset cycle.
            {nextReset?.occurrence.nextAt != null
              ? ` Next reset: ${nextReset.entry.displayName} in ${formatRemaining(
                  nextReset.occurrence.remainingMs ?? 0,
                )}.`
              : ''}
          </p>

          <ul className="reset-list">
            {rendered.map(({ entry, occurrence, loginRecorded }) => {
              const pending = pendingId === entry.id;
              return (
                <li key={entry.id} className="reset-card">
                  <div className="reset-card-header">
                    <GameArtwork
                      gameId={entry.gameId}
                      gameName={entry.artworkName}
                      source={artworkSource}
                    />
                    <div>
                      <h2>{entry.displayName}</h2>
                      <p className="reset-meta">
                        {entry.serverName} · {scheduleSummary(entry.schedule)}
                      </p>
                    </div>
                  </div>
                  {occurrence.nextAt !== null ? (
                    <>
                      <p className="reset-countdown">
                        Next reset in{' '}
                        <strong>
                          {formatRemaining(occurrence.remainingMs ?? 0)}
                        </strong>
                      </p>
                      <p className="reset-next">
                        <time
                          dateTime={new Date(occurrence.nextAt).toISOString()}
                        >
                          {formatOccurrence(
                            occurrence.nextAt,
                            entry.schedule,
                          )}
                        </time>
                      </p>
                    </>
                  ) : (
                    <p className="reset-next">No upcoming reset.</p>
                  )}

                  <p className="login-state">
                    {loginRecorded
                      ? 'Login recorded for this reset cycle.'
                      : 'Login not recorded yet.'}
                  </p>
                  <button
                    type="button"
                    disabled={pending}
                    aria-label={`${loginRecorded ? 'Undo' : 'Mark'} login completion for ${entry.displayName} (${entry.serverName})`}
                    onClick={() => {
                      void toggleLogin({ entry, occurrence, loginRecorded });
                    }}
                  >
                    {loginRecorded
                      ? 'Undo login completion'
                      : 'Mark login complete'}
                  </button>
                </li>
              );
            })}
          </ul>

          <section aria-labelledby="upcoming-heading">
            <h2 id="upcoming-heading">Upcoming resets</h2>
            <ul className="upcoming-list">
              {rendered.map(({ entry, occurrence }) =>
                occurrence.nextAt !== null ? (
                  <li key={entry.id}>
                    <span>{entry.displayName}</span>{' '}
                    <time
                      dateTime={new Date(occurrence.nextAt).toISOString()}
                    >
                      {formatOccurrence(occurrence.nextAt, entry.schedule)}
                    </time>{' '}
                    <span className="reset-meta">
                      in {formatRemaining(occurrence.remainingMs ?? 0)}
                    </span>
                  </li>
                ) : null,
              )}
            </ul>
          </section>

          <section aria-labelledby="recurring-heading">
            <h2 id="recurring-heading">Recurring events</h2>
            {recurring.length === 0 ? (
              <p>
                No weekly or custom recurring events. You can change a game's
                schedule from <Link to="/games">Games</Link>.
              </p>
            ) : (
              <ul className="upcoming-list">
                {recurring.map(({ entry, occurrence }) => (
                  <li key={entry.id}>
                    <span>{entry.displayName}</span>{' '}
                    <span className="reset-meta">
                      {scheduleSummary(entry.schedule)}
                    </span>
                    {occurrence.nextAt !== null ? (
                      <>
                        {' '}
                        <time
                          dateTime={new Date(occurrence.nextAt).toISOString()}
                        >
                          {formatOccurrence(occurrence.nextAt, entry.schedule)}
                        </time>{' '}
                        <span className="reset-meta">
                          in {formatRemaining(occurrence.remainingMs ?? 0)}
                        </span>
                      </>
                    ) : (
                      <span> · no upcoming occurrence</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="reset-meta">
            Login tracking is manual. Dailies does not sign in to game accounts
            or verify that a login happened.
          </p>
        </>
      ) : null}
    </section>
  );
}
