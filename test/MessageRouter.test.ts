import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../src/logger.js';
import { MessageRouter } from '../src/messages/MessageRouter.js';
import { Metrics } from '../src/metrics/Metrics.js';
import type { AppConfig } from '../src/config.js';
import type { Storage } from '../src/storage/Storage.js';
import type { QueuedSpeech } from '../src/types.js';

const config = {
  tts: { defaultVoiceId: 'Default', retryAttempts: 1, retryDelayMs: 0, timeoutMs: 1000 },
  messages: { maxSpokenLength: 500, normalMessageDelayMs: 0, speakerNameResetMs: 300000, voiceChannelOnly: false },
  queue: { maxLength: 25 },
  voice: { autoDisconnectMs: 0 },
  discord: { token: 'token', clientId: 'client' },
  database: { url: 'sqlite::memory:' },
  pluralKit: { apiBase: 'https://pk.test', userAgent: 'test', lookupTimeoutMs: 1000 }
} as AppConfig;

describe('MessageRouter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('falls back from a missing speaker voice and applies pronunciation before queueing', async () => {
    const enqueued: QueuedSpeech[] = [];
    const router = createRouter({
      playback: { enqueue: (item: QueuedSpeech) => enqueued.push(item) > 0 },
      tts: { listVoices: vi.fn(async () => [{ id: 'Default', label: 'Default' }]) },
      storage: {
        getVoiceMapping: vi.fn(async () => ({ guildId: 'g1', speakerId: 'pluralkit_member:m1', voiceId: 'Missing' })),
        listPronunciationEntries: vi.fn(async () => [{ guildId: 'g1', fromText: 'Ada', toText: 'Ay-duh' }])
      },
      pluralKit: {
        lookupMessage: vi.fn(async () => ({
          proxyMessageId: 'm1',
          speaker: { id: 'pluralkit_member:m1', kind: 'pluralkit_member', displayName: 'Riley' }
        }))
      }
    });

    await router.handleMessage(fakeMessage({ webhookId: 'webhook', content: 'Ada 🙂' }));

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.voiceId).toBe('Default');
    expect(enqueued[0]?.text).toBe('Riley says: Ay-duh slightly smiling face');
  });

  it('applies speaker pronunciations and spoken-name overrides', async () => {
    const enqueued: QueuedSpeech[] = [];
    const router = createRouter({
      playback: { enqueue: (item: QueuedSpeech) => enqueued.push(item) > 0 },
      storage: {
        listPronunciationEntries: vi.fn(async () => [{ guildId: 'g1', fromText: 'home', toText: 'hohm' }]),
        listSpeakerPronunciationEntries: vi.fn(async () => [
          { guildId: 'g1', speakerId: 'pluralkit_member:m1', fromText: 'home', toText: 'hame' },
          { guildId: 'g1', speakerId: 'pluralkit_member:m1', fromText: 'Ada', toText: 'Ay-duh' }
        ]),
        getSpeakerNamePronunciation: vi.fn(async () => ({ guildId: 'g1', speakerId: 'pluralkit_member:m1', spokenName: 'Rye-lee' }))
      },
      pluralKit: {
        lookupMessage: vi.fn(async () => ({
          proxyMessageId: 'm1',
          speaker: { id: 'pluralkit_member:m1', kind: 'pluralkit_member', displayName: 'Riley' }
        }))
      }
    });

    await router.handleMessage(fakeMessage({ webhookId: 'webhook', content: 'Ada went home' }));

    expect(enqueued[0]?.text).toBe('Rye-lee says: Ay-duh went hame');
  });

  it('resolves legacy label voice settings to canonical voice IDs', async () => {
    const enqueued: QueuedSpeech[] = [];
    const router = createRouter({
      playback: { enqueue: (item: QueuedSpeech) => enqueued.push(item) > 0 },
      tts: { listVoices: vi.fn(async () => [{ id: 'en_GB-northern_english_male-medium', label: 'Dave' }]) },
      pluralKit: { lookupMessage: vi.fn(async () => confirmedLookup()) },
      storage: {
        getGuildSettings: vi.fn(async () => ({
          guildId: 'g1',
          defaultVoiceId: 'Dave',
          announceNames: 'on-speaker-change',
          enabled: true,
          volume: 1,
          speed: 1
        }))
      }
    });

    await router.handleMessage(fakeMessage({ webhookId: 'webhook', content: 'hello' }));

    expect(enqueued[0]?.voiceId).toBe('en_GB-northern_english_male-medium');
  });

  it('keeps canonical voice IDs when selected directly', async () => {
    const enqueued: QueuedSpeech[] = [];
    const router = createRouter({
      playback: { enqueue: (item: QueuedSpeech) => enqueued.push(item) > 0 },
      tts: { listVoices: vi.fn(async () => [{ id: 'en_GB-alan-medium', label: 'Alan' }]) },
      pluralKit: { lookupMessage: vi.fn(async () => confirmedLookup()) },
      storage: {
        getGuildSettings: vi.fn(async () => ({
          guildId: 'g1',
          defaultVoiceId: 'en_GB-alan-medium',
          announceNames: 'on-speaker-change',
          enabled: true,
          volume: 1,
          speed: 1
        }))
      }
    });

    await router.handleMessage(fakeMessage({ webhookId: 'webhook', content: 'hello' }));

    expect(enqueued[0]?.voiceId).toBe('en_GB-alan-medium');
  });

  it('does not queue ignored normal Discord users', async () => {
    vi.useFakeTimers();
    const enqueue = vi.fn();
    const router = createRouter({
      playback: { enqueue },
      storage: { isUserIgnored: vi.fn(async () => true) },
      pluralKit: { lookupMessage: vi.fn(async () => null) }
    });

    await router.handleMessage(fakeMessage({ content: 'hello' }));
    await vi.runAllTimersAsync();

    expect(enqueue).not.toHaveBeenCalled();
  });
});

