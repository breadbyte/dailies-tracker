import { describe, expect, it } from 'vitest';
import { parseAppConfig } from '../../../src/config/env.ts';

const complete = {
  VITE_FIREBASE_API_KEY: 'public-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'example.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'example-project',
  VITE_FIREBASE_APP_ID: '1:2:web:3',
};

describe('public app configuration', () => {
  it('leaves sign-in disabled when no Firebase values are set', () => {
    expect(parseAppConfig({})).toEqual({});
    expect(parseAppConfig({ VITE_FIREBASE_API_KEY: '   ' })).toEqual({});
  });

  it('reads a complete public Firebase web configuration', () => {
    expect(parseAppConfig(complete)).toEqual({
      firebase: {
        apiKey: 'public-api-key',
        authDomain: 'example.firebaseapp.com',
        projectId: 'example-project',
        appId: '1:2:web:3',
      },
    });
  });

  it('accepts an optional Worker base URL and strips trailing slashes', () => {
    expect(
      parseAppConfig({ VITE_API_BASE_URL: ' https://api.example.com/ ' }),
    ).toEqual({ apiBaseUrl: 'https://api.example.com' });
    expect(parseAppConfig({ VITE_API_BASE_URL: 'not a url' })).toEqual({});
  });

  it('trims surrounding whitespace', () => {
    const config = parseAppConfig({
      ...complete,
      VITE_FIREBASE_API_KEY: '  public-api-key  ',
      VITE_FIREBASE_PROJECT_ID: ' example-project ',
    });

    expect(config.firebase?.apiKey).toBe('public-api-key');
    expect(config.firebase?.projectId).toBe('example-project');
  });

  it('disables sign-in with a warning when configuration is partial', () => {
    const config = parseAppConfig({
      VITE_FIREBASE_API_KEY: 'public-api-key',
      VITE_FIREBASE_PROJECT_ID: 'example-project',
    });

    expect(config.firebase).toBeUndefined();
    expect(config.firebaseConfigError).toMatch(/All four VITE_FIREBASE_/);
  });
});
