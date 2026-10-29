import { describe, expect, it, vi } from 'vitest';
import {
  selectArtworkImage,
  type ArtworkCacheEntry,
  type ArtworkImage,
} from '../../../src/domain/artwork/types.ts';
import {
  createArtworkClient,
  type ArtworkCache,
} from '../../../src/services/artwork/steamGridDb.ts';

const NOW = new Date('2026-10-29T12:00:00.000Z');

function image(
  id: number,
  score: number,
  overrides: Partial<ArtworkImage> = {},
): ArtworkImage {
  return {
    id,
    score,
    width: 600,
    height: 900,
    url: `https://cdn.example/${id}.png`,
    thumb: `https://cdn.example/thumb/${id}.jpg`,
    ...overrides,
  };
}

function payload(images: ArtworkImage[]) {
  return {
    match: { id: 9569, name: 'Stardew Valley' },
    images,
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: init.headers,
  });
}

class MemoryCache implements ArtworkCache {
  readonly entries = new Map<string, ArtworkCacheEntry>();

  async read(key: string): Promise<ArtworkCacheEntry | undefined> {
    return this.entries.get(key);
  }

  async write(entry: ArtworkCacheEntry): Promise<void> {
    this.entries.set(entry.key, entry);
  }
}

function options(fetcher: typeof fetch, cache = new MemoryCache()) {
  return {
    fetcher,
    cache,
    now: () => NOW,
    sleep: vi.fn(async () => {}),
    random: () => 0,
    minIntervalMs: 0,
    proxyBaseUrl: 'https://proxy.example',
  };
}

describe('SteamGridDB artwork client', () => {
  it('fetches lazily, caches across lookups, and keeps the API response order', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(jsonResponse(payload([image(1, 0), image(2, 10), image(3, 4)]))) as unknown as typeof fetch;
    const cache = new MemoryCache();
    const client = createArtworkClient(options(fetcher, cache));

    const first = await client.lookup('  Stardew Valley ');
    expect(first?.match?.name).toBe('Stardew Valley');
    expect(first?.images.map((item) => item.id)).toEqual([1, 2, 3]);
    expect(selectArtworkImage(first?.images ?? [])?.id).toBe(2);
    expect(selectArtworkImage(first?.images ?? [], 1)?.id).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetcher).mock.calls[0]?.[0])).toBe(
      'https://proxy.example/api/v1/artwork?name=Stardew%20Valley',
    );

    const second = await client.lookup('stardew valley');
    expect(second).toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(cache.entries.get('stardew valley')?.status).toBe('ok');
  });

  it('deduplicates concurrent lookups for the same game', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    ) as unknown as typeof fetch;
    const client = createArtworkClient(options(fetcher));

    const first = client.lookup('Stardew Valley');
    const second = client.lookup('stardew valley');

    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    resolveFetch?.(jsonResponse(payload([image(1, 5)])));

    await expect(first).resolves.toMatchObject({ images: [image(1, 5)] });
    await expect(second).resolves.toMatchObject({ images: [image(1, 5)] });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('honors Retry-After and retries a bounded number of times', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: 'upstream_unavailable' },
          { status: 429, headers: { 'retry-after': '2' } },
        ),
      )
      .mockResolvedValueOnce(jsonResponse(payload([image(1, 5)]))) as unknown as typeof fetch;
    const opts = options(fetcher);
    const client = createArtworkClient(opts);

    await expect(client.lookup('Stardew Valley')).resolves.toMatchObject({
      images: [image(1, 5)],
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(opts.sleep).toHaveBeenCalledWith(2000);
  });

  it('stops after three attempts and serves the failure cache', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({ error: 'rate_limited' }, { status: 429 }),
    ) as unknown as typeof fetch;
    const cache = new MemoryCache();
    const client = createArtworkClient(options(fetcher, cache));

    await expect(client.lookup('Stardew Valley')).resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(cache.entries.get('stardew valley')?.status).toBe('error');

    await expect(client.lookup('Stardew Valley')).resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('caches a missing match and does not keep asking', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(jsonResponse({ match: null, images: [] })) as unknown as typeof fetch;
    const cache = new MemoryCache();
    const client = createArtworkClient(options(fetcher, cache));

    await expect(client.lookup('No Such Game')).resolves.toEqual({
      match: null,
      images: [],
    });
    expect(cache.entries.get('no such game')?.status).toBe('no-match');

    await expect(client.lookup('No Such Game')).resolves.toEqual({
      match: null,
      images: [],
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('falls back when the network fails or the proxy returns unsafe data', async () => {
    const offline = vi
      .fn()
      .mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    await expect(
      createArtworkClient(options(offline)).lookup('Stardew Valley'),
    ).resolves.toBeNull();
    expect(offline).toHaveBeenCalledTimes(3);

    const unsafe = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(payload([image(1, 5, { url: 'http://insecure.example/1.png' })])),
      ) as unknown as typeof fetch;
    await expect(
      createArtworkClient(options(unsafe)).lookup('Stardew Valley'),
    ).resolves.toBeNull();
  });
});
