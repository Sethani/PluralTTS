import pg from 'pg';
import type { ChannelBinding, GuildSettings, IgnoredUser, PermissionGrant, PermissionScope, PronunciationEntry, SpeakerNamePronunciation, SpeakerPronunciationEntry, TtsPermission, VoiceMapping } from '../types.js';
import type { Storage } from './Storage.js';

const { Pool } = pg;

export class PgStorage implements Storage {
  private readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      ssl: shouldUseSsl(databaseUrl) ? { rejectUnauthorized: false } : undefined
    });
  }

  async migrate(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS guild_settings (
        guild_id TEXT PRIMARY KEY,
        default_voice_id TEXT NOT NULL,
        announce_names TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        volume DOUBLE PRECISION NOT NULL DEFAULT 1,
        speed DOUBLE PRECISION NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS channel_bindings (
        guild_id TEXT PRIMARY KEY,
        voice_channel_id TEXT NOT NULL,
        text_channel_id TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS voice_mappings (
        guild_id TEXT NOT NULL,
        speaker_id TEXT NOT NULL,
        voice_id TEXT,
        volume DOUBLE PRECISION,
        speed DOUBLE PRECISION,
        PRIMARY KEY (guild_id, speaker_id)
      );

      CREATE TABLE IF NOT EXISTS permission_grants (
        guild_id TEXT NOT NULL,
        permission TEXT NOT NULL,
        scope TEXT NOT NULL,
        role_id TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (guild_id, permission, scope, role_id)
      );

      CREATE TABLE IF NOT EXISTS ignored_users (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS pronunciation_entries (
        guild_id TEXT NOT NULL,
        from_text TEXT NOT NULL,
        to_text TEXT NOT NULL,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (guild_id, from_text)
      );

      CREATE TABLE IF NOT EXISTS speaker_pronunciation_entries (
        guild_id TEXT NOT NULL,
        speaker_id TEXT NOT NULL,
        from_text TEXT NOT NULL,
        to_text TEXT NOT NULL,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (guild_id, speaker_id, from_text)
      );

      CREATE TABLE IF NOT EXISTS speaker_name_pronunciations (
        guild_id TEXT NOT NULL,
        speaker_id TEXT NOT NULL,
        spoken_name TEXT NOT NULL,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (guild_id, speaker_id)
      );
    `);

    await this.pool.query('ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE');
    await this.pool.query('ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS volume DOUBLE PRECISION NOT NULL DEFAULT 1');
    await this.pool.query('ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS speed DOUBLE PRECISION NOT NULL DEFAULT 1');
    await this.pool.query('ALTER TABLE voice_mappings ADD COLUMN IF NOT EXISTS volume DOUBLE PRECISION');
    await this.pool.query('ALTER TABLE voice_mappings ADD COLUMN IF NOT EXISTS speed DOUBLE PRECISION');
  }

  async getGuildSettings(guildId: string): Promise<GuildSettings | undefined> {
    const result = await this.pool.query<StoredGuildSettings>(
      'SELECT guild_id as "guildId", default_voice_id as "defaultVoiceId", announce_names as "announceNames", enabled, volume, speed FROM guild_settings WHERE guild_id = $1',
      [guildId]
    );
    return result.rows[0];
  }

  async upsertGuildSettings(settings: GuildSettings): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO guild_settings (guild_id, default_voice_id, announce_names, enabled, volume, speed)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT(guild_id) DO UPDATE SET
          default_voice_id = excluded.default_voice_id,
          announce_names = excluded.announce_names,
          enabled = excluded.enabled,
          volume = excluded.volume,
          speed = excluded.speed
      `,
      [settings.guildId, settings.defaultVoiceId, settings.announceNames, settings.enabled, settings.volume, settings.speed]
    );
  }

  async getChannelBinding(guildId: string): Promise<ChannelBinding | undefined> {
    const result = await this.pool.query<ChannelBinding>(
      'SELECT guild_id as "guildId", voice_channel_id as "voiceChannelId", text_channel_id as "textChannelId" FROM channel_bindings WHERE guild_id = $1',
      [guildId]
    );
    return result.rows[0];
  }

  async upsertChannelBinding(binding: ChannelBinding): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO channel_bindings (guild_id, voice_channel_id, text_channel_id)
        VALUES ($1, $2, $3)
        ON CONFLICT(guild_id) DO UPDATE SET
          voice_channel_id = excluded.voice_channel_id,
          text_channel_id = excluded.text_channel_id
      `,
      [binding.guildId, binding.voiceChannelId, binding.textChannelId]
    );
  }

  async deleteChannelBinding(guildId: string): Promise<void> {
    await this.pool.query('DELETE FROM channel_bindings WHERE guild_id = $1', [guildId]);
  }

  async getVoiceMapping(guildId: string, speakerId: string): Promise<VoiceMapping | undefined> {
    const result = await this.pool.query<StoredVoiceMapping>(
      'SELECT guild_id as "guildId", speaker_id as "speakerId", voice_id as "voiceId", volume, speed FROM voice_mappings WHERE guild_id = $1 AND speaker_id = $2',
      [guildId, speakerId]
    );
    const row = result.rows[0];
    if (!row) {
      return undefined;
    }

    return {
      guildId: row.guildId,
      speakerId: row.speakerId,
      voiceId: row.voiceId ?? undefined,
      volume: row.volume ?? undefined,
      speed: row.speed ?? undefined
    };
  }

  async upsertVoiceMapping(mapping: VoiceMapping): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO voice_mappings (guild_id, speaker_id, voice_id, volume, speed)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT(guild_id, speaker_id) DO UPDATE SET
          voice_id = excluded.voice_id,
          volume = excluded.volume,
          speed = excluded.speed
      `,
      [mapping.guildId, mapping.speakerId, mapping.voiceId ?? null, mapping.volume ?? null, mapping.speed ?? null]
    );
  }

  async deleteVoiceMapping(guildId: string, speakerId: string): Promise<void> {
    await this.pool.query('DELETE FROM voice_mappings WHERE guild_id = $1 AND speaker_id = $2', [guildId, speakerId]);
  }

  async listPermissionGrants(guildId: string): Promise<PermissionGrant[]> {
    const result = await this.pool.query<StoredPermissionGrant>(
      'SELECT guild_id as "guildId", permission, scope, NULLIF(role_id, \'\') as "roleId" FROM permission_grants WHERE guild_id = $1 ORDER BY permission, scope, role_id',
      [guildId]
    );
    return result.rows;
  }

  async listPermissionGrantsForPermission(guildId: string, permission: TtsPermission): Promise<PermissionGrant[]> {
    const result = await this.pool.query<StoredPermissionGrant>(
      'SELECT guild_id as "guildId", permission, scope, NULLIF(role_id, \'\') as "roleId" FROM permission_grants WHERE guild_id = $1 AND permission = $2 ORDER BY scope, role_id',
      [guildId, permission]
    );
    return result.rows;
  }

  async upsertPermissionGrant(grant: PermissionGrant): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO permission_grants (guild_id, permission, scope, role_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT(guild_id, permission, scope, role_id) DO NOTHING
      `,
      [grant.guildId, grant.permission, grant.scope, grant.scope === 'role' ? grant.roleId ?? '' : '']
    );
  }

  async deletePermissionGrant(guildId: string, permission: TtsPermission, scope: PermissionScope, roleId?: string): Promise<void> {
    await this.pool.query('DELETE FROM permission_grants WHERE guild_id = $1 AND permission = $2 AND scope = $3 AND role_id = $4', [
      guildId,
      permission,
      scope,
      scope === 'role' ? roleId ?? '' : ''
    ]);
  }

  async isUserIgnored(guildId: string, userId: string): Promise<boolean> {
    const result = await this.pool.query('SELECT 1 FROM ignored_users WHERE guild_id = $1 AND user_id = $2', [guildId, userId]);
    return (result.rowCount ?? 0) > 0;
  }

  async upsertIgnoredUser(user: IgnoredUser): Promise<void> {
    await this.pool.query('INSERT INTO ignored_users (guild_id, user_id) VALUES ($1, $2) ON CONFLICT(guild_id, user_id) DO NOTHING', [user.guildId, user.userId]);
  }

  async deleteIgnoredUser(guildId: string, userId: string): Promise<void> {
    await this.pool.query('DELETE FROM ignored_users WHERE guild_id = $1 AND user_id = $2', [guildId, userId]);
  }

  async listPronunciationEntries(guildId: string): Promise<PronunciationEntry[]> {
    const result = await this.pool.query<PronunciationEntry>(
      'SELECT guild_id as "guildId", from_text as "fromText", to_text as "toText" FROM pronunciation_entries WHERE guild_id = $1 ORDER BY from_text',
      [guildId]
    );
    return result.rows;
  }

  async upsertPronunciationEntry(entry: PronunciationEntry): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO pronunciation_entries (guild_id, from_text, to_text, updated_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT(guild_id, from_text) DO UPDATE SET
          to_text = excluded.to_text,
          updated_at = excluded.updated_at
      `,
      [entry.guildId, entry.fromText, entry.toText, Date.now()]
    );
  }

  async deletePronunciationEntry(guildId: string, fromText: string): Promise<void> {
    await this.pool.query('DELETE FROM pronunciation_entries WHERE guild_id = $1 AND lower(from_text) = lower($2)', [guildId, fromText]);
  }

  async listSpeakerPronunciationEntries(guildId: string, speakerId: string): Promise<SpeakerPronunciationEntry[]> {
    const result = await this.pool.query<SpeakerPronunciationEntry>(
      'SELECT guild_id as "guildId", speaker_id as "speakerId", from_text as "fromText", to_text as "toText" FROM speaker_pronunciation_entries WHERE guild_id = $1 AND speaker_id = $2 ORDER BY from_text',
      [guildId, speakerId]
    );
    return result.rows;
  }

  async upsertSpeakerPronunciationEntry(entry: SpeakerPronunciationEntry): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO speaker_pronunciation_entries (guild_id, speaker_id, from_text, to_text, updated_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT(guild_id, speaker_id, from_text) DO UPDATE SET
          to_text = excluded.to_text,
          updated_at = excluded.updated_at
      `,
      [entry.guildId, entry.speakerId, entry.fromText, entry.toText, Date.now()]
    );
  }

  async deleteSpeakerPronunciationEntry(guildId: string, speakerId: string, fromText: string): Promise<void> {
    await this.pool.query('DELETE FROM speaker_pronunciation_entries WHERE guild_id = $1 AND speaker_id = $2 AND lower(from_text) = lower($3)', [guildId, speakerId, fromText]);
  }

  async getSpeakerNamePronunciation(guildId: string, speakerId: string): Promise<SpeakerNamePronunciation | undefined> {
    const result = await this.pool.query<SpeakerNamePronunciation>(
      'SELECT guild_id as "guildId", speaker_id as "speakerId", spoken_name as "spokenName" FROM speaker_name_pronunciations WHERE guild_id = $1 AND speaker_id = $2',
      [guildId, speakerId]
    );
    return result.rows[0];
  }

  async upsertSpeakerNamePronunciation(entry: SpeakerNamePronunciation): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO speaker_name_pronunciations (guild_id, speaker_id, spoken_name, updated_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT(guild_id, speaker_id) DO UPDATE SET
          spoken_name = excluded.spoken_name,
          updated_at = excluded.updated_at
      `,
      [entry.guildId, entry.speakerId, entry.spokenName, Date.now()]
    );
  }

  async deleteSpeakerNamePronunciation(guildId: string, speakerId: string): Promise<void> {
    await this.pool.query('DELETE FROM speaker_name_pronunciations WHERE guild_id = $1 AND speaker_id = $2', [guildId, speakerId]);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

interface StoredGuildSettings extends Omit<GuildSettings, 'announceNames'> {
  announceNames: GuildSettings['announceNames'];
}

interface StoredVoiceMapping extends Omit<VoiceMapping, 'voiceId' | 'volume' | 'speed'> {
  voiceId: string | null;
  volume: number | null;
  speed: number | null;
}

interface StoredPermissionGrant extends PermissionGrant {
  permission: TtsPermission;
  scope: PermissionScope;
}

function shouldUseSsl(databaseUrl: string): boolean {
  const url = new URL(databaseUrl);
  const sslMode = url.searchParams.get('sslmode');
  return sslMode === 'require' || sslMode === 'verify-ca' || sslMode === 'verify-full';
}
