import type { ChannelBinding, GuildSettings, IgnoredUser, PermissionGrant, PermissionScope, PronunciationEntry, SpeakerNamePronunciation, SpeakerPronunciationEntry, TtsPermission, VoiceMapping } from '../types.js';

export interface GuildSettingsRepository {
  getGuildSettings(guildId: string): Promise<GuildSettings | undefined>;
  upsertGuildSettings(settings: GuildSettings): Promise<void>;
}

export interface ChannelBindingRepository {
  getChannelBinding(guildId: string): Promise<ChannelBinding | undefined>;
  upsertChannelBinding(binding: ChannelBinding): Promise<void>;
  deleteChannelBinding(guildId: string): Promise<void>;
}

export interface VoiceMappingRepository {
  getVoiceMapping(guildId: string, speakerId: string): Promise<VoiceMapping | undefined>;
  upsertVoiceMapping(mapping: VoiceMapping): Promise<void>;
  deleteVoiceMapping(guildId: string, speakerId: string): Promise<void>;
}

export interface PermissionGrantRepository {
  listPermissionGrants(guildId: string): Promise<PermissionGrant[]>;
  listPermissionGrantsForPermission(guildId: string, permission: TtsPermission): Promise<PermissionGrant[]>;
  upsertPermissionGrant(grant: PermissionGrant): Promise<void>;
  deletePermissionGrant(guildId: string, permission: TtsPermission, scope: PermissionScope, roleId?: string): Promise<void>;
}

export interface IgnoredUserRepository {
  isUserIgnored(guildId: string, userId: string): Promise<boolean>;
  upsertIgnoredUser(user: IgnoredUser): Promise<void>;
  deleteIgnoredUser(guildId: string, userId: string): Promise<void>;
}

export interface PronunciationRepository {
  listPronunciationEntries(guildId: string): Promise<PronunciationEntry[]>;
  upsertPronunciationEntry(entry: PronunciationEntry): Promise<void>;
  deletePronunciationEntry(guildId: string, fromText: string): Promise<void>;
  listSpeakerPronunciationEntries(guildId: string, speakerId: string): Promise<SpeakerPronunciationEntry[]>;
  upsertSpeakerPronunciationEntry(entry: SpeakerPronunciationEntry): Promise<void>;
  deleteSpeakerPronunciationEntry(guildId: string, speakerId: string, fromText: string): Promise<void>;
  getSpeakerNamePronunciation(guildId: string, speakerId: string): Promise<SpeakerNamePronunciation | undefined>;
  upsertSpeakerNamePronunciation(entry: SpeakerNamePronunciation): Promise<void>;
  deleteSpeakerNamePronunciation(guildId: string, speakerId: string): Promise<void>;
}

export interface Storage extends GuildSettingsRepository, ChannelBindingRepository, VoiceMappingRepository, PermissionGrantRepository, IgnoredUserRepository, PronunciationRepository {
  migrate(): Promise<void>;
  close(): Promise<void>;
}
