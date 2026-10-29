import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface HeaderBlock {
  pattern: string;
  headers: Map<string, string>;
}

function readRepoFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function parseHeaderBlocks(source: string): HeaderBlock[] {
  const blocks: HeaderBlock[] = [];
  let current: HeaderBlock | undefined;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (trimmed === '' || trimmed.startsWith('#')) {
      current = undefined;
      continue;
    }

    if (!/^\s/.test(line)) {
      current = { pattern: trimmed, headers: new Map() };
      blocks.push(current);
      continue;
    }

    const match = /^\s+([^:]+):\s*(.*)$/.exec(line);
    if (!match || !current) {
      throw new Error(`Malformed _headers line: ${rawLine}`);
    }

    const name = match[1]!.toLowerCase();
    const value = match[2]!.trim();
    const previous = current.headers.get(name);
    current.headers.set(name, previous ? `${previous}, ${value}` : value);
  }

  return blocks;
}

const headerBlocks = parseHeaderBlocks(readRepoFile('public/_headers'));

function blockFor(pattern: string): HeaderBlock {
  const block = headerBlocks.find((candidate) => candidate.pattern === pattern);
  if (!block) throw new Error(`Missing _headers block for ${pattern}`);
  return block;
}

describe('Cloudflare Pages edge configuration', () => {
  it('falls back to index.html for client-side routes', () => {
    expect(readRepoFile('public/_redirects')).toMatch(
      /^\/\*\s+\/index\.html\s+200$/m,
    );
  });

  it('applies baseline security headers to every static response', () => {
    const headers = blockFor('/*').headers;

    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('x-frame-options')).toBe('DENY');
    expect(headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(headers.get('permissions-policy')).toContain('camera=()');
  });

  it('keeps a restrictive content security policy', () => {
    const csp = blockFor('/*').headers.get('content-security-policy');

    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).toContain('https://cdn2.steamgriddb.com');
  });

  it('permits only the Firebase Authentication endpoints for optional sign-in', () => {
    const csp = blockFor('/*').headers.get('content-security-policy') ?? '';

    expect(csp).toContain('https://identitytoolkit.googleapis.com');
    expect(csp).toContain('https://securetoken.googleapis.com');
    expect(csp).toContain('https://www.googleapis.com');
    const connectSources = /connect-src ([^;]+)/.exec(csp)?.[1]?.trim();
    expect(connectSources?.split(/\s+/)).not.toContain('https:');
  });

  it('does not cache HTML responses from the catch-all rule', () => {
    expect(blockFor('/*').headers.has('cache-control')).toBe(false);
  });

  it('caches content-hashed build assets immutably', () => {
    const headers = blockFor('/assets/*').headers;

    expect(headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    );
  });

  it('keeps the manifest scoped to the site root', () => {
    const manifest = JSON.parse(
      readRepoFile('public/manifest.webmanifest'),
    ) as { start_url?: string; scope?: string };

    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
  });
});
