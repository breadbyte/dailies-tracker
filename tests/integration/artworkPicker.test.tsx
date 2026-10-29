import 'fake-indexeddb/auto';
import { fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { routes } from '../../src/app/router.tsx';
import type { ArtworkImage } from '../../src/domain/artwork/types.ts';
import { normalizeGameName } from '../../src/services/artwork/steamGridDb.ts';
import { writeArtworkCacheEntry } from '../../src/services/storage/artworkCache.ts';
import {
  closeAppDatabase,
  deleteAppDatabase,
} from '../../src/services/storage/database.ts';
import { loadPreferences } from '../../src/services/storage/preferences.ts';
import { listGameSelections } from '../../src/services/storage/selectedGames.ts';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

const images: ArtworkImage[] = [
  {
    id: 4601,
    url: 'https://img.test/4601.png',
    thumb: 'https://img.test/4601-thumb.png',
    width: 460,
    height: 215,
    score: 5,
  },
  {
    id: 6002,
    url: 'https://img.test/6002.png',
    thumb: 'https://img.test/6002-thumb.png',
    width: 600,
    height: 900,
    score: 3,
  },
];

function mainArtwork(): HTMLElement {
  return screen.getByAltText('AFK Arena artwork from SteamGridDB');
}

async function addAfKArena(): Promise<void> {
  fireEvent.change(screen.getByLabelText('Search games or regions'), {
    target: { value: 'AFK Arena' },
  });
  fireEvent.click(
    await screen.findByRole('button', { name: 'Add AFK Arena (Global)' }),
  );
}

/** Seeds a fresh cache entry (no network), mounts, and adds the game. */
async function mountWithAfKArena(): Promise<void> {
  await writeArtworkCacheEntry({
    key: normalizeGameName('AFK Arena'),
    fetchedAt: new Date().toISOString(),
    status: 'ok',
    match: { id: 7, name: 'AFK Arena' },
    images,
  });

  renderAt('/games');
  await screen.findByText(/No games selected yet/);

  fireEvent.change(screen.getByLabelText('Artwork source'), {
    target: { value: 'steamgriddb' },
  });
  await addAfKArena();
}

beforeEach(async () => {
  await deleteAppDatabase();
});

afterEach(async () => {
  await closeAppDatabase();
});

describe('artwork swatch picker', () => {
  it('renders a swatch grid and persists image choices', async () => {
    await mountWithAfKArena();

    // The picker starts collapsed: one click opens the swatch grid.
    const toggle = await screen.findByRole('button', {
      name: 'Choose artwork for AFK Arena',
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByRole('group', { name: 'Artwork for AFK Arena' }),
    ).toBeNull();

    // First click pops up the image grid.
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const group = screen.getByRole('group', {
      name: 'Artwork for AFK Arena',
    });
    expect(group).toBeInTheDocument();

    // The text dropdown is gone; swatches replace it.
    expect(
      screen.queryByRole('combobox', { name: 'Artwork for AFK Arena' }),
    ).toBeNull();

    const auto = screen.getByRole('button', {
      name: 'Use top rated artwork for AFK Arena',
    });
    const wide = screen.getByRole('button', {
      name: 'Use artwork 460×215 for AFK Arena',
    });
    const tall = screen.getByRole('button', {
      name: 'Use artwork 600×900 for AFK Arena',
    });

    // Nothing pinned yet: the automatic top-rated swatch is selected.
    expect(auto).toHaveAttribute('aria-pressed', 'true');
    expect(wide).toHaveAttribute('aria-pressed', 'false');
    expect(tall).toHaveAttribute('aria-pressed', 'false');

    // Highest-score image is the default card artwork.
    expect(mainArtwork()).toHaveAttribute(
      'src',
      'https://img.test/4601-thumb.png',
    );

    // Pinning a swatch persists the choice and switches the card artwork.
    fireEvent.click(tall);
    const gameId = (await listGameSelections())[0]?.gameId ?? '';
    expect(loadPreferences().preferences.artworkChoices[gameId]).toBe(6002);
    expect(tall).toHaveAttribute('aria-pressed', 'true');
    expect(auto).toHaveAttribute('aria-pressed', 'false');
    expect(mainArtwork()).toHaveAttribute(
      'src',
      'https://img.test/6002-thumb.png',
    );

    // The auto swatch clears the saved choice and returns to top rated.
    fireEvent.click(auto);
    expect(
      loadPreferences().preferences.artworkChoices[gameId],
    ).toBeUndefined();
    expect(auto).toHaveAttribute('aria-pressed', 'true');
    expect(tall).toHaveAttribute('aria-pressed', 'false');
    expect(mainArtwork()).toHaveAttribute(
      'src',
      'https://img.test/4601-thumb.png',
    );

    // Toggling again collapses the grid.
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByRole('group', { name: 'Artwork for AFK Arena' }),
    ).toBeNull();
  });

  it('previews the hovered artwork on the card and restores on leave', async () => {
    await mountWithAfKArena();

    const toggle = await screen.findByRole('button', {
      name: 'Choose artwork for AFK Arena',
    });
    fireEvent.click(toggle);

    const tall = screen.getByRole('button', {
      name: 'Use artwork 600×900 for AFK Arena',
    });

    // Focusing a swatch shows the floating preview and swaps the card image.
    fireEvent.focus(tall);
    expect(
      document.querySelector('.artwork-hover-preview img'),
    ).toHaveAttribute('src', 'https://img.test/6002-thumb.png');
    expect(mainArtwork()).toHaveAttribute(
      'src',
      'https://img.test/6002-thumb.png',
    );

    // Blurring hides the preview, restores the committed artwork, and does
    // not save any choice.
    fireEvent.blur(tall);
    expect(document.querySelector('.artwork-hover-preview')).toBeNull();
    expect(mainArtwork()).toHaveAttribute(
      'src',
      'https://img.test/4601-thumb.png',
    );
    const gameId = (await listGameSelections())[0]?.gameId ?? '';
    expect(
      loadPreferences().preferences.artworkChoices[gameId],
    ).toBeUndefined();
  });
});
