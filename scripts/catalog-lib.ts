import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeCatalog, serializeCatalog } from '../src/domain/catalog/normalize.ts';
import { parseUpstreamGameData } from '../src/domain/catalog/parseUpstream.ts';
import {
  assertMetadataMatchesCatalog,
  CatalogValidationError,
  countCatalog,
  parseCatalogMetadata,
  parseGameCatalog,
} from '../src/domain/catalog/schema.ts';
import {
  CATALOG_SCHEMA_VERSION,
  type CatalogMetadata,
  type CatalogSource,
  type GameCatalog,
  UPSTREAM_LICENSE,
  UPSTREAM_PATH,
  UPSTREAM_REPOSITORY,
} from '../src/domain/catalog/types.ts';

function resolveDefaultDataDir(): string {
  const url = new URL('../data/', import.meta.url);
  if (url.protocol === 'file:') {
    return path.resolve(fileURLToPath(url));
  }
  // Test runners may serve modules over HTTP; fall back to the working
  // directory, which is the repository root for this project.
  return path.resolve(process.cwd(), 'data');
}

export const DEFAULT_DATA_DIR = resolveDefaultDataDir();
export const CATALOG_FILENAME = 'game-catalog.json';
export const METADATA_FILENAME = 'game-catalog-metadata.json';

const GITHUB_API = 'https://api.github.com/repos/cicerakes/Game-Time-Master';
const RAW_BASE = 'https://raw.githubusercontent.com/cicerakes/Game-Time-Master';
/** Upper bound for the upstream data file; the real file is ~50 KiB. */
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

export interface SyncOptions {
  dataDir?: string;
  commit?: string;
  commitDate?: string;
  retrievedAt?: string;
  /** Read the upstream file from disk instead of the network. */
  sourcePath?: string;
  /** Override the raw URL (used by tests). */
  sourceUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface SyncResult {
  catalog: GameCatalog;
  metadata: CatalogMetadata;
  catalogPath: string;
  metadataPath: string;
  /** True when the deterministic catalog bytes changed. */
  changed: boolean;
}

export interface ValidateOptions {
  dataDir?: string;
}

export interface ValidateResult {
  catalog: GameCatalog;
  metadata: CatalogMetadata;
}

interface CommitInfo {
  sha: string;
  date?: string;
}

export class CatalogSyncError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CatalogSyncError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function fetchCommit(
  sha: string | undefined,
  fetchImpl: typeof fetch,
): Promise<CommitInfo> {
  const url = sha === undefined ? `${GITHUB_API}/commits/master` : `${GITHUB_API}/commits/${sha}`;
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'dailies-catalog-sync',
    },
  });
  if (!response.ok) {
    throw new CatalogSyncError(
      `GitHub commit lookup failed: ${response.status} ${response.statusText}`,
    );
  }
  const payload: unknown = await response.json();
  if (!isRecord(payload)) {
    throw new CatalogSyncError('GitHub commit lookup returned an unexpected body');
  }
  const resolvedSha = payload.sha;
  if (typeof resolvedSha !== 'string' || !/^[0-9a-f]{40}$/.test(resolvedSha)) {
    throw new CatalogSyncError('GitHub commit lookup did not return a commit SHA');
  }
  let date: string | undefined;
  if (isRecord(payload.commit)) {
    const committer = payload.commit.committer;
    if (isRecord(committer) && typeof committer.date === 'string') {
      date = committer.date;
    }
  }
  return { sha: resolvedSha, date };
}

function assertSourceSize(text: string, origin: string): string {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > MAX_SOURCE_BYTES) {
    throw new CatalogSyncError(
      `Upstream source ${origin} is ${bytes} bytes, above the ${MAX_SOURCE_BYTES}-byte limit`,
    );
  }
  return text;
}

