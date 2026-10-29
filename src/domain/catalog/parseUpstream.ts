import type { UpstreamGameRecord } from './types.ts';

/**
 * The upstream `game-data.js` file is JavaScript, but it only uses a tiny
 * literal subset. This module parses that subset with a strict recursive
 * descent parser. It never evaluates the source, so downloaded data cannot
 * run code during catalog synchronization.
 *
 * Supported subset:
 *   var gameData = [ { key: "string", flag: true, time: 12.5 }, ... ];
 * Keys may be identifiers or quoted strings. Values may be strings, numbers,
 * booleans, null, arrays, or objects. Comments and trailing commas are
 * tolerated; any other JavaScript (calls, templates, spreads, identifiers as
 * values) is rejected.
 */

export class SourceParseError extends Error {
  readonly position: number;

  constructor(message: string, position: number) {
    super(`${message} (at offset ${position})`);
    this.name = 'SourceParseError';
    this.position = position;
  }
}

type ParsedValue =
  | string
  | number
  | boolean
  | null
  | ParsedValue[]
  | ParsedObject;

interface ParsedObject {
  [key: string]: ParsedValue;
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype']);
const RECORD_KEYS = new Set([
  'game',
  'server',
  'timezone',
  'dailyReset',
  'icon',
  'menuName',
  'utcDailyReset',
]);

class Parser {
  readonly #source: string;
  #index = 0;

  constructor(source: string) {
    this.#source = source;
  }

  parseGameData(): UpstreamGameRecord[] {
    this.#skipTrivia();
    const declaration = ['var', 'let', 'const'].find((word) =>
      this.#startsWord(word),
    );
    if (declaration === undefined) {
      this.#fail('Expected a `var`, `let`, or `const` declaration');
    }
    this.#index += declaration.length;
    this.#skipTrivia();
    const name = this.#parseIdentifier();
    if (name !== 'gameData') {
      this.#fail(`Expected variable name \`gameData\`, found \`${name}\``);
    }
    this.#skipTrivia();
    this.#expect('=');
    this.#skipTrivia();

    const value = this.#parseValue();
    if (!Array.isArray(value)) {
      this.#fail('Expected `gameData` to be an array');
    }
    const records = value.map((entry, index) => toRecord(entry, index));

    this.#skipTrivia();
    if (this.#peek() === ';') this.#index += 1;
    this.#skipTrivia();
    if (this.#index !== this.#source.length) {
      this.#fail('Unexpected content after the game-data array');
    }
    if (records.length === 0) {
      this.#fail('The upstream game-data array is empty');
    }
    return records;
  }

  #parseValue(): ParsedValue {
    this.#skipTrivia();
    const char = this.#peek();
    if (char === '{') return this.#parseObject();
    if (char === '[') return this.#parseArray();
    if (char === '"' || char === "'") return this.#parseString();
    if (char === '-' || (char !== undefined && char >= '0' && char <= '9')) {
      return this.#parseNumber();
    }
    if (this.#startsWord('true')) {
      this.#index += 4;
      return true;
    }
    if (this.#startsWord('false')) {
      this.#index += 5;
      return false;
    }
    if (this.#startsWord('null')) {
      this.#index += 4;
      return null;
    }
    this.#fail(
      `Unsupported JavaScript value; only literal data is allowed (found \`${char ?? 'end of file'}\`)`,
    );
  }

