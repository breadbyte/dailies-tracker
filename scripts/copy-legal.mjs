/**
 * Copies the catalog attribution and license into the production build.
 *
 * The catalog data is derived from GPL-3.0-only upstream data, so its notices
 * must ship with the deployed application, not only live in the repository.
 */
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const outputDir = path.join('dist', 'licenses');
await mkdir(outputDir, { recursive: true });
await copyFile(
  path.join('data', 'ATTRIBUTION.md'),
  path.join(outputDir, 'ATTRIBUTION.md'),
);
await copyFile(
  path.join('data', 'LICENSE-Game-Time-Master'),
  path.join(outputDir, 'LICENSE-Game-Time-Master'),
);
