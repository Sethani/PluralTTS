import { describe, expect, it } from 'vitest';
import { normalizeGuildSettings, normalizeVoiceMapping } from '../src/settings.js';

describe('settings normalization', () => {
  it('normalizes missing and invalid guild settings', () => {
    expect(normalizeGuildSettings(undefined, 'g1', 'voice-a')).toEqual({
      guildId: 'g1',
      defaultVoiceId: 'voice-a',
      announceNames: 'on-speaker-change',
      enabled: true,
      volume: 1,
      speed: 1
    });

    expect(normalizeGuildSettings({
      guildId: 'g1',
      defaultVoiceId: '',
      announceNames: 'bad' as never,
      enabled: true,
      volume: 99,
      speed: Number.NaN
    }, 'g1', 'voice-a')).toEqual({
      guildId: 'g1',
      defaultVoiceId: 'voice-a',
      announceNames: 'on-speaker-change',
      enabled: true,
      volume: 2,
      speed: 1
    });
  });

  it('normalizes voice mappings', () => {
    expect(normalizeVoiceMapping({
      guildId: 'g1',
      speakerId: 'discord_user:u1',
      voiceId: ' ',
      volume: -1,
      speed: 3
    })).toEqual({
      guildId: 'g1',
      speakerId: 'discord_user:u1',
      voiceId: undefined,
      volume: 0,
      speed: 2
    });
  });
});
