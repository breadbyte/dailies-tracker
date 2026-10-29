import type { Auth, User } from 'firebase/auth';
import { appConfig } from '../../config/env.ts';

export interface AuthUserSummary {
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
}

export class AuthServiceError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AuthServiceError';
    this.code = code;
  }
}

type FirebaseAuthModule = typeof import('firebase/auth');

interface AuthRuntime {
  auth: Auth;
  sdk: FirebaseAuthModule;
}

let runtimePromise: Promise<AuthRuntime> | undefined;

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/user-disabled': 'This account has been disabled.',
  'auth/user-not-found': 'No account was found for that email address.',
  'auth/wrong-password': 'The email or password is incorrect.',
  'auth/invalid-credential': 'The email or password is incorrect.',
  'auth/invalid-login-credentials': 'The email or password is incorrect.',
  'auth/email-already-in-use': 'An account already uses that email address.',
  'auth/weak-password': 'Choose a password with at least six characters.',
  'auth/too-many-requests':
    'Too many attempts. Wait a moment and try again.',
  'auth/network-request-failed':
    'The authentication service could not be reached. Check your connection.',
  'auth/operation-not-allowed':
    'This sign-in method is not enabled for the project.',
  'auth/requires-recent-login':
    'Sign in again before deleting this account.',
  'auth/unauthorized-domain':
    'This website is not authorized for the Firebase project.',
  'auth/configuration-not-found':
    'Firebase Authentication is not enabled for the project.',
};

export function authErrorMessage(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    const message = ERROR_MESSAGES[(error as { code: string }).code];
    if (message !== undefined) return message;
  }
  return 'Sign-in failed. Check your connection and try again.';
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return 'unknown';
}

export function toAuthServiceError(error: unknown): AuthServiceError {
  if (error instanceof AuthServiceError) return error;
  return new AuthServiceError(errorCode(error), authErrorMessage(error), {
    cause: error,
  });
}

export function summarizeUser(user: User): AuthUserSummary {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    emailVerified: user.emailVerified,
  };
}

async function getRuntime(): Promise<AuthRuntime> {
  const config = appConfig.firebase;
  if (config === undefined) {
    throw new AuthServiceError(
      'not-configured',
      appConfig.firebaseConfigError ??
        'Optional sign-in is not configured on this deployment.',
    );
  }

  if (runtimePromise === undefined) {
    const pending = (async () => {
      const [appModule, sdk] = await Promise.all([
        import('firebase/app'),
        import('firebase/auth'),
      ]);
      const existing = appModule
        .getApps()
        .find((app) => app.name === 'dailies');
      const app =
        existing ?? appModule.initializeApp(config, 'dailies');
      return { auth: sdk.getAuth(app), sdk };
    })();
    runtimePromise = pending;
    pending.catch(() => {
      if (runtimePromise === pending) runtimePromise = undefined;
    });
  }

  return runtimePromise;
}

export async function observeAuthState(
  onUser: (user: AuthUserSummary | null) => void,
  onError: (error: AuthServiceError) => void,
): Promise<() => void> {
  try {
    const { auth, sdk } = await getRuntime();
    return sdk.onAuthStateChanged(
      auth,
      (user) => onUser(user === null ? null : summarizeUser(user)),
      (error) => onError(toAuthServiceError(error)),
    );
  } catch (error) {
    throw toAuthServiceError(error);
  }
}

export async function registerWithEmail(
  email: string,
  password: string,
): Promise<void> {
  try {
    const { auth, sdk } = await getRuntime();
    await sdk.createUserWithEmailAndPassword(auth, email, password);
  } catch (error) {
    throw toAuthServiceError(error);
  }
}

export async function signInWithEmail(
  email: string,
  password: string,
): Promise<void> {
  try {
    const { auth, sdk } = await getRuntime();
    await sdk.signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    throw toAuthServiceError(error);
  }
}

export async function signOutCurrentUser(): Promise<void> {
  try {
    const { auth, sdk } = await getRuntime();
    await sdk.signOut(auth);
  } catch (error) {
    throw toAuthServiceError(error);
  }
}

export async function sendPasswordReset(email: string): Promise<void> {
  try {
    const { auth, sdk } = await getRuntime();
    await sdk.sendPasswordResetEmail(auth, email);
  } catch (error) {
    throw toAuthServiceError(error);
  }
}

export async function deleteCurrentUser(): Promise<void> {
  try {
    const { auth, sdk } = await getRuntime();
    const user = auth.currentUser;
    if (user === null) {
      throw new AuthServiceError(
        'not-signed-in',
        'Sign in again before deleting this account.',
      );
    }
    await sdk.deleteUser(user);
  } catch (error) {
    throw toAuthServiceError(error);
  }
}
