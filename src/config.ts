import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().optional(),
  DATABASE_URL: z.string().default('sqlite:./plural-tts.db'),
  TTS_PROVIDER: z.enum(['piper-cli', 'piper-http']).default('piper-cli'),
  PIPER_BIN: z.string().default('piper'),
  PIPER_URL: z.string().url().optional().or(z.literal('')),
  PIPER_VOICES_DIR: z.string().default('./voices'),
  DEFAULT_VOICE_ID: z.string().default('en_US-amy-medium'),
  MAX_QUEUE_LENGTH: z.coerce.number().int().positive().default(25),
  MAX_SPOKEN_LENGTH: z.coerce.number().int().positive().default(500),
  NORMAL_MESSAGE_DELAY_MS: z.coerce.number().int().nonnegative().default(1200),
  SPEAKER_NAME_RESET_MS: z.coerce.number().int().nonnegative().default(300000),
  AUTO_DISCONNECT_MS: z.coerce.number().int().nonnegative().default(300000),
  VOICE_CHANNEL_ONLY: z.coerce.boolean().default(true),
  TTS_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  TTS_RETRY_ATTEMPTS: z.coerce.number().int().nonnegative().default(1),
  TTS_RETRY_DELAY_MS: z.coerce.number().int().nonnegative().default(500),
  PLURALKIT_API_BASE: z.string().url().default('https://api.pluralkit.me/v2'),
  PLURALKIT_USER_AGENT: z.string().min(1).default('PluralTTS/0.1.0'),
  PLURALKIT_LOOKUP_TIMEOUT_MS: z.coerce.number().int().positive().default(3000)
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.parse(env);

  return {
    discord: {
      token: parsed.DISCORD_TOKEN,
      clientId: parsed.DISCORD_CLIENT_ID,
      guildId: parsed.DISCORD_GUILD_ID
    },
    database: {
      url: parsed.DATABASE_URL
    },
    tts: {
      provider: parsed.TTS_PROVIDER,
      piperBin: parsed.PIPER_BIN,
      piperUrl: parsed.PIPER_URL || undefined,
      voicesDir: parsed.PIPER_VOICES_DIR,
      defaultVoiceId: parsed.DEFAULT_VOICE_ID,
      timeoutMs: parsed.TTS_TIMEOUT_MS,
      retryAttempts: parsed.TTS_RETRY_ATTEMPTS,
      retryDelayMs: parsed.TTS_RETRY_DELAY_MS
    },
    queue: {
      maxLength: parsed.MAX_QUEUE_LENGTH
    },
    messages: {
      maxSpokenLength: parsed.MAX_SPOKEN_LENGTH,
      normalMessageDelayMs: parsed.NORMAL_MESSAGE_DELAY_MS,
      speakerNameResetMs: parsed.SPEAKER_NAME_RESET_MS,
      voiceChannelOnly: parsed.VOICE_CHANNEL_ONLY
    },
    voice: {
      autoDisconnectMs: parsed.AUTO_DISCONNECT_MS
    },
    pluralKit: {
      apiBase: parsed.PLURALKIT_API_BASE,
      userAgent: parsed.PLURALKIT_USER_AGENT,
      lookupTimeoutMs: parsed.PLURALKIT_LOOKUP_TIMEOUT_MS
    }
  };
}