function createRouter(overrides: {
  storage?: Partial<Storage>;
  playback?: { enqueue?: (item: QueuedSpeech) => boolean };
  pluralKit?: { lookupMessage?: (messageId: string, guildId?: string) => Promise<unknown> };
  tts?: { listVoices?: () => Promise<Array<{ id: string; label: string }>> };
} = {}): MessageRouter {
  const storage = {
    getChannelBinding: vi.fn(async () => ({ guildId: 'g1', voiceChannelId: 'v1', textChannelId: 't1' })),
    getGuildSettings: vi.fn(async () => ({ guildId: 'g1', defaultVoiceId: 'Default', announceNames: 'on-speaker-change', enabled: true, volume: 1, speed: 1 })),
    getVoiceMapping: vi.fn(async () => undefined),
    listPronunciationEntries: vi.fn(async () => []),
    listSpeakerPronunciationEntries: vi.fn(async () => []),
    getSpeakerNamePronunciation: vi.fn(async () => undefined),
    isUserIgnored: vi.fn(async () => false),
    ...overrides.storage
  } as unknown as Storage;

  return new MessageRouter({
    config,
    storage,
    playback: { enqueue: vi.fn(() => true), ...overrides.playback } as never,
    pluralKit: { lookupMessage: vi.fn(async () => null), ...overrides.pluralKit } as never,
    tts: { listVoices: vi.fn(async () => [{ id: 'Default', label: 'Default' }]), synthesize: vi.fn(), ...overrides.tts } as never,
    metrics: new Metrics(),
    logger
  });
}

function confirmedLookup() {
  return {
    proxyMessageId: 'm1',
    speaker: { id: 'pluralkit_member:m1', kind: 'pluralkit_member', displayName: 'Riley' }
  };
}

function fakeMessage(overrides: { content?: string; webhookId?: string | null } = {}) {
  return {
    id: 'm1',
    guildId: 'g1',
    channelId: 't1',
    content: overrides.content ?? 'hello',
    webhookId: overrides.webhookId ?? null,
    author: { id: 'u1', bot: false, displayName: 'Ada' },
    client: { user: { id: 'bot' } },
    member: { displayName: 'Ada' },
    guild: {
      id: 'g1',
      members: { cache: new Map(), fetch: vi.fn() },
      channels: { cache: new Map() },
      roles: { cache: new Map() }
    }
  } as never;
}