async function readUpstreamSource(
  options: SyncOptions,
  commit: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  if (options.sourcePath !== undefined) {
    try {
      const text = await readFile(options.sourcePath, 'utf8');
      return assertSourceSize(text, options.sourcePath);
    } catch (error) {
      if (error instanceof CatalogSyncError) throw error;
      throw new CatalogSyncError(
        `Could not read local upstream source ${options.sourcePath}`,
        { cause: error },
      );
    }
  }
  const url =
    options.sourceUrl ?? `${RAW_BASE}/${commit}/${UPSTREAM_PATH}`;
  const response = await fetchImpl(url, {
    headers: { 'user-agent': 'dailies-catalog-sync' },
  });
  if (!response.ok) {
    throw new CatalogSyncError(
      `Upstream catalog fetch failed: ${response.status} ${response.statusText}`,
    );
  }
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SOURCE_BYTES) {
    throw new CatalogSyncError(
      `Upstream source is ${declaredLength} bytes, above the ${MAX_SOURCE_BYTES}-byte limit`,
    );
  }
  return assertSourceSize(await response.text(), url);
}

function serializeMetadata(metadata: CatalogMetadata): string {
  return `${JSON.stringify(metadata, null, 2)}\n`;
}

function sha256(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readIfExists(filePath: string): Promise<Buffer | undefined> {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (
      isRecord(error) &&
      (error as { code?: unknown }).code === 'ENOENT'
    ) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Writes both artifacts with temporary files and atomic renames. If the
 * metadata rename fails after the catalog rename, the previous catalog bytes
 * are restored so a failed sync never leaves mismatched artifacts.
 */
async function writeArtifacts(
  dataDir: string,
  catalogBytes: string,
  metadataBytes: string,
): Promise<void> {
  const catalogPath = path.join(dataDir, CATALOG_FILENAME);
  const metadataPath = path.join(dataDir, METADATA_FILENAME);
  const token = `${process.pid}-${randomUUID()}`;
  const catalogTemp = path.join(dataDir, `.${CATALOG_FILENAME}.${token}.tmp`);
  const metadataTemp = path.join(dataDir, `.${METADATA_FILENAME}.${token}.tmp`);

  await mkdir(dataDir, { recursive: true });
  const previousCatalog = await readIfExists(catalogPath);

  try {
    await writeFile(catalogTemp, catalogBytes, 'utf8');
    await writeFile(metadataTemp, metadataBytes, 'utf8');
    await rename(catalogTemp, catalogPath);
    try {
      await rename(metadataTemp, metadataPath);
    } catch (error) {
      if (previousCatalog === undefined) {
        await unlink(catalogPath).catch(() => undefined);
      } else {
        await writeFile(catalogPath, previousCatalog);
      }
      throw error;
    }
  } finally {
    await unlink(catalogTemp).catch(() => undefined);
    await unlink(metadataTemp).catch(() => undefined);
  }
}

/**
 * Fetches, parses, normalizes, validates, and atomically writes the catalog.
 * Any upstream or validation failure happens before files are touched.
 */
export async function syncCatalog(options: SyncOptions = {}): Promise<SyncResult> {
  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR;
  const fetchImpl = options.fetchImpl ?? fetch;

  let commit = options.commit;
  let commitDate = options.commitDate;

  if (commit === undefined) {
    if (options.sourcePath !== undefined) {
      throw new CatalogSyncError(
        'A --commit SHA is required when reading a local source',
      );
    }
    const head = await fetchCommit(undefined, fetchImpl);
    commit = head.sha;
    commitDate ??= head.date;
  } else if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new CatalogSyncError(
      'The commit SHA must be 40 lowercase hexadecimal characters',
    );
  }

  if (commitDate === undefined && options.sourcePath === undefined) {
    const info = await fetchCommit(commit, fetchImpl);
    commitDate = info.date;
  }

  const sourceText = await readUpstreamSource(options, commit, fetchImpl);
  const records = parseUpstreamGameData(sourceText);

  const source: CatalogSource = {
    repository: UPSTREAM_REPOSITORY,
    commit,
    path: UPSTREAM_PATH,
    license: UPSTREAM_LICENSE,
  };
  const normalized = normalizeCatalog(records, source);
  const catalogText = serializeCatalog(normalized);

  // Validate the exact bytes that will be written, not just the in-memory
  // object, so serialization or schema drift cannot slip through.
  const catalog = parseGameCatalog(JSON.parse(catalogText));
  const counts = countCatalog(catalog);

  const metadata: CatalogMetadata = {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    catalogSchemaVersion: CATALOG_SCHEMA_VERSION,
    source,
    retrievedAt: options.retrievedAt ?? new Date().toISOString(),
    ...(commitDate === undefined ? {} : { upstreamCommitDate: commitDate }),
    counts,
    catalog: {
      sha256: sha256(catalogText),
      bytes: Buffer.byteLength(catalogText, 'utf8'),
    },
  };
  const metadataText = serializeMetadata(metadata);
  parseCatalogMetadata(JSON.parse(metadataText));
  assertMetadataMatchesCatalog(metadata, catalog);

  const catalogPath = path.join(dataDir, CATALOG_FILENAME);
  const previous = await readIfExists(catalogPath);
  const changed =
    previous === undefined || previous.compare(Buffer.from(catalogText)) !== 0;

  await writeArtifacts(dataDir, catalogText, metadataText);

  return {
    catalog,
    metadata,
    catalogPath,
    metadataPath: path.join(dataDir, METADATA_FILENAME),
    changed,
  };
}

/** Validates the bundled artifacts without touching them. */
export async function validateCatalog(
  options: ValidateOptions = {},
): Promise<ValidateResult> {
  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR;
  const catalogPath = path.join(dataDir, CATALOG_FILENAME);
  const metadataPath = path.join(dataDir, METADATA_FILENAME);

  let catalogBytes: Buffer;
  let metadataText: string;
  try {
    catalogBytes = await readFile(catalogPath);
  } catch (error) {
    throw new CatalogValidationError(
      catalogPath,
      `could not read catalog (${(error as Error).message})`,
    );
  }
  try {
    metadataText = await readFile(metadataPath, 'utf8');
  } catch (error) {
    throw new CatalogValidationError(
      metadataPath,
      `could not read metadata (${(error as Error).message})`,
    );
  }

  let catalogJson: unknown;
  let metadataJson: unknown;
  try {
    catalogJson = JSON.parse(catalogBytes.toString('utf8'));
  } catch (error) {
    throw new CatalogValidationError(
      catalogPath,
      `is not valid JSON (${(error as Error).message})`,
    );
  }
  try {
    metadataJson = JSON.parse(metadataText);
  } catch (error) {
    throw new CatalogValidationError(
      metadataPath,
      `is not valid JSON (${(error as Error).message})`,
    );
  }

  const catalog = parseGameCatalog(catalogJson);
  const metadata = parseCatalogMetadata(metadataJson);
  assertMetadataMatchesCatalog(metadata, catalog);

  if (catalog.source.repository !== UPSTREAM_REPOSITORY) {
    throw new CatalogValidationError(
      'catalog.source.repository',
      `must be ${UPSTREAM_REPOSITORY}`,
    );
  }

  const digest = sha256(catalogBytes);
  if (metadata.catalog.sha256 !== digest) {
    throw new CatalogValidationError(
      'metadata.catalog.sha256',
      'does not match the catalog bytes',
    );
  }
  if (metadata.catalog.bytes !== catalogBytes.byteLength) {
    throw new CatalogValidationError(
      'metadata.catalog.bytes',
      'does not match the catalog bytes',
    );
  }

  return { catalog, metadata };
}

export function describeCatalog(catalog: GameCatalog): string {
  const counts = countCatalog(catalog);
  return `${counts.games} games, ${counts.servers} servers at commit ${catalog.source.commit}`;
}
