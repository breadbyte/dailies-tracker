import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../src/app/router.tsx';
import { AuthProvider } from '../../src/features/auth/AuthProvider.tsx';
import type { AuthUserSummary } from '../../src/services/auth/firebase.ts';
import {
  closeAppDatabase,
  deleteAppDatabase,
} from '../../src/services/storage/database.ts';
import {
  listGameSelections,
  selectGameServer,
} from '../../src/services/storage/selectedGames.ts';

const FIREBASE = {
  apiKey: 'public-api-key',
  authDomain: 'example.firebaseapp.com',
  projectId: 'example-project',
  appId: '1:2:web:3',
};

const USER: AuthUserSummary = {
  uid: 'uid-1',
  email: 'player@example.com',
  displayName: null,
  emailVerified: true,
};

const mocks = vi.hoisted(() => ({
  config: {
    firebase: undefined as
      | {
          apiKey: string;
          authDomain: string;
          projectId: string;
          appId: string;
        }
      | undefined,
    firebaseConfigError: undefined as string | undefined,
  },
  observeAuthState: vi.fn(),
  signInWithEmail: vi.fn(),
  registerWithEmail: vi.fn(),
  signOutCurrentUser: vi.fn(),
  sendPasswordReset: vi.fn(),
  deleteCurrentUser: vi.fn(),
}));

vi.mock('../../src/config/env.ts', () => ({ appConfig: mocks.config }));
vi.mock('../../src/services/auth/firebase.ts', () => ({
  observeAuthState: mocks.observeAuthState,
  signInWithEmail: mocks.signInWithEmail,
  registerWithEmail: mocks.registerWithEmail,
  signOutCurrentUser: mocks.signOutCurrentUser,
  sendPasswordReset: mocks.sendPasswordReset,
  deleteCurrentUser: mocks.deleteCurrentUser,
}));

let emitAuth: ((user: AuthUserSummary | null) => void) | undefined;

function renderAccount() {
  const router = createMemoryRouter(routes, { initialEntries: ['/account'] });
  return render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
}

beforeEach(async () => {
  mocks.config.firebase = undefined;
  mocks.config.firebaseConfigError = undefined;
  emitAuth = undefined;
  mocks.observeAuthState.mockReset();
  mocks.signInWithEmail.mockReset().mockResolvedValue(undefined);
  mocks.registerWithEmail.mockReset().mockResolvedValue(undefined);
  mocks.signOutCurrentUser.mockReset().mockResolvedValue(undefined);
  mocks.sendPasswordReset.mockReset().mockResolvedValue(undefined);
  mocks.deleteCurrentUser.mockReset().mockResolvedValue(undefined);
  mocks.observeAuthState.mockImplementation(async (onUser: (user: AuthUserSummary | null) => void) => {
    onUser(null);
    return () => undefined;
  });
  await deleteAppDatabase();
});

afterEach(async () => {
  await closeAppDatabase();
});

describe('account page', () => {
  it('stays local-only when Firebase is not configured', () => {
    renderAccount();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Account' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Optional sign-in is not configured/),
    ).toBeInTheDocument();
    expect(mocks.observeAuthState).not.toHaveBeenCalled();
  });

  it('shows a clear fallback when configured auth is unavailable', async () => {
    mocks.config.firebase = FIREBASE;
    mocks.observeAuthState.mockRejectedValue(
      new Error('Authentication is unreachable.'),
    );

    renderAccount();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Authentication is unreachable. Local game data remains available and unchanged.',
    );
  });

  it('offers sign-in, registration, and password recovery when signed out', async () => {
    mocks.config.firebase = FIREBASE;
    const user = userEvent.setup();
    renderAccount();

    expect(
      await screen.findByRole('heading', {
        name: 'Sign in or create an account',
      }),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText('Email'), 'player@example.com');
    await user.type(screen.getByLabelText('Password'), 'secret1');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(mocks.registerWithEmail).toHaveBeenCalledWith(
      'player@example.com',
      'secret1',
    );

    await user.click(
      screen.getByRole('button', { name: 'Forgot password?' }),
    );
    expect(mocks.sendPasswordReset).toHaveBeenCalledWith(
      'player@example.com',
    );
  });

  it('surfaces sign-in failures without touching local data', async () => {
    mocks.config.firebase = FIREBASE;
    mocks.signInWithEmail.mockRejectedValue(
      new Error('The email or password is incorrect.'),
    );
    await selectGameServer({
      gameId: 'afk-arena',
      serverId: 'afk-arena:global',
    });

    const user = userEvent.setup();
    renderAccount();

    await screen.findByRole('heading', {
      name: 'Sign in or create an account',
    });
    await user.type(screen.getByLabelText('Email'), 'player@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong12');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The email or password is incorrect.',
    );
    expect(await listGameSelections()).toHaveLength(1);
  });

  it('signs out without deleting local data', async () => {
    mocks.config.firebase = FIREBASE;
    await selectGameServer({
      gameId: 'afk-arena',
      serverId: 'afk-arena:global',
    });
    mocks.observeAuthState.mockImplementation(async (onUser: (user: AuthUserSummary | null) => void) => {
      emitAuth = onUser;
      onUser(USER);
      return () => undefined;
    });
    mocks.signOutCurrentUser.mockImplementation(async () => {
      emitAuth?.(null);
    });

    const user = userEvent.setup();
    renderAccount();

    expect(await screen.findByText('player@example.com')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => {
      expect(mocks.signOutCurrentUser).toHaveBeenCalledTimes(1);
    });
    expect(
      await screen.findByRole('heading', {
        name: 'Sign in or create an account',
      }),
    ).toBeInTheDocument();
    expect(await listGameSelections()).toHaveLength(1);
    expect(mocks.deleteCurrentUser).not.toHaveBeenCalled();
  });
});
