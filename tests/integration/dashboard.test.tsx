import 'fake-indexeddb/auto';
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../src/app/router.tsx';
import {
  closeAppDatabase,
  deleteAppDatabase,
} from '../../src/services/storage/database.ts';
import { selectGameServer } from '../../src/services/storage/selectedGames.ts';
import {
  listLoginCompletions,
  recordLoginCompletion,
} from '../../src/services/storage/loginHistory.ts';
import { setScheduleOverride } from '../../src/services/storage/scheduleOverrides.ts';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

beforeEach(async () => {
  await deleteAppDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'));
  await selectGameServer({
    gameId: 'afk-arena',
    serverId: 'afk-arena:global',
  });
});

afterEach(async () => {
  vi.useRealTimers();
  await closeAppDatabase();
});

describe('dashboard countdowns', () => {
  it('renders the selected game and recalculates after suspension', async () => {
    renderAt('/');

    expect(
      await screen.findByRole('heading', { level: 2, name: 'AFK Arena' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('12:00:00')).toBeInTheDocument();

    vi.setSystemTime(new Date('2026-01-16T05:00:00.000Z'));
    act(() => {
      window.dispatchEvent(new Event('pageshow'));
    });

    expect(await screen.findByText('19:00:00')).toBeInTheDocument();
    expect(screen.queryByText('12:00:00')).not.toBeInTheDocument();
  });

  it('renders a login heatmap with one intensity step per distinct game', async () => {
    for (const gameId of ['afk-arena', 'arknights', 'azur-lane']) {
      await recordLoginCompletion({
        gameId,
        serverId: `${gameId}:global`,
        completedAt: '2026-01-15T09:00:00.000Z',
      });
    }

    renderAt('/');

    expect(
      await screen.findByRole('img', {
        name: /3 game logins across 1 day in the last year/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/More games make a darker square/i)).toBeInTheDocument();
  });

  it('shows an empty state when no games are selected', async () => {
    await deleteAppDatabase();
    renderAt('/');

    expect(
      await screen.findByText(/No games are selected yet/),
    ).toBeInTheDocument();
  });

  it('records and undoes a manual login completion', async () => {
    const view = renderAt('/');

    expect(
      await screen.findByText('Login not recorded yet.'),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Mark login completion for AFK Arena (Global)',
      }),
    );

    expect(
      await screen.findByText('Login recorded for this reset cycle.'),
    ).toBeInTheDocument();
    expect(await listLoginCompletions()).toHaveLength(1);

    view.unmount();
    renderAt('/');
    expect(
      await screen.findByText('Login recorded for this reset cycle.'),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Undo login completion for AFK Arena (Global)',
      }),
    );

    expect(
      await screen.findByText('Login not recorded yet.'),
    ).toBeInTheDocument();
    expect(await listLoginCompletions()).toHaveLength(0);
  });

  it('does not count a completion from a previous reset cycle', async () => {
    await recordLoginCompletion({
      gameId: 'afk-arena',
      serverId: 'afk-arena:global',
      completedAt: '2026-01-14T23:00:00.000Z',
    });

    renderAt('/');

    expect(
      await screen.findByText('Login not recorded yet.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Mark login completion for AFK Arena (Global)',
      }),
    ).toBeInTheDocument();
  });

  it('uses a saved custom schedule for countdowns and recurring events', async () => {
    await setScheduleOverride({
      gameId: 'afk-arena',
      serverId: 'afk-arena:global',
      schedule: {
        kind: 'weekly',
        timeZone: { kind: 'utc' },
        time: '00:00',
        weekday: 1,
      },
    });

    renderAt('/');

    expect(
      await screen.findByText('3d 12:00:00'),
    ).toBeInTheDocument();
    const recurringHeading = screen.getByRole('heading', {
      level: 2,
      name: 'Recurring events',
    });
    const recurringSection = recurringHeading.closest('section');
    expect(recurringSection).not.toBeNull();
    expect(
      within(recurringSection as HTMLElement).getByText(
        /weekly on Monday at 00:00 UTC/,
      ),
    ).toBeInTheDocument();
  });
});
