import { AudioPlayerStatus, createAudioPlayer, createAudioResource, entersState, getVoiceConnection, joinVoiceChannel, NoSubscriberBehavior, StreamType, VoiceConnectionStatus, type AudioPlayer } from '@discordjs/voice';
import type { Guild, GuildMember, VoiceBasedChannel } from 'discord.js';
import type { Logger } from 'pino';
import type { AppConfig } from '../config.js';
import type { Metrics } from '../metrics/Metrics.js';
import type { Storage } from '../storage/Storage.js';
import type { QueuedSpeech } from '../types.js';
import type { TtsAudio, TtsProvider } from '../tts/TtsProvider.js';
import { InvalidAudioError } from '../tts/errors.js';
import { SpeechQueue } from './SpeechQueue.js';

export class GuildPlayback {
  private readonly sessions = new Map<string, GuildPlaybackSession>();

  constructor(
    private readonly options: {
      config: AppConfig;
      storage: Storage;
      tts: TtsProvider;
      metrics: Metrics;
      logger: Logger;
    }
  ) {}

  async join(member: GuildMember, textChannelId: string): Promise<void> {
    const voice = member.voice.channel;
    if (!voice) {
      throw new Error('You need to be in a voice channel first.');
    }

    const existing = getVoiceConnection(member.guild.id);
    if (existing) {
      existing.destroy();
    }

    const connection = joinVoiceChannel({
      channelId: voice.id,
      guildId: member.guild.id,
      adapterCreator: member.guild.voiceAdapterCreator
    });

    const session = this.getSession(member.guild.id);
    connection.subscribe(session.player);
    connection.on(VoiceConnectionStatus.Disconnected, () => {
      void this.handleConnectionDisconnected(member.guild.id);
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
    await this.options.storage.upsertChannelBinding({
      guildId: member.guild.id,
      voiceChannelId: voice.id,
      textChannelId
    });

    await this.ensureDefaultSettings(member.guild.id);
  }

  async leave(guildId: string): Promise<void> {
    const session = this.sessions.get(guildId);
    session?.queue.clear();
    if (session) {
      session.speaking = false;
      session.player.stop(true);
      void this.discardPrepared(session);
    }
    getVoiceConnection(guildId)?.destroy();
    await this.options.storage.deleteChannelBinding(guildId);
  }

  enqueue(item: QueuedSpeech): boolean {
    const session = this.getSession(item.guildId);
    const accepted = session.queue.enqueue(item);

    if (accepted) {
      void this.pump(item.guildId);
    }

    return accepted;
  }

  skip(guildId: string): void {
    this.options.logger.info({ guildId }, 'Skipping current speech item');
    this.options.metrics.increment(guildId, 'messagesSkipped');
    this.getSession(guildId).player.stop(true);
  }

  clear(guildId: string): number {
    const session = this.getSession(guildId);
    void this.discardPrepared(session);
    return session.queue.clear();
  }

  queueLength(guildId: string): number {
    return this.getSession(guildId).queue.length;
  }

  async handleVoiceStateChange(guild: Guild): Promise<void> {
    const binding = await this.options.storage.getChannelBinding(guild.id);
    if (!binding || this.options.config.voice.autoDisconnectMs === 0) {
      return;
    }

    const channel = guild.channels.cache.get(binding.voiceChannelId);
    if (!channel?.isVoiceBased()) {
      return;
    }

    const hasHumanListener = channel.members.some((member) => !member.user.bot);
    const session = this.getSession(guild.id);

    if (hasHumanListener) {
      if (session.emptyDisconnectTimer) {
        clearTimeout(session.emptyDisconnectTimer);
        session.emptyDisconnectTimer = undefined;
      }
      return;
    }

    if (session.emptyDisconnectTimer) {
      return;
    }

    session.emptyDisconnectTimer = setTimeout(() => {
      session.emptyDisconnectTimer = undefined;
      this.options.logger.info({ guildId: guild.id }, 'Auto-disconnecting from empty voice channel');
      void this.leave(guild.id);
    }, this.options.config.voice.autoDisconnectMs);
  }

  private async pump(guildId: string): Promise<void> {
    const session = this.getSession(guildId);
    if (session.speaking) {
      return;
    }

    const connection = getVoiceConnection(guildId);
    if (!connection) {
      return;
    }

    const item = session.queue.next();
    if (!item) {
      return;
    }

    session.speaking = true;

    let audio: TtsAudio | undefined;
    try {
      audio = await this.consumeOrSynthesizeNext(session, item);
    } catch (error) {
      this.options.metrics.increment(guildId, 'ttsFailures');
      if (error instanceof InvalidAudioError) {
        this.options.metrics.increment(guildId, 'invalidAudio');
      }
      this.options.logger.warn({ error, guildId, itemId: item.id, voiceId: item.voiceId }, 'TTS synthesis failed');
      session.speaking = false;
      void this.pump(guildId);
      return;
    }

    try {
      this.prepareNext(session);
      await this.playAudio(session, item, audio);
      this.options.metrics.increment(guildId, 'messagesSpoken');
    } catch (error) {
      this.options.metrics.increment(guildId, 'playbackFailures');
      this.options.logger.warn({ error, guildId, itemId: item.id }, 'Discord playback failed');
    } finally {
      session.speaking = false;
      void this.pump(guildId);
    }
  }

  private getSession(guildId: string): GuildPlaybackSession {
    const existing = this.sessions.get(guildId);
    if (existing) {
      return existing;
    }

    const queue = new SpeechQueue(this.options.config.queue.maxLength);
    queue.on('dropped', (item: QueuedSpeech) => {
      this.options.metrics.increment(item.guildId, 'messagesDropped');
      this.options.logger.warn({ guildId: item.guildId }, 'Speech queue full; dropped message');
    });
    const session = {
      player: createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } }),
      queue,
      speaking: false,
      emptyDisconnectTimer: undefined
    };
    this.sessions.set(guildId, session);
    return session;
  }

  private async ensureDefaultSettings(guildId: string): Promise<void> {
    const existing = await this.options.storage.getGuildSettings(guildId);
    if (existing) {
      return;
    }

    await this.options.storage.upsertGuildSettings({
      guildId,
      defaultVoiceId: this.options.config.tts.defaultVoiceId,
      announceNames: 'on-speaker-change',
      enabled: true,
      volume: 1,
      speed: 1
    });
  }

  private async handleConnectionDisconnected(guildId: string): Promise<void> {
    const session = this.getSession(guildId);
    const connection = getVoiceConnection(guildId);
    this.options.logger.info({ guildId }, 'Voice connection disconnected');
    session.speaking = false;

    if (!connection) {
      return;
    }

    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000)
      ]);
      this.options.metrics.increment(guildId, 'reconnects');
      this.options.logger.info({ guildId }, 'Voice connection is reconnecting');
    } catch (error) {
      connection.destroy();
      session.queue.clear();
      await this.discardPrepared(session);
      await this.options.storage.deleteChannelBinding(guildId);
      this.options.logger.warn({ error, guildId }, 'Voice connection could not reconnect; cleared playback state');
    }
  }

  private async synthesizeWithRetry(item: QueuedSpeech): Promise<TtsAudio> {
    let attempt = 0;
    let lastError: unknown;
    const attempts = this.options.config.tts.retryAttempts + 1;

    while (attempt < attempts) {
      try {
        return await this.options.tts.synthesize({ text: item.text, voiceId: item.voiceId, speed: item.speed });
      } catch (error) {
        lastError = error;
        attempt += 1;

        if (attempt >= attempts) {
          break;
        }

        this.options.logger.warn({ error, guildId: item.guildId, itemId: item.id, attempt }, 'TTS synthesis attempt failed; retrying');
        await delay(this.options.config.tts.retryDelayMs);
      }
    }

    throw lastError;
  }

  private async consumeOrSynthesizeNext(session: GuildPlaybackSession, item: QueuedSpeech): Promise<TtsAudio> {
    const prepared = session.prepared;
    if (!prepared || prepared.item.id !== item.id) {
      if (prepared) {
        await this.discardPrepared(session);
      }
      return this.synthesizeWithRetry(item);
    }

    session.prepared = undefined;
    return prepared.promise;
  }

  private prepareNext(session: GuildPlaybackSession): void {
    if (session.prepared) {
      return;
    }

    const item = session.queue.peek();
    if (!item) {
      return;
    }

    const prepared: PreparedSpeech = {
      item,
      disposed: false,
      promise: this.synthesizeWithRetry(item)
    };
    session.prepared = prepared;

    prepared.promise
      .then((audio) => {
        if (prepared.disposed) {
          return audio.cleanup?.();
        }

        this.options.logger.debug({ guildId: item.guildId, itemId: item.id }, 'Prepared next speech item');
      })
      .catch((error) => {
        if (!prepared.disposed) {
          this.options.logger.warn({ error, guildId: item.guildId, itemId: item.id }, 'Prepared speech item failed');
        }
      });
  }

  private async discardPrepared(session: GuildPlaybackSession): Promise<void> {
    const prepared = session.prepared;
    if (!prepared) {
      return;
    }

    session.prepared = undefined;
    prepared.disposed = true;
    const audio = await prepared.promise.catch(() => undefined);
    await audio?.cleanup?.();
  }

  private async playAudio(session: GuildPlaybackSession, item: QueuedSpeech, audio: TtsAudio): Promise<void> {
    const resource = createAudioResource(audio.stream, { inputType: StreamType.Arbitrary, inlineVolume: true });
    resource.volume?.setVolume(item.volume);

    await new Promise<void>((resolve, reject) => {
      const cleanup = async () => {
        session.player.off(AudioPlayerStatus.Idle, onIdle);
        session.player.off('error', onError);
        await audio.cleanup?.();
      };

      const onIdle = () => {
        void cleanup().then(resolve, reject);
      };

      const onError = (error: Error) => {
        void cleanup().then(() => reject(error), reject);
      };

      session.player.once(AudioPlayerStatus.Idle, onIdle);
      session.player.once('error', onError);
      session.player.play(resource);
    });
  }
}

export function getVoiceChannelName(channel: VoiceBasedChannel): string {
  return channel.name;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface GuildPlaybackSession {
  player: AudioPlayer;
  queue: SpeechQueue;
  speaking: boolean;
  prepared?: PreparedSpeech;
  emptyDisconnectTimer?: NodeJS.Timeout;
}

interface PreparedSpeech {
  item: QueuedSpeech;
  promise: Promise<TtsAudio>;
  disposed: boolean;
}
