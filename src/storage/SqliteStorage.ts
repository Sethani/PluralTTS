import Database from 'better-sqlite3';
import type { ChannelBinding, GuildSettings, IgnoredUser, PermissionGrant, PermissionScope, PronunciationEntry, SpeakerNamePronunciation, SpeakerPronunciationEntry, TtsPermission, VoiceMapping } from '../types.js';
import type { Storage } from './Storage.js';

type Db = Database.Database;

export class SqliteStorage implements Storage {
  private readonly db: Db;

  constructor(databaseUrl: string) {
    this.db = new Database(parseSqlitePath(databaseUrl));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  async migrate(): Promise<void> {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS guild_settings (
        guild_id TEXT PRIMARY KEY,
        default_voice_id TEXT NOT NULL,
        announce_names TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        volume REAL NOT NULL DEFAULT 1,
        speed REAL NOT NULL DEFAULT 1
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
        volume REAL,
        speed REAL,
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
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, from_text)
      );

      CREATE TABLE IF NOT EXISTS speaker_pronunciation_entries (
        guild_id TEXT NOT NULL,
        speaker_id TEXT NOT NULL,
        from_text TEXT NOT NULL,
        to_text TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, speaker_id, from_text)
      );

      CREATE TABLE IF NOT EXISTS speaker_name_pronunciations (
        guild_id TEXT NOT NULL,
        speaker_id TEXT NOT NULL,
        spoken_name TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, speaker_id)
      );
    `);
    rebuildVoiceMappingsIfVoiceIdIsRequired(this.db);
    addColumnIfMissing(this.db, 'guild_settings', 'enabled', 'INTEGER NOT NULL DEFAULT 1');
    addColumnIfMissing(this.db, 'guild_settings', 'volume', 'REAL NOT NULL DEFAULT 1');
    addColumnIfMissing(this.db, 'guild_settings', 'speed', 'REAL NOT NULL DEFAULT 1');
    addColumnIfMissing(this.db, 'voice_mappings', 'volume', 'REAL');
    addColumnIfMissing(this.db, 'voice_mappings', 'speed', 'REAL');
  }

  async getGuildSettings(guildId: string): Promise<GuildSettings | undefined> {
    const row = this.db
      .prepare('SELECT guild_id as guildId, default_voice_id as defaultVoiceId, announce_names as announceNames, enabled, volume, speed FROM guild_settings WHERE guild_id = ?')
      .get(guildId) as (Omit<GuildSettings, 'enabled'> & { enabled: number }) | undefined;

    return row ? { ...row, enabled: Boolean(row.enabled) } : undefined;
  }

  async upsertGuildSettings(settings: GuildSettings): Promise<void> {
    this.db
      .prepare(`
        INSERT INTO guild_settings (guild_id, default_voice_id, announce_names, enabled, volume, speed)
        VALUES (@guildId, @defaultVoiceId, @announceNames, @enabled, @volume, @speed)
        ON CONFLICT(guild_id) DO UPDATE SET
          default_voice_id = excluded.default_voice_id,
          announce_names = excluded.announce_names,
          enabled = excluded.enabled,
          volume = excluded.volume,
          speed = excluded.speed
      `)
      .run({ ...settings, enabled: settings.enabled ? 1 : 0 });
  }

  async getChannelBinding(guildId: string): Promise<ChannelBinding | undefined> {
    return this.db
      .prepare('SELECT guild_id as guildId, voice_channel_id as voiceChannelId, text_channel_id as textChannelId FROM channel_bindings WHERE guild_id = ?')
      .get(guildId) as ChannelBinding | undefined;
  }

  async upsertChannelBinding(binding: ChannelBinding): Promise<void> {
    this.db
      .prepare(`
        INSERT INTO channel_bindings (guild_id, voice_channel_id, text_channel_id)
        VALUES (@guildId, @voiceChannelId, @textChannelId)
        ON CONFLICT(guild_id) DO UPDATE SET
          voice_channel_id = excluded.voice_channel_id,
          text_channel_id = excluded.text_channel_id
      `)
      .run(binding);
  }

  async deleteChannelBinding(guildId: string): Promise<void> {
    this.db.prepare('DELETE FROM channel_bindings WHERE guild_id = ?').run(guildId);
  }

  async getVoiceMapping(guildId: string, speakerId: string): Promise<VoiceMapping | undefined> {
    const row = this.db
      .prepare('SELECT guild_id as guildId, speaker_id as speakerId, voice_id as voiceId, volume, speed FROM voice_mappings WHERE guild_id = ? AND speaker_id = ?')
      .get(guildId, speakerId) as (VoiceMapping & { voiceId: string | null; volume: number | null; speed: number | null }) | undefined;

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
    this.db
      .prepare(`
        INSERT INTO voice_mappings (guild_id, speaker_id, voice_id, volume, speed)
        VALUES (@guildId, @speakerId, @voiceId, @volume, @speed)
        ON CONFLICT(guild_id, speaker_id) DO UPDATE SET
          voice_id = excluded.voice_id,
          volume = excluded.volume,
          speed = excluded.speed
      `)
      .run({
        guildId: mapping.guildId,
        speakerId: mapping.speakerId,
        voiceId: mapping.voiceId ?? null,
        volume: mapping.volume ?? null,
        speed: mapping.speed ?? null
      });
  }

  async deleteVoiceMapping(guildId: string, speakerId: string): Promise<void> {
    this.db.prepare('DELETE FROM voice_mappings WHERE guild_id = ? AND speaker_id = ?').run(guildId, speakerId);
  }

  async listPermissionGrants(guildId: string): Promise<PermissionGrant[]> {
    const rows = this.db
      .prepare('SELECT guild_id as guildId, permission, scope, role_id as roleId FROM permission_grants WHERE guild_id = ? ORDER BY permission, scope, role_id')
      .all(guildId) as StoredPermissionGrant[];

    return rows.map(toPermissionGrant);
  }

  async listPermissionGrantsForPermission(guildId: string, permission: TtsPermission): Promise<PermissionGrant[]> {
    const rows = this.db
      .prepare('SELECT guild_id as guildId, permission, scope, role_id as roleId FROM permission_grants WHERE guild_id = ? AND permission = ? ORDER BY scope, role_id')
      .all(guildId, permission) as StoredPermissionGrant[];

    return rows.map(toPermissionGrant);
  }

  async upsertPermissionGrant(grant: PermissionGrant): Promise<void> {
    this.db
      .prepare(`
        INSERT INTO permission_grants (guild_id, permission, scope, role_id)
        VALUES (@guildId, @permission, @scope, @roleId)
        ON CONFLICT(guild_id, permission, scope, role_id) DO NOTHING
      `)
      .run({
        guildId: grant.guildId,
        permission: grant.permission,
        scope: grant.scope,
        roleId: grant.scope === 'role' ? grant.roleId ?? '' : ''
      });
  }

  async deletePermissionGrant(guildId: string, permission: TtsPermission, scope: PermissionScope, roleId?: string): Promise<void> {
    this.db
      .prepare('DELETE FROM permission_grants WHERE guild_id = ? AND permission = ? AND scope = ? AND role_id = ?')
      .run(guildId, permission, scope, scope === 'role' ? roleId ?? '' : '');
  }

  async isUserIgnored(guildId: string, userId: string): Promise<boolean> {
    const row = this.db.prepare('SELECT 1 FROM ignored_users WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
    return Boolean(row);
  }

  async upsertIgnoredUser(user: IgnoredUser): Promise<void> {
    this.db
      .prepare('INSERT INTO ignored_users (guild_id, user_id) VALUES (@guildId, @userId) ON CONFLICT(guild_id, user_id) DO NOTHING')
      .run(user);
  }

  async deleteIgnoredUser(guildId: string, userId: string): Promise<void> {
    this.db.prepare('DELETE FROM ignored_users WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
  }

  async listPronunciationEntries(guildId: string): Promise<PronunciationEntry[]> {
    return this.db
      .prepare('SELECT guild_id as guildId, from_text as fromText, to_text as toText FROM pronunciation_entries WHERE guild_id = ? ORDER BY from_text')
      .all(guildId) as PronunciationEntry[];
  }

  async upsertPronunciationEntry(entry: PronunciationEntry): Promise<void> {
    this.db
      .prepare(`
        INSERT INTO pronunciation_entries (guild_id, from_text, to_text, updated_at)
        VALUES (@guildId, @fromText, @toText, @updatedAt)
        ON CONFLICT(guild_id, from_text) DO UPDATE SET
          to_text = excluded.to_text,
          updated_at = excluded.updated_at
      `)
      .run({ ...entry, updatedAt: Date.now() });
  }

  async deletePronunciationEntry(guildId: string, fromText: string): Promise<void> {
    this.db.prepare('DELETE FROM pronunciation_entries WHERE guild_id = ? AND lower(from_text) = lower(?)').run(guildId, fromText);
  }

  async listSpeakerPronunciationEntries(guildId: string, speakerId: string): Promise<SpeakerPronunciationEntry[]> {
    return this.db
      .prepare('SELECT guild_id as guildId, speaker_id as speakerId, from_text as fromText, to_text as toText FROM speaker_pronunciation_entries WHERE guild_id = ? AND speaker_id = ? ORDER BY from_text')
      .all(guildId, speakerId) as SpeakerPronunciationEntry[];
  }

  async upsertSpeakerPronunciationEntry(entry: SpeakerPronunciationEntry): Promise<void> {
    this.db
      .prepare(`
        INSERT INTO speaker_pronunciation_entries (guild_id, speaker_id, from_text, to_text, updated_at)
        VALUES (@guildId, @speakerId, @fromText, @toText, @updatedAt)
        ON CONFLICT(guild_id, speaker_id, from_text) DO UPDATE SET
          to_text = excluded.to_text,
          updated_at = excluded.updated_at
      `)
      .run({ ...entry, updatedAt: Date.now() });
  }

  async deleteSpeakerPronunciationEntry(guildId: string, speakerId: string, fromText: string): Promise<void> {
    this.db.prepare('DELETE FROM speaker_pronunciation_entries WHERE guild_id = ? AND speaker_id = ? AND lower(from_text) = lower(?)').run(guildId, speakerId, fromText);
  }

  async getSpeakerNamePronunciation(guildId: string, speakerId: string): Promise<SpeakerNamePronunciation | undefined> {
    return this.db
      .prepare('SELECT guild_id as guildId, speaker_id as speakerId, spoken_name as spokenName FROM speaker_name_pronunciations WHERE guild_id = ? AND speaker_id = ?')
      .get(guildId, speakerId) as SpeakerNamePronunciation | undefined;
  }

  async upsertSpeakerNamePronunciation(entry: SpeakerNamePronunciation): Promise<void> {
    this.db
      .prepare(`
        INSERT INTO speaker_name_pronunciations (guild_id, speaker_id, spoken_name, updated_at)
        VALUES (@guildId, @speakerId, @spokenName, @updatedAt)
        ON CONFLICT(guild_id, speaker_id) DO UPDATE SET
          spoken_name = excluded.spoken_name,
          updated_at = excluded.updated_at
      `)
      .run({ ...entry, updatedAt: Date.now() });
  }

  async deleteSpeakerNamePronunciation(guildId: string, speakerId: string): Promise<void> {
    this.db.prepare('DELETE FROM speaker_name_pronunciations WHERE guild_id = ? AND speaker_id = ?').run(guildId, speakerId);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

interface StoredPermissionGrant extends Omit<PermissionGrant, 'permission' | 'scope'> {
  permission: TtsPermission;
  scope: PermissionScope;
  roleId: string;
}

function toPermissionGrant(row: StoredPermissionGrant): PermissionGrant {
  return {
    guildId: row.guildId,
    permission: row.permission,
    scope: row.scope,
    roleId: row.roleId || undefined
  };
}

function rebuildVoiceMappingsIfVoiceIdIsRequired(db: Db): void {
  const columns = db.prepare('PRAGMA table_info(voice_mappings)').all() as Array<{ name: string; notnull: number }>;
  const voiceId = columns.find((column) => column.name === 'voice_id');
  if (!voiceId?.notnull) {
    return;
  }

  db.exec(`
    ALTER TABLE voice_mappings RENAME TO voice_mappings_old;

    CREATE TABLE voice_mappings (
      guild_id TEXT NOT NULL,
      speaker_id TEXT NOT NULL,
      voice_id TEXT,
      volume REAL,
      speed REAL,
      PRIMARY KEY (guild_id, speaker_id)
    );

    INSERT INTO voice_mappings (guild_id, speaker_id, voice_id)
    SELECT guild_id, speaker_id, voice_id FROM voice_mappings_old;

    DROP TABLE voice_mappings_old;
  `);
}

function addColumnIfMissing(db: Db, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((existing) => existing.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function parseSqlitePath(databaseUrl: string): string {
  if (databaseUrl === 'sqlite::memory:' || databaseUrl === ':memory:') {
    return ':memory:';
  }

  if (!databaseUrl.startsWith('sqlite:')) {
    throw new Error(`Unsupported DATABASE_URL. Expected sqlite:, got ${databaseUrl}`);
  }

  return databaseUrl.slice('sqlite:'.length);
}
