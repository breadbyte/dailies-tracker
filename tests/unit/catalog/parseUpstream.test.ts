import { describe, expect, it } from 'vitest';
import {
  parseUpstreamGameData,
  SourceParseError,
} from '../../../src/domain/catalog/parseUpstream.ts';

const MINIMAL = `var gameData = [
  { game: "A", server: "Global", timezone: "Etc/UTC", dailyReset: "00:00", icon: "a" }
];`;

describe('parseUpstreamGameData', () => {
  it('parses the literal upstream shape', () => {
    expect(parseUpstreamGameData(MINIMAL)).toEqual([
      {
        game: 'A',
        server: 'Global',
        timezone: 'Etc/UTC',
        dailyReset: '00:00',
        icon: 'a',
      },
    ]);
  });

  it('supports comments, single quotes, escapes, and trailing commas', () => {
    const source = `/* leading */
    var gameData = [
      // line comment
      {
        'game': 'Girls\\' Frontline',
        server: "EN",
        timezone: "Etc/GMT+7",
        dailyReset: "4:00",
        icon: 'girls-frontline',
        menuName: "Line\\nBreak",
      },
    ];
    `;
    const [record] = parseUpstreamGameData(source);
    expect(record).toEqual({
      game: "Girls' Frontline",
      server: 'EN',
      timezone: 'Etc/GMT+7',
      dailyReset: '4:00',
      icon: 'girls-frontline',
      menuName: 'Line\nBreak',
    });
  });

  it('rejects unknown record keys instead of silently dropping data', () => {
    const source = `var gameData = [
      { game: "A", server: "S", timezone: "Etc/UTC", dailyReset: "00:00", unexpected: true }
    ];`;
    expect(() => parseUpstreamGameData(source)).toThrow(SourceParseError);
    expect(() => parseUpstreamGameData(source)).toThrow(/unsupported key/i);
  });

  it('rejects duplicate keys', () => {
    const source = `var gameData = [
      { game: "A", game: "B", server: "S", timezone: "Etc/UTC", dailyReset: "00:00" }
    ];`;
    expect(() => parseUpstreamGameData(source)).toThrow(/Duplicate object key/);
  });

  it('rejects prototype-polluting keys', () => {
    const source = `var gameData = [
      { "__proto__": "x", game: "A", server: "S", timezone: "Etc/UTC", dailyReset: "00:00" }
    ];`;
    expect(() => parseUpstreamGameData(source)).toThrow(/Forbidden object key/);
  });

  it('rejects non-literal JavaScript such as function calls', () => {
    const source = `var gameData = [{ game: getGame(), server: "S", timezone: "Etc/UTC", dailyReset: "00:00" }];`;
    expect(() => parseUpstreamGameData(source)).toThrow(SourceParseError);
  });

  it('rejects template literals and spread syntax', () => {
    expect(() =>
      parseUpstreamGameData(
        'var gameData = [{ game: `A`, server: "S", timezone: "Etc/UTC", dailyReset: "00:00" }];',
      ),
    ).toThrow(/Unsupported JavaScript value/);
    expect(() =>
      parseUpstreamGameData('var gameData = [...other];'),
    ).toThrow(/Unsupported JavaScript value/);
  });

  it('rejects unterminated strings, invalid escapes, and trailing code', () => {
    expect(() =>
      parseUpstreamGameData('var gameData = [{ game: "A }];'),
    ).toThrow(/Unterminated string/);
    expect(() =>
      parseUpstreamGameData(
        'var gameData = [{ game: "\\q", server: "S", timezone: "Etc/UTC", dailyReset: "00:00" }];',
      ),
    ).toThrow(/Unsupported string escape/);
    expect(() => parseUpstreamGameData(`${MINIMAL}\nthrow new Error("x");`)).toThrow(
      /Unexpected content after/,
    );
  });

  it('never executes downloaded code', () => {
    const marker = '__catalog_parse_executed__';
    delete (globalThis as Record<string, unknown>)[marker];
    const source = `${MINIMAL}\nglobalThis.${marker} = true;`;
    expect(() => parseUpstreamGameData(source)).toThrow(SourceParseError);
    expect((globalThis as Record<string, unknown>)[marker]).toBeUndefined();
  });

  it('rejects empty arrays and non-array top-level values', () => {
    expect(() => parseUpstreamGameData('var gameData = [];')).toThrow(/empty/);
    expect(() => parseUpstreamGameData('var gameData = {};')).toThrow(
      /Expected `gameData` to be an array/,
    );
    expect(() => parseUpstreamGameData('const notGameData = [];')).toThrow(
      /Expected variable name/,
    );
  });

  it('requires string record fields and boolean utcDailyReset', () => {
    expect(() =>
      parseUpstreamGameData(
        'var gameData = [{ game: "A", server: "S", timezone: "Etc/UTC", dailyReset: 400 }];',
      ),
    ).toThrow(/dailyReset` must be a non-empty string/);
    expect(() =>
      parseUpstreamGameData(
        'var gameData = [{ game: "A", server: "S", timezone: "Etc/UTC", dailyReset: "00:00", utcDailyReset: "yes" }];',
      ),
    ).toThrow(/utcDailyReset` must be a boolean/);
  });
});
