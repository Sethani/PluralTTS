export type SpeakerKind = 'discord_user' | 'pluralkit_member';

export interface Speaker {
  id: string;
  kind: SpeakerKind;
  displayName: string;
}

export interface GuildSettings {
  guildId: string;
  defaultVoiceId: string;
  announceNames: 'on-speaker-change' | 'always' | 'never';
  enabled: boolean;
  volume: number;
  speed: number;
}

export interface ChannelBinding {
  guildId: string;
  voiceChannelId: string;
  textChannelId: string;
}

export interface VoiceMapping {
  guildId: string;
  speakerId: string;
  voiceId?: string;
  volume?: number;
  speed?: number;
}

export type TtsPermission =
  | 'join'
  | 'leave'
  | 'skip'
  | 'clear'
  | 'server_settings'
  | 'speaker_settings';

export type PermissionScope = 'everyone' | 'role';

export interface PermissionGrant {
  guildId: string;
  permission: TtsPermission;
  scope: PermissionScope;
  roleId?: string;
}

export interface IgnoredUser {
  guildId: string;
  userId: string;
}

export interface PronunciationEntry {
  guildId: string;
  fromText: string;
  toText: string;
}

export interface TtsVoice {
  id: string;
  label: string;
  language?: string;
  gender?: string;
}

export interface QueuedSpeech {
  id: string;
  guildId: string;
  text: string;
  speaker: Speaker;
  voiceId: string;
  volume: number;
  speed: number;
  createdAt: number;
}
