import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../src/logger.js';
import { PluralKitClient } from '../src/pluralkit/PluralKitClient.js';

describe('PluralKitClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a stable speaker identity for confirmed proxied messages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      id: 'proxy',
      original: 'original',
      sender: 'user',
      member: { id: 'abcde', name: 'Riley', display_name: 'Riles' }
    }), { status: 200 })));

    const client = new PluralKitClient({ apiBase: 'https://pk.test', userAgent: 'test', timeoutMs: 1000, logger });
    const lookup = await client.lookupMessage('proxy');

    expect(lookup?.speaker).toEqual({ id: 'pluralkit_member:abcde', kind: 'pluralkit_member', displayName: 'Riles' });
    expect(lookup?.originalMessageId).toBe('original');
  });

  it('returns null on missing messages and lookup failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));

    const client = new PluralKitClient({ apiBase: 'https://pk.test', userAgent: 'test', timeoutMs: 1000, logger });

    expect(await client.lookupMessage('missing')).toBeNull();
  });

  it('reports lookup failures with guild context', async () => {
    const onFailure = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));

    const client = new PluralKitClient({ apiBase: 'https://pk.test', userAgent: 'test', timeoutMs: 1000, onFailure, logger });

    expect(await client.lookupMessage('proxy', 'guild-1')).toBeNull();
    expect(onFailure).toHaveBeenCalledWith('guild-1');
  });

  it('backs off after rate limits', async () => {
    const fetchMock = vi.fn(async () => new Response('rate limited', {
      status: 429,
      headers: { 'retry-after': '2' }
    }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new PluralKitClient({ apiBase: 'https://pk.test', userAgent: 'test', timeoutMs: 1000, logger });

    expect(await client.lookupMessage('proxy')).toBeNull();
    expect(await client.lookupMessage('another-proxy')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
