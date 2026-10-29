/**
 * Typed access to public build-time configuration.
 *
 * Values are embedded in the browser bundle by Vite, so only public client
 * configuration belongs here. Secrets, private keys, and server credentials
 * must never use a VITE_ prefix.
 */

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

export interface AppConfig {
  /** Optional separately deployed Worker base URL (cloud features). */
  apiBaseUrl?: string;
  /** Present only when every public Firebase value is configured. */
  firebase?: FirebaseWebConfig;
  /** Set when only some Firebase values are present. */
  firebaseConfigError?: string;
}

type EnvValues = Record<string, unknown>;

function readText(values: EnvValues, key: string): string | undefined {
  const value = values[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Parses public configuration without throwing. A partial or malformed
 * Firebase setup disables sign-in but leaves the local-first app usable.
 */
export function parseAppConfig(values: EnvValues): AppConfig {
  const apiBaseUrl = readText(values, 'VITE_API_BASE_URL');
  let validApiBaseUrl: string | undefined;
  if (apiBaseUrl !== undefined) {
    try {
      const parsed = new URL(apiBaseUrl);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        validApiBaseUrl = apiBaseUrl.replace(/\/+$/, '');
      }
    } catch {
      validApiBaseUrl = undefined;
    }
  }

  const apiKey = readText(values, 'VITE_FIREBASE_API_KEY');
  const authDomain = readText(values, 'VITE_FIREBASE_AUTH_DOMAIN');
  const projectId = readText(values, 'VITE_FIREBASE_PROJECT_ID');
  const appId = readText(values, 'VITE_FIREBASE_APP_ID');
  const present = [apiKey, authDomain, projectId, appId].filter(
    (value) => value !== undefined,
  );

  if (present.length === 0) {
    return validApiBaseUrl === undefined ? {} : { apiBaseUrl: validApiBaseUrl };
  }
  if (present.length !== 4) {
    return {
      ...(validApiBaseUrl === undefined
        ? {}
        : { apiBaseUrl: validApiBaseUrl }),
      firebaseConfigError:
        'Firebase sign-in is not configured. All four VITE_FIREBASE_* values are required.',
    };
  }

  return {
    ...(validApiBaseUrl === undefined
      ? {}
      : { apiBaseUrl: validApiBaseUrl }),
    firebase: {
      apiKey: apiKey as string,
      authDomain: authDomain as string,
      projectId: projectId as string,
      appId: appId as string,
    },
  };
}

export const appConfig = parseAppConfig(import.meta.env as EnvValues);
