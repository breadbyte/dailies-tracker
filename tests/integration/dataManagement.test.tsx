import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../src/app/router.tsx';
import {
  closeAppDatabase,
  deleteAppDatabase,
} from '../../src/services/storage/database.ts';
import {
  getGameSelection,
  listGameSelections,
  selectGameServer,
} from '../../src/services/storage/selectedGames.ts';
import { createDefaultPreferences } from '../../src/domain/storage/validation.ts';
import {
  loadPreferences,
  savePreferences,
} from '../../src/services/storage/preferences.ts';

const FIXTURE = readFileSync('tests/fixtures/backups/schema-v1.json', 'utf8');

function renderDataPage() {
  const router = createMemoryRouter(routes, { initialEntries: ['/data'] });
  render(<RouterProvider router={router} />);
}

function uploadBackup(name = 'schema-v1.json', text = FIXTURE): void {
  const file = new File([text], name, { type: 'application/json' });
  fireEvent.change(screen.getByLabelText('Backup file'), {
    target: { files: [file] },
  });
}

beforeEach(async () => {
  await deleteAppDatabase();
  window.localStorage.clear();
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:backup'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await closeAppDatabase();
});

describe('data management page', () => {
  it('rejects invalid JSON and leaves local data unchanged', async () => {
    await selectGameServer({
      gameId: 'afk-arena',
      serverId: 'afk-arena:global',
    });
    renderDataPage();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Data management' }),
    ).toBeInTheDocument();

    uploadBackup('broken.json', '{not json');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /not valid JSON/,
    );
    expect(await listGameSelections()).toHaveLength(1);
  });

  it('previews and merges a backup into an empty profile', async () => {
    renderDataPage();
    uploadBackup();

    expect(
      await screen.findByRole('table', {
        name: 'Changes this import will make',
      }),
    ).toBeInTheDocument();

    const importButton = screen.getByRole('button', {
      name: 'Import backup',
    });
    await waitFor(() => expect(importButton).toBeEnabled());
    fireEvent.click(importButton);

    expect(await screen.findByText('Import complete.')).toBeInTheDocument();
    expect(
      screen.getByRole('table', { name: 'Applied import result' }),
    ).toBeInTheDocument();
    expect(await listGameSelections()).toHaveLength(2);
    expect(
      (await getGameSelection('afk-arena::afk-arena:global'))
        ?.customDisplayName,
    ).toBe('AFK');
  });

  it('clears all local data only after confirmation', async () => {
    await selectGameServer({
      gameId: 'afk-arena',
      serverId: 'afk-arena:global',
    });
    savePreferences({ ...createDefaultPreferences(), theme: 'dark' });
    renderDataPage();

    const clearButton = screen.getByRole('button', {
      name: 'Delete all local data',
    });
    expect(clearButton).toBeDisabled();

    fireEvent.click(
      screen.getByLabelText(
        'I understand that all local data will be deleted.',
      ),
    );
    fireEvent.click(clearButton);

    expect(
      await screen.findByText('All local data was deleted.'),
    ).toBeInTheDocument();
    expect(await listGameSelections()).toHaveLength(0);
    expect(loadPreferences().preferences).toEqual(createDefaultPreferences());
    expect(window.localStorage.getItem('dailies:preferences')).toBeNull();
  });

  it('requires confirmation and downloads a pre-replace backup', async () => {
    await selectGameServer({
      gameId: 'afk-arena',
      serverId: 'afk-arena:global',
      customDisplayName: 'Local name',
    });
    renderDataPage();
    uploadBackup();

    await screen.findByRole('table', {
      name: 'Changes this import will make',
    });
    fireEvent.click(screen.getByLabelText('Replace selected categories'));

    const importButton = screen.getByRole('button', {
      name: 'Import backup',
    });
    expect(importButton).toBeDisabled();

    fireEvent.click(
      screen.getByLabelText(
        'I understand that data in the selected categories will be replaced.',
      ),
    );
    await waitFor(() => expect(importButton).toBeEnabled());
    fireEvent.click(importButton);

    expect(
      await screen.findByText(
        /Import complete. A backup of the previous data was downloaded first./,
      ),
    ).toBeInTheDocument();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
    expect(
      (await getGameSelection('afk-arena::afk-arena:global'))
        ?.customDisplayName,
    ).toBe('AFK');
    expect(await listGameSelections()).toHaveLength(2);
  });
});
