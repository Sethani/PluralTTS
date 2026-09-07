import type { GuildSettings, VoiceMapping } from './types.js';

export type AnnounceNames = GuildSettings['announceNames'];

export function normalizeGuildSettings(settings: GuildSettings | undefined, guildId: string, defaultVoiceId: string): GuildSettings {
  return {
    guildId,
    defaultVoiceId: nonEmpty(settings?.defaultVoiceId) ?? defaultVoiceId,
    announceNames: normalizeAnnounceNames(settings?.announceNames),
    enabled: settings?.enabled !== false,
    volume: clampFinite(settings?.volume, 0, 2, 1),
    speed: clampFinite(settings?.speed, 0.5, 2, 1)
  };
}

export function normalizeVoiceMapping(mapping: VoiceMapping | undefined): VoiceMapping | undefined {
  if (!mapping) {
    return undefined;
  }

  return {
    guildId: mapping.guildId,
    speakerId: mapping.speakerId,
    voiceId: nonEmpty(mapping.voiceId),
    volume: mapping.volume === undefined ? undefined : clampFinite(mapping.volume, 0, 2, 1),
    speed: mapping.speed === undefined ? undefined : clampFinite(mapping.speed, 0.5, 2, 1)
  };
}

export function normalizePronunciationText(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function normalizeAnnounceNames(value: unknown): AnnounceNames {
  return value === 'always' || value === 'never' || value === 'on-speaker-change' ? value : 'on-speaker-change';
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function clampFinite(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numeric));
}
