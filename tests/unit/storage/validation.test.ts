import { describe, expect, it } from 'vitest';
import {
  createDefaultPreferences,
  customGameIdFromUuid,
  customServerIdFromUuid,
  isValidServerId,
  parseAppPreferences,
  parseCustomGame,
  parseGameSelection,
  parseLoginCompletion,
  parseStorageTimestamp,
  selectionIdFor,
  StorageValidationError,
} from '../../../src/domain/storage/validation.ts';

const UUID_A = '00000000-0000-4000-8000-000000000001';
const UUID_B = '00000000-0000-4000-8000-000000000002';
const NOW = '2026-11-01T12:00:00.000Z';
const GAME_ID = customGameIdFromUuid(UUID_A);
const SERVER_ID = customServerIdFromUuid(GAME_ID, UUID_B);

describe('storage validation', () => {
  it('round-trips default preferences', () => {
    const defaults = createDefaultPreferences();
    expect(parseAppPreferences(defaults)).toEqual(defaults);
  });

  it('rejects unknown preference fields and invalid values', () => {
    const defaults = createDefaultPreferences();
    expect(() =>
      parseAppPreferences({ ...defaults, extra: true }),
    ).toThrow(StorageValidationError);
    expect(() =>
      parseAppPreferences({ ...defaults, displayTimeZone: 'Mars/Olympus' }),
    ).toThrow(/valid IANA time zone/);
    expect(() =>
      parseAppPreferences({
        ...defaults,
        collapsedSections: ['a', 'a'],
      }),
    ).toThrow(/must not repeat/);
    expect(() =>
      parseAppPreferences({ ...defaults, locale: 'not_a_locale!' }),
    ).toThrow(/BCP 47/);
  });

  it('validates catalog and custom server identities', () => {
    expect(isValidServerId('alpha-game', 'alpha-game:global')).toBe(true);
    expect(isValidServerId('alpha-game', 'alpha-game:Global')).toBe(false);
    expect(isValidServerId(GAME_ID, SERVER_ID)).toBe(true);
    expect(isValidServerId(GAME_ID, `${GAME_ID}:global`)).toBe(false);
    expect(selectionIdFor('alpha-game', 'alpha-game:global')).toBe(
      'alpha-game::alpha-game:global',
    );
  });

  it('validates game selections and their derived IDs', () => {
    const id = selectionIdFor('alpha-game', 'alpha-game:global');
    const selection = {
      id,
      gameId: 'alpha-game',
      serverId: 'alpha-game:global',
      enabled: true,
      createdAt: NOW,
      updatedAt: NOW,
    };

    expect(parseGameSelection(selection)).toEqual(selection);
    expect(() =>
      parseGameSelection({ ...selection, id: 'alpha-game::wrong' }),
    ).toThrow(/must be/);
    expect(() =>
      parseGameSelection({ ...selection, serverId: 'beta-game:global' }),
    ).toThrow(/valid server ID/);
  });

  it('validates custom games and rejects bad schedules', () => {
    const game = {
      id: GAME_ID,
      name: 'Custom Game',
      servers: [
        {
          id: SERVER_ID,
          name: 'Global',
          timeZone: 'Europe/Berlin',
          dailyReset: { time: '04:00', basis: 'local' as const },
        },
      ],
      createdAt: NOW,
      updatedAt: NOW,
    };

    expect(parseCustomGame(game).id).toBe(GAME_ID);
    expect(() =>
      parseCustomGame({
        ...game,
        servers: [
          {
            ...game.servers[0],
            timeZone: 'Bad/Zone',
          },
        ],
      }),
    ).toThrow(/valid IANA time zone/);
    expect(() =>
      parseCustomGame({
        ...game,
        servers: [game.servers[0], game.servers[0]],
      }),
    ).toThrow(/must be unique/);
  });

  it('requires canonical timestamps and valid completion IDs', () => {
    const completion = {
      id: UUID_B,
      gameId: 'alpha-game',
      serverId: 'alpha-game:global',
      completedAt: NOW,
    };

    expect(parseLoginCompletion(completion)).toEqual(completion);
    expect(() =>
      parseLoginCompletion({
        ...completion,
        completedAt: '2026-11-01T12:00:00Z',
      }),
    ).toThrow(/canonical UTC/);
    expect(() =>
      parseLoginCompletion({ ...completion, id: 'not-a-uuid' }),
    ).toThrow(/lowercase UUID/);
    expect(parseStorageTimestamp(NOW)).toBe(NOW);
  });
});
