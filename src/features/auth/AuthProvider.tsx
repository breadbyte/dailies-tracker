import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { appConfig } from '../../config/env.ts';
import {
  observeAuthState,
  type AuthUserSummary,
} from '../../services/auth/firebase.ts';

export type AuthState =
  | { status: 'disabled'; message: string }
  | { status: 'loading' }
  | { status: 'unavailable'; message: string }
  | { status: 'signed-out' }
  | { status: 'signed-in'; user: AuthUserSummary };

const AuthStateContext = createContext<AuthState | undefined>(undefined);

function initialAuthState(): AuthState {
  if (appConfig.firebase !== undefined) return { status: 'loading' };
  return {
    status: 'disabled',
    message:
      appConfig.firebaseConfigError ??
      'Optional sign-in is not configured on this deployment. Dailies works fully without an account.',
  };
}

function localModeNotice(message: string): string {
  return `${message} Local game data remains available and unchanged.`;
}

/**
 * Observes Firebase Authentication state when the deployment is configured.
 * It never reads or writes local game data, so auth changes cannot remove it.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(initialAuthState);

  useEffect(() => {
    if (appConfig.firebase === undefined) return;

    let active = true;
    let unsubscribe: (() => void) | undefined;
    setState({ status: 'loading' });

    void observeAuthState(
      (user) => {
        if (!active) return;
        setState(
          user === null
            ? { status: 'signed-out' }
            : { status: 'signed-in', user },
        );
      },
      (error) => {
        if (!active) return;
        setState({
          status: 'unavailable',
          message: localModeNotice(error.message),
        });
      },
    )
      .then((stop) => {
        if (active) {
          unsubscribe = stop;
        } else {
          stop();
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          status: 'unavailable',
          message: localModeNotice(
            error instanceof Error
              ? error.message
              : 'Sign-in is unavailable.',
          ),
        });
      });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  return (
    <AuthStateContext.Provider value={state}>
      {children}
    </AuthStateContext.Provider>
  );
}

export function useAuthState(): AuthState {
  const state = useContext(AuthStateContext);
  if (state === undefined) {
    throw new Error('useAuthState must be used inside AuthProvider');
  }
  return state;
}
