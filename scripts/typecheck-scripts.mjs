/**
 * Typechecks scripts/ with a Node-only tsconfig.
 *
 * Skipped while scripts/ holds no TypeScript files (Phase 2 adds them), so a
 * fresh checkout can always run `npm run typecheck`.
 */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

function hasTypeScriptFiles(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true, recursive: true }).some(
      (entry) => entry.isFile() && /\.tsx?$/.test(entry.name),
    );
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

if (!hasTypeScriptFiles('scripts')) {
  console.log('scripts/typecheck: no TypeScript files in scripts/, skipped.');
  process.exit(0);
}

const result = spawnSync('tsc', ['-p', 'tsconfig.scripts.json'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);
