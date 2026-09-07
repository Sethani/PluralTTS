import type { Message, PartialMessage } from 'discord.js';
import type { Logger } from 'pino';
import type { AppConfig } from '../config.js';
import { PluralKitClient } from '../pluralkit/PluralKitClient.js';
import type { GuildPlayback } from '../playback/GuildPlayback.js';
import type { Storage } from '../storage/Storage.js';
import type { QueuedSpeech, Speaker, TtsVoice } from '../types.js';
import type { Metrics } from '../metrics/Metrics.js';
import type { TtsProvider } from '../tts/TtsProvider.js';
import { normalizeGuildSettings, normalizeVoiceMapping } from '../settings.js';
import { preprocessMessage } from './preprocess.js';

interface PendingNormalMessage {
  timer: NodeJS.Timeout;
}

interface LastAnnouncedSpeaker {
  speakerId: string;
  at: number;
}

export class MessageRouter {
  private readonly pending = new Map<string, PendingNormalMessage>();
  private readonly lastSpeakers = new Map<string, Speaker>();
  private readonly lastAnnouncedSpeakers = new Map<string, LastAnnouncedSpeaker>();
  private voiceCache?: { voices: TtsVoice[]; expiresAt: number };

  constructor(
    private readonly options: {
      config: AppConfig;
      storage: Storage;
      playback: GuildPlayback;
      pluralKit: PluralKitClient;
      tts: TtsProvider;
      metrics: Metrics;
      logger: Logger;
    }
  ) {}

  async handleMessage(message: Message): Promise<void> {
    if (!message.guild || !message.channelId) {
      return;
    }

    if (message.author.id === message.client.user?.id) {
      return;
    }

    const binding = await this.options.storage.getChannelBinding(message.guild.id);
    if (!binding || binding.textChannelId !== message.channelId) {
      return;
    }

    this.options.metrics.increment(message.guild.id, 'messagesReceived');

    const settings = await this.options.storage.getGuildSettings(message.guild.id);
    if (settings && !settings.enabled) {
      this.options.metrics.increment(message.guild.id, 'messagesIgnored');
      return;
    }

    if (message.webhookId) {
      await this.handleWebhookMessage(message, binding.voiceChannelId);
      return;
    }

    if (message.author.bot) {
      this.options.metrics.increment(message.guild.id, 'messagesIgnored');
      return;
    }

    this.pending.set(message.id, {
      timer: setTimeout(() => {
        this.pending.delete(message.id);
        void this.enqueueNormalMessage(message, binding.voiceChannelId);
      }, this.options.config.messages.normalMessageDelayMs)
    });
  }

  handleMessageDelete(message: Message | PartialMessage): void {
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    this.options.logger.debug({ messageId: message.id }, 'Cancelled delayed message after deletion');
  }

  getLastSpeaker(guildId: string): Speaker | undefined {
    return this.lastSpeakers.get(guildId);
  }

  private async handleWebhookMessage(message: Message, voiceChannelId: string): Promise<void> {
    const lookup = await this.options.pluralKit.lookupMessage(message.id, message.guildId!, {
      attempts: this.options.config.pluralKit.webhookLookupAttempts,
      retryDelayMs: this.options.config.pluralKit.webhookLookupDelayMs
    });
    if (!lookup) {
      this.options.metrics.increment(message.guildId!, 'messagesIgnored');
      return;
    }

    if (this.options.config.messages.voiceChannelOnly && (!lookup.senderId || !(await this.isUserInVoiceChannel(message, lookup.senderId, voiceChannelId)))) {
      this.options.metrics.increment(message.guildId!, 'messagesIgnored');
      return;
    }

    await this.enqueue(message, lookup.speaker, lookup.speaker.displayName);
  }

  private async enqueueNormalMessage(message: Message, voiceChannelId: string): Promise<void> {
    const lookup = await this.options.pluralKit.lookupMessage(message.id, message.guildId!);
    if (lookup) {
      this.options.metrics.increment(message.guildId!, 'messagesIgnored');
      return;
    }

    if (await this.options.storage.isUserIgnored(message.guildId!, message.author.id)) {
      this.options.metrics.increment(message.guildId!, 'messagesIgnored');
      return;
    }

    if (this.options.config.messages.voiceChannelOnly && !(await this.isUserInVoiceChannel(message, message.author.id, voiceChannelId))) {
      this.options.metrics.increment(message.guildId!, 'messagesIgnored');
      return;
    }

    await this.enqueue(message, {
      id: `discord_user:${message.author.id}`,
      kind: 'discord_user',
      displayName: message.member?.displayName ?? message.author.displayName
    });
  }

