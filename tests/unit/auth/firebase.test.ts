import type { User } from 'firebase/auth';
import { describe, expect, it } from 'vitest';
import {
  AuthServiceError,
  authErrorMessage,
  summarizeUser,
  toAuthServiceError,
} from '../../../src/services/auth/firebase.ts';

describe('Firebase auth helpers', () => {
  it('summarizes only the fields the UI needs', () => {
    const user = {
      uid: 'uid-1',
      email: 'player@example.com',
      displayName: null,
      emailVerified: true,
      password: 'must-not-leak',
    } as unknown as User;

    expect(summarizeUser(user)).toEqual({
      uid: 'uid-1',
      email: 'player@example.com',
      displayName: null,
      emailVerified: true,
    });
  });

  it('maps common Firebase error codes to safe messages', () => {
    expect(authErrorMessage({ code: 'auth/wrong-password' })).toBe(
      'The email or password is incorrect.',
    );
    expect(authErrorMessage({ code: 'auth/too-many-requests' })).toBe(
      'Too many attempts. Wait a moment and try again.',
    );
    expect(authErrorMessage({ code: 'auth/unknown-code' })).toBe(
      'Sign-in failed. Check your connection and try again.',
    );
  });

  it('preserves the Firebase code on service errors', () => {
    const error = toAuthServiceError({ code: 'auth/invalid-email' });

    expect(error).toBeInstanceOf(AuthServiceError);
    expect(error.code).toBe('auth/invalid-email');
    expect(error.message).toBe('Enter a valid email address.');
  });
});
