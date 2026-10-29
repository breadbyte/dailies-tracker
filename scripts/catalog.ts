#!/usr/bin/env node
/**
 * Catalog maintenance CLI.
 *
 *   node --experimental-strip-types scripts/catalog.ts sync [--commit <sha>]
 *     [--source <file>] [--commit-date <iso>] [--retrieved-at <iso>]
 *     [--data-dir <dir>]
 *   node --experimental-strip-types scripts/catalog.ts validate [--data-dir <dir>]
 *
 * `sync` is the only command that uses the network by default. It parses the
 * upstream JavaScript as data, validates the normalized result, and only then
 * writes the bundled artifacts. `validate` never writes.
 */
import {
  DEFAULT_DATA_DIR,
  describeCatalog,
  syncCatalog,
  validateCatalog,
} from './catalog-lib.ts';

interface ParsedArgs {
  command: string;
  dataDir: string;
  commit?: string;
  commitDate?: string;
  retrievedAt?: string;
  sourcePath?: string;
}

const USAGE = `Usage:
  node --experimental-strip-types scripts/catalog.ts sync [--commit <sha>]
    [--source <file>] [--commit-date <iso>] [--retrieved-at <iso>]
    [--data-dir <dir>]
  node --experimental-strip-types scripts/catalog.ts validate [--data-dir <dir>]`;

function parseArgs(argv: readonly string[]): ParsedArgs {
  const [command, ...rest] = argv;
  if (command !== 'sync' && command !== 'validate') {
    throw new Error(USAGE);
  }

  const parsed: ParsedArgs = { command, dataDir: DEFAULT_DATA_DIR };
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    const value = rest[index + 1];
    const takeValue = (): string => {
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${flag} requires a value`);
      }
      index += 1;
      return value;
    };

    switch (flag) {
      case '--data-dir':
        parsed.dataDir = takeValue();
        break;
      case '--commit':
        parsed.commit = takeValue();
        break;
      case '--commit-date':
        parsed.commitDate = takeValue();
        break;
      case '--retrieved-at':
        parsed.retrievedAt = takeValue();
        break;
      case '--source':
        parsed.sourcePath = takeValue();
        break;
      default:
        throw new Error(`Unknown option ${flag}\n${USAGE}`);
    }
  }

  if (parsed.command === 'validate') {
    for (const [flag, value] of [
      ['--commit', parsed.commit],
      ['--commit-date', parsed.commitDate],
      ['--retrieved-at', parsed.retrievedAt],
      ['--source', parsed.sourcePath],
    ] as const) {
      if (value !== undefined) {
        throw new Error(`${flag} is only valid with the sync command`);
      }
    }
  }

  return parsed;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === 'sync') {
    const result = await syncCatalog({
      dataDir: args.dataDir,
      commit: args.commit,
      commitDate: args.commitDate,
      retrievedAt: args.retrievedAt,
      sourcePath: args.sourcePath,
    });
    console.log(
      `Catalog ${result.changed ? 'written' : 'unchanged'}: ${describeCatalog(result.catalog)}.`,
    );
    console.log(`  catalog:  ${result.catalogPath}`);
    console.log(`  metadata: ${result.metadataPath}`);
    return 0;
  }

  const result = await validateCatalog({ dataDir: args.dataDir });
  console.log(`Catalog valid: ${describeCatalog(result.catalog)}.`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
