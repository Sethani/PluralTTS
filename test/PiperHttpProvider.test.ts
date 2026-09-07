import { afterEach, describe, expect, it, vi } from 'vitest';
import { PiperHttpProvider } from '../src/tts/PiperHttpProvider.js';

describe('PiperHttpProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists voices from the sidecar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      voices: [
        { id: 'Dave', label: 'Dave', language: 'en_GB', gender: 'masculine' },
        { id: 'Jenny', label: 'Jenny', language: 'en_GB', gender: 'feminine' }
      ]
    }), { status: 200 })));

    const provider = new PiperHttpProvider('http://127.0.0.1:18950', 1000);

    expect(await provider.listVoices()).toEqual([
      { id: 'Dave', label: 'Dave', language: 'en_GB', gender: 'masculine' },
      { id: 'Jenny', label: 'Jenny', language: 'en_GB', gender: 'feminine' }
    ]);
  });

  it('posts synthesis requests to /synthesize', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'content-type': 'audio/wav' }
    }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new PiperHttpProvider('http://127.0.0.1:18950', 1000);
    await provider.synthesize({ text: 'hello', voiceId: 'Dave', speed: 2, style: 'happy' });

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:18950/synthesize', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ text: 'hello', voiceId: 'Dave', speed: 2 })
    }));
  });

  it('rejects non-audio synthesis responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'nope' }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })));

    const provider = new PiperHttpProvider('http://127.0.0.1:18950', 1000);

    await expect(provider.synthesize({ text: 'hello', voiceId: 'Dave' })).rejects.toThrow('returned application/json');
  });

  it('rejects empty synthesis responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, {
      status: 200,
      headers: { 'content-type': 'audio/wav', 'content-length': '0' }
    })));

    const provider = new PiperHttpProvider('http://127.0.0.1:18950', 1000);

    await expect(provider.synthesize({ text: 'hello', voiceId: 'Dave' })).rejects.toThrow('empty audio response');
  });
});
