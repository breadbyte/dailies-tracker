import 'fake-indexeddb/auto';
import { fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { routes } from '../../src/app/router.tsx';
import {
  closeAppDatabase,
  deleteAppDatabase,
} from '../../src/services/storage/database.ts';
import { loadPreferences } from '../../src/services/storage/preferences.ts';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(async () => {
  await deleteAppDatabase();
});

afterEach(async () => {
  await closeAppDatabase();
});

describe('game selection', () => {
  it('searches the catalog and adds a game region', async () => {
    renderAt('/games');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Games' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/No games selected yet/),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search games or regions'), {
      target: { value: 'AFK Arena' },
    });

    const add = await screen.findByRole('button', {
      name: 'Add AFK Arena (Global)',
    });
    fireEvent.click(add);

    expect(
      await screen.findByRole('button', { name: 'Add AFK Arena (Global)' }),
    ).toBeDisabled();
    expect(
      await screen.findByRole('checkbox', { name: 'Enabled' }),
    ).toBeChecked();
  });

  it('persists the selected artwork source', async () => {
    renderAt('/games');

    await screen.findByText(/No games selected yet/);
    fireEvent.change(screen.getByLabelText('Artwork source'), {
      target: { value: 'steamgriddb' },
    });

    expect(loadPreferences().preferences.artworkSource).toBe('steamgriddb');
  });

  it('edits and restores a game schedule', async () => {
    renderAt('/games');

    await screen.findByText(/No games selected yet/);
    fireEvent.change(screen.getByLabelText('Search games or regions'), {
      target: { value: 'AFK Arena' },
    });
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Add AFK Arena (Global)',
      }),
    );

    fireEvent.click(
      await screen.findByText('Edit reset schedule for AFK Arena'),
    );

    fireEvent.change(screen.getByLabelText('Schedule type'), {
      target: { value: 'weekly' },
    });
    fireEvent.change(screen.getByLabelText('Reset time'), {
      target: { value: '06:00' },
    });
    fireEvent.change(screen.getByLabelText('Time zone'), {
      target: { value: 'UTC' },
    });
    fireEvent.change(screen.getByLabelText('Weekday'), {
      target: { value: '4' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));

    expect(
      await screen.findByText(
        'Current: weekly on Thursday at 06:00 UTC (custom)',
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Restore catalog default' }),
    );

    expect(
      await screen.findByText(
        'Current: daily at 00:00 Etc/UTC (catalog default)',
      ),
    ).toBeInTheDocument();
  });
});