  #parseObject(): ParsedObject {
    this.#expect('{');
    const result: ParsedObject = Object.create(null) as ParsedObject;
    this.#skipTrivia();
    if (this.#peek() === '}') {
      this.#index += 1;
      return result;
    }
    for (;;) {
      this.#skipTrivia();
      const key = this.#parseKey();
      if (FORBIDDEN_KEYS.has(key)) {
        this.#fail(`Forbidden object key \`${key}\``);
      }
      if (Object.hasOwn(result, key)) {
        this.#fail(`Duplicate object key \`${key}\``);
      }
      this.#skipTrivia();
      this.#expect(':');
      result[key] = this.#parseValue();
      this.#skipTrivia();
      const next = this.#peek();
      if (next === ',') {
        this.#index += 1;
        this.#skipTrivia();
        if (this.#peek() === '}') {
          this.#index += 1;
          return result;
        }
        continue;
      }
      if (next === '}') {
        this.#index += 1;
        return result;
      }
      this.#fail('Expected `,` or `}` in object');
    }
  }

  #parseArray(): ParsedValue[] {
    this.#expect('[');
    const result: ParsedValue[] = [];
    this.#skipTrivia();
    if (this.#peek() === ']') {
      this.#index += 1;
      return result;
    }
    for (;;) {
      result.push(this.#parseValue());
      this.#skipTrivia();
      const next = this.#peek();
      if (next === ',') {
        this.#index += 1;
        this.#skipTrivia();
        if (this.#peek() === ']') {
          this.#index += 1;
          return result;
        }
        continue;
      }
      if (next === ']') {
        this.#index += 1;
        return result;
      }
      this.#fail('Expected `,` or `]` in array');
    }
  }

  #parseKey(): string {
    const char = this.#peek();
    if (char === '"' || char === "'") return this.#parseString();
    return this.#parseIdentifier();
  }

  #parseIdentifier(): string {
    const start = this.#index;
    const first = this.#peek();
    if (first === undefined || !/[A-Za-z_$]/.test(first)) {
      this.#fail('Expected an identifier');
    }
    this.#index += 1;
    while (this.#index < this.#source.length) {
      const char = this.#source[this.#index];
      if (char === undefined || !/[A-Za-z0-9_$]/.test(char)) break;
      this.#index += 1;
    }
    return this.#source.slice(start, this.#index);
  }

  #parseString(): string {
    const quote = this.#source[this.#index];
    if (quote !== '"' && quote !== "'") this.#fail('Expected a string');
    this.#index += 1;
    let value = '';
    for (;;) {
      const char = this.#source[this.#index];
      if (char === undefined) this.#fail('Unterminated string');
      if (char === quote) {
        this.#index += 1;
        return value;
      }
      if (char === '\n' || char === '\r') {
        this.#fail('Unescaped line break in string');
      }
      if (char !== '\\') {
        value += char;
        this.#index += 1;
        continue;
      }
      this.#index += 1;
      const escape = this.#source[this.#index];
      if (escape === undefined) this.#fail('Unterminated string escape');
      this.#index += 1;
      switch (escape) {
        case '"':
        case "'":
        case '\\':
        case '/':
          value += escape;
          break;
        case 'b':
          value += '\b';
          break;
        case 'f':
          value += '\f';
          break;
        case 'n':
          value += '\n';
          break;
        case 'r':
          value += '\r';
          break;
        case 't':
          value += '\t';
          break;
        case 'u': {
          const hex = this.#source.slice(this.#index, this.#index + 4);
          if (!/^[0-9A-Fa-f]{4}$/.test(hex)) {
            this.#fail('Invalid unicode escape in string');
          }
          value += String.fromCharCode(Number.parseInt(hex, 16));
          this.#index += 4;
          break;
        }
        default:
          this.#fail(`Unsupported string escape \`\\${escape}\``);
      }
    }
  }

  #parseNumber(): number {
    const start = this.#index;
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
      this.#source.slice(start),
    );
    if (!match) this.#fail('Invalid number');
    this.#index += match[0].length;
    return Number(match[0]);
  }

  #skipTrivia(): void {
    for (;;) {
      const char = this.#source[this.#index];
      if (char !== undefined && /\s/.test(char)) {
        this.#index += 1;
        continue;
      }
      if (char === '/' && this.#source[this.#index + 1] === '/') {
        this.#index += 2;
        while (
          this.#index < this.#source.length &&
          this.#source[this.#index] !== '\n'
        ) {
          this.#index += 1;
        }
        continue;
      }
      if (char === '/' && this.#source[this.#index + 1] === '*') {
        const end = this.#source.indexOf('*/', this.#index + 2);
        if (end === -1) this.#fail('Unterminated block comment');
        this.#index = end + 2;
        continue;
      }
      return;
    }
  }

  #expect(char: string): void {
    if (this.#source[this.#index] !== char) {
      this.#fail(`Expected \`${char}\``);
    }
    this.#index += 1;
  }

  #startsWord(word: string): boolean {
    if (!this.#source.startsWith(word, this.#index)) return false;
    const after = this.#source[this.#index + word.length];
    return after === undefined || !/[A-Za-z0-9_$]/.test(after);
  }

  #peek(): string | undefined {
    return this.#source[this.#index];
  }

  #fail(message: string): never {
    throw new SourceParseError(message, this.#index);
  }
}

function toRecord(value: ParsedValue, index: number): UpstreamGameRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new SourceParseError(
      `Game-data entry ${index} must be an object`,
      0,
    );
  }
  for (const key of Object.keys(value)) {
    if (!RECORD_KEYS.has(key)) {
      throw new SourceParseError(
        `Game-data entry ${index} has unsupported key \`${key}\`; update the normalization code before syncing`,
        0,
      );
    }
  }

  const game = requireNonEmptyString(value, 'game', index);
  const server = requireNonEmptyString(value, 'server', index);
  const timezone = requireNonEmptyString(value, 'timezone', index);
  const dailyReset = requireNonEmptyString(value, 'dailyReset', index);
  const record: UpstreamGameRecord = {
    game,
    server,
    timezone,
    dailyReset,
  };

  if (value.icon !== undefined) {
    record.icon = requireNonEmptyString(value, 'icon', index);
  }
  if (value.menuName !== undefined) {
    record.menuName = requireNonEmptyString(value, 'menuName', index);
  }
  if (value.utcDailyReset !== undefined) {
    if (typeof value.utcDailyReset !== 'boolean') {
      throw new SourceParseError(
        `Game-data entry ${index} field \`utcDailyReset\` must be a boolean`,
        0,
      );
    }
    record.utcDailyReset = value.utcDailyReset;
  }
  return record;
}

function requireNonEmptyString(
  value: ParsedObject,
  key: string,
  index: number,
): string {
  const field = value[key];
  if (typeof field !== 'string' || field.trim() === '') {
    throw new SourceParseError(
      `Game-data entry ${index} field \`${key}\` must be a non-empty string`,
      0,
    );
  }
  return field;
}

export function parseUpstreamGameData(source: string): UpstreamGameRecord[] {
  return new Parser(source).parseGameData();
}