  private async enqueue(message: Message, speaker: Speaker, announceName = speaker.displayName): Promise<void> {
    this.lastSpeakers.set(message.guildId!, speaker);
    const settings = normalizeGuildSettings(await this.options.storage.getGuildSettings(message.guildId!), message.guildId!, this.options.config.tts.defaultVoiceId);
    const mapping = normalizeVoiceMapping(await this.options.storage.getVoiceMapping(message.guildId!, speaker.id));
    const voiceId = await this.resolveVoiceId(message.guildId!, mapping?.voiceId, settings.defaultVoiceId);
    if (!voiceId) {
      this.options.metrics.increment(message.guildId!, 'ttsFailures');
      this.options.metrics.increment(message.guildId!, 'messagesIgnored');
      this.options.logger.warn({ guildId: message.guildId, speakerId: speaker.id }, 'No TTS voices available; skipped message');
      return;
    }

    const volume = clamp(settings.volume * (mapping?.volume ?? 1), 0, 2);
    const speed = clamp(mapping?.speed ?? settings.speed, 0.5, 2);
    const pronunciations = await this.options.storage.listPronunciationEntries(message.guildId!);
    const spoken = preprocessMessage(message.content, {
      maxLength: this.options.config.messages.maxSpokenLength,
      pronunciations,
      mentions: {
        user: (id) => message.guild?.members.cache.get(id)?.displayName,
        channel: (id) => message.guild?.channels.cache.get(id)?.name,
        role: (id) => message.guild?.roles.cache.get(id)?.name
      }
    });

    if (!spoken) {
      this.options.metrics.increment(message.guildId!, 'messagesIgnored');
      return;
    }

    const announceNames = settings?.announceNames ?? 'on-speaker-change';
    const lastAnnounced = this.lastAnnouncedSpeakers.get(message.guildId!);
    const resetMs = this.options.config.messages.speakerNameResetMs;
    const lastSpeakerExpired = resetMs > 0 && lastAnnounced ? Date.now() - lastAnnounced.at >= resetMs : false;
    const shouldAnnounce =
      announceNames === 'always' ||
      (announceNames === 'on-speaker-change' && (!lastAnnounced || lastAnnounced.speakerId !== speaker.id || lastSpeakerExpired));
    const text = shouldAnnounce ? `${announceName} says: ${spoken}` : spoken;

    if (shouldAnnounce) {
      this.lastAnnouncedSpeakers.set(message.guildId!, { speakerId: speaker.id, at: Date.now() });
    }

    const item: QueuedSpeech = {
      id: message.id,
      guildId: message.guildId!,
      text,
      speaker,
      voiceId,
      volume,
      speed,
      createdAt: Date.now()
    };

    const accepted = this.options.playback.enqueue(item);
    if (accepted) {
      this.options.metrics.increment(message.guildId!, 'messagesQueued');
    }
  }

  private async isUserInVoiceChannel(message: Message, userId: string, voiceChannelId: string): Promise<boolean> {
    const member = message.guild?.members.cache.get(userId) ?? (await message.guild?.members.fetch(userId).catch(() => undefined));
    return member?.voice.channelId === voiceChannelId;
  }

  private async resolveVoiceId(guildId: string, preferredVoiceId: string | undefined, defaultVoiceId: string): Promise<string | undefined> {
    const voices = await this.listVoicesCached(guildId);
    if (voices.length === 0) {
      return undefined;
    }

    if (preferredVoiceId && voices.some((voice) => voice.id === preferredVoiceId)) {
      return preferredVoiceId;
    }

    if (voices.some((voice) => voice.id === defaultVoiceId)) {
      if (preferredVoiceId) {
        this.options.logger.warn({ guildId, preferredVoiceId, fallbackVoiceId: defaultVoiceId }, 'Configured speaker voice is unavailable; using server default');
      }
      return defaultVoiceId;
    }

    const fallbackVoiceId = voices[0]?.id;
    this.options.logger.warn({ guildId, preferredVoiceId, defaultVoiceId, fallbackVoiceId }, 'Configured default voice is unavailable; using first provider voice');
    return fallbackVoiceId;
  }

  private async listVoicesCached(guildId: string): Promise<TtsVoice[]> {
    if (this.voiceCache && this.voiceCache.expiresAt > Date.now()) {
      return this.voiceCache.voices;
    }

    try {
      const voices = await this.options.tts.listVoices();
      this.voiceCache = { voices, expiresAt: Date.now() + 60_000 };
      return voices;
    } catch (error) {
      this.options.metrics.increment(guildId, 'ttsFailures');
      this.options.logger.warn({ error, guildId }, 'Could not list TTS voices');
      return [];
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
