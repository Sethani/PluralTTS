import { describe, expect, it } from 'vitest';
import { SqliteStorage } from '../src/storage/SqliteStorage.js';

describe('SqliteStorage', () => {
  it('persists guild settings, bindings, and voice mappings', async () => {
    const storage = new SqliteStorage('sqlite::memory:');
    await storage.migrate();

    await storage.upsertGuildSettings({ guildId: 'g1', defaultVoiceId: 'voice-a', announceNames: 'on-speaker-change', enabled: true, volume: 0.75, speed: 1.25 });
    await storage.upsertChannelBinding({ guildId: 'g1', voiceChannelId: 'v1', textChannelId: 't1' });
    await storage.upsertVoiceMapping({ guildId: 'g1', speakerId: 'discord_user:u1', voiceId: 'voice-b', volume: 0.5, speed: 1.5 });
    await storage.upsertPermissionGrant({ guildId: 'g1', permission: 'join', scope: 'everyone' });
    await storage.upsertPermissionGrant({ guildId: 'g1', permission: 'server_settings', scope: 'role', roleId: 'r1' });
    await storage.upsertIgnoredUser({ guildId: 'g1', userId: 'u1' });
    await storage.upsertPronunciationEntry({ guildId: 'g1', fromText: 'Ada', toText: 'Ay-duh' });
    await storage.upsertSpeakerPronunciationEntry({ guildId: 'g1', speakerId: 'pluralkit_member:m1', fromText: 'home', toText: 'hame' });
    await storage.upsertSpeakerNamePronunciation({ guildId: 'g1', speakerId: 'pluralkit_member:m1', spokenName: 'Rye-lee' });

    expect(await storage.getGuildSettings('g1')).toEqual({ guildId: 'g1', defaultVoiceId: 'voice-a', announceNames: 'on-speaker-change', enabled: true, volume: 0.75, speed: 1.25 });
    expect(await storage.getChannelBinding('g1')).toEqual({ guildId: 'g1', voiceChannelId: 'v1', textChannelId: 't1' });
    expect(await storage.getVoiceMapping('g1', 'discord_user:u1')).toEqual({ guildId: 'g1', speakerId: 'discord_user:u1', voiceId: 'voice-b', volume: 0.5, speed: 1.5 });
    expect(await storage.isUserIgnored('g1', 'u1')).toBe(true);
    expect(await storage.listPronunciationEntries('g1')).toEqual([{ guildId: 'g1', fromText: 'Ada', toText: 'Ay-duh' }]);
    expect(await storage.listSpeakerPronunciationEntries('g1', 'pluralkit_member:m1')).toEqual([
      { guildId: 'g1', speakerId: 'pluralkit_member:m1', fromText: 'home', toText: 'hame' }
    ]);
    expect(await storage.getSpeakerNamePronunciation('g1', 'pluralkit_member:m1')).toEqual({
      guildId: 'g1',
      speakerId: 'pluralkit_member:m1',
      spokenName: 'Rye-lee'
    });
    expect(await storage.listPermissionGrants('g1')).toEqual([
      { guildId: 'g1', permission: 'join', scope: 'everyone' },
      { guildId: 'g1', permission: 'server_settings', scope: 'role', roleId: 'r1' }
    ]);
    expect(await storage.listPermissionGrantsForPermission('g1', 'server_settings')).toEqual([
      { guildId: 'g1', permission: 'server_settings', scope: 'role', roleId: 'r1' }
    ]);

    await storage.deleteVoiceMapping('g1', 'discord_user:u1');
    expect(await storage.getVoiceMapping('g1', 'discord_user:u1')).toBeUndefined();
    await storage.deletePermissionGrant('g1', 'join', 'everyone');
    expect(await storage.listPermissionGrantsForPermission('g1', 'join')).toEqual([]);
    await storage.deleteIgnoredUser('g1', 'u1');
    expect(await storage.isUserIgnored('g1', 'u1')).toBe(false);
    await storage.deletePronunciationEntry('g1', 'Ada');
    expect(await storage.listPronunciationEntries('g1')).toEqual([]);
    await storage.deleteSpeakerPronunciationEntry('g1', 'pluralkit_member:m1', 'home');
    expect(await storage.listSpeakerPronunciationEntries('g1', 'pluralkit_member:m1')).toEqual([]);
    await storage.deleteSpeakerNamePronunciation('g1', 'pluralkit_member:m1');
    expect(await storage.getSpeakerNamePronunciation('g1', 'pluralkit_member:m1')).toBeUndefined();

    await storage.deleteChannelBinding('g1');
    expect(await storage.getChannelBinding('g1')).toBeUndefined();
    await storage.close();
  });
});
