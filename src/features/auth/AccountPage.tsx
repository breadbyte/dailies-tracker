import { useState, type FormEvent } from 'react';
import {
  deleteCurrentUser,
  registerWithEmail,
  sendPasswordReset,
  signInWithEmail,
  signOutCurrentUser,
} from '../../services/auth/firebase.ts';
import { useAuthState } from './AuthProvider.tsx';

type Busy = 'sign-in' | 'register' | 'reset' | 'sign-out' | 'delete' | null;

interface Notice {
  kind: 'status' | 'alert';
  text: string;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

function AuthForms() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setBusy('sign-in');
    try {
      await signInWithEmail(email.trim(), password);
    } catch (error) {
      setNotice({
        kind: 'alert',
        text: errorMessage(error, 'Sign-in failed.'),
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleRegister() {
    setNotice(null);
    setBusy('register');
    try {
      await registerWithEmail(email.trim(), password);
    } catch (error) {
      setNotice({
        kind: 'alert',
        text: errorMessage(error, 'The account could not be created.'),
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleReset() {
    setNotice(null);
    if (email.trim() === '') {
      setNotice({ kind: 'alert', text: 'Enter your email address first.' });
      return;
    }
    setBusy('reset');
    try {
      await sendPasswordReset(email.trim());
      setNotice({
        kind: 'status',
        text: 'If an account exists for that email, a password reset message is on its way.',
      });
    } catch (error) {
      if (errorCode(error) === 'auth/user-not-found') {
        setNotice({
          kind: 'status',
          text: 'If an account exists for that email, a password reset message is on its way.',
        });
      } else {
        setNotice({
          kind: 'alert',
          text: errorMessage(error, 'The reset message could not be sent.'),
        });
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <form className="auth-form" onSubmit={handleSignIn}>
        <h2 id="sign-in-heading">Sign in or create an account</h2>
        <label htmlFor="auth-email">
          Email
          <input
            id="auth-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label htmlFor="auth-password">
          Password
          <input
            id="auth-password"
            type="password"
            autoComplete="current-password"
            required
            minLength={6}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <p className="reset-meta">
          Registration uses email and password. Passwords are sent to Firebase
          Authentication and are never stored by Dailies.
        </p>
        <div className="button-row">
          <button type="submit" disabled={busy !== null}>
            {busy === 'sign-in' ? 'Signing in…' : 'Sign in'}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={(event) => {
              const form = event.currentTarget.form;
              if (form !== null && !form.reportValidity()) return;
              void handleRegister();
            }}
          >
            {busy === 'register' ? 'Creating account…' : 'Create account'}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => {
              void handleReset();
            }}
          >
            {busy === 'reset' ? 'Sending…' : 'Forgot password?'}
          </button>
        </div>
      </form>
      {notice !== null ? <p role={notice.kind}>{notice.text}</p> : null}
    </>
  );
}

function SignedInPanel() {
  const state = useAuthState();
  const [busy, setBusy] = useState<Busy>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  if (state.status !== 'signed-in') return null;

  async function handleSignOut() {
    setNotice(null);
    setBusy('sign-out');
    try {
      await signOutCurrentUser();
      setNotice({
        kind: 'status',
        text: 'Signed out. Local game data is unchanged.',
      });
    } catch (error) {
      setNotice({
        kind: 'alert',
        text: errorMessage(error, 'Sign-out failed.'),
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setNotice(null);
    setBusy('delete');
    try {
      await deleteCurrentUser();
      setNotice({
        kind: 'status',
        text: 'Account deleted. Local game data is unchanged.',
      });
    } catch (error) {
      setNotice({
        kind: 'alert',
        text: errorMessage(error, 'The account could not be deleted.'),
      });
    } finally {
      setBusy(null);
    }
  }

  const label = state.user.email ?? 'your account';

  return (
    <>
      <p>
        Signed in as <strong>{label}</strong>.
      </p>
      <div className="button-row">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => {
            void handleSignOut();
          }}
        >
          {busy === 'sign-out' ? 'Signing out…' : 'Sign out'}
        </button>
      </div>

      <section aria-labelledby="delete-account-heading">
        <h2 id="delete-account-heading">Delete account</h2>
        <p>
          This deletes the Firebase Authentication account only. It does not
          delete local games, schedules, or login history. Sign in again
          recently before deleting if Firebase asks for reauthentication.
        </p>
        <p>
          <label>
            <input
              type="checkbox"
              checked={confirmDelete}
              onChange={(event) => setConfirmDelete(event.target.checked)}
            />
            I understand that this account will be permanently deleted.
          </label>
        </p>
        <button
          type="button"
          disabled={busy !== null || !confirmDelete}
          onClick={() => {
            void handleDelete();
          }}
        >
          {busy === 'delete' ? 'Deleting…' : 'Delete account'}
        </button>
      </section>

      {notice !== null ? <p role={notice.kind}>{notice.text}</p> : null}
    </>
  );
}

export function AccountPage() {
  const state = useAuthState();

  return (
    <section aria-labelledby="account-heading">
      <h1 id="account-heading">Account</h1>
      <p>
        Signing in is optional. Account synchronization is not implemented, so
        signing in never uploads, replaces, or deletes local game data.
      </p>

      {state.status === 'loading' ? (
        <p role="status">Checking sign-in state…</p>
      ) : null}

      {state.status === 'disabled' ? <p>{state.message}</p> : null}

      {state.status === 'unavailable' ? (
        <p role="alert">{state.message}</p>
      ) : null}

      {state.status === 'signed-out' ? <AuthForms /> : null}

      {state.status === 'signed-in' ? <SignedInPanel /> : null}
    </section>
  );
}
