import { Client, Events, GatewayIntentBits, MessageFlags, PermissionFlagsBits, type AutocompleteInteraction, type ChatInputCommandInteraction, type InteractionReplyOptions, type GuildMember } from 'discord.js';
import ffmpegStatic from 'ffmpeg-static';
import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { createStorage } from './storage/createStorage.js';
import { createTtsProvider } from './tts/createTtsProvider.js';
import { PluralKitClient } from './pluralkit/PluralKitClient.js';
import { GuildPlayback } from './playback/GuildPlayback.js';
import { MessageRouter } from './messages/MessageRouter.js';
import { Metrics } from './metrics/Metrics.js';
import type { PermissionGrant, PermissionScope, TtsPermission, TtsVoice } from './types.js';
import { normalizeGuildSettings, normalizePronunciationText } from './settings.js';

const config = loadConfig();
const ffmpegPath =
  typeof ffmpegStatic === 'string'
    ? ffmpegStatic
    : (ffmpegStatic as unknown as { default?: string | null }).default;
if (ffmpegPath) {
  process.env.FFMPEG_PATH = ffmpegPath;
}
const storage = createStorage(config.database.url);
await storage.migrate();

const metrics = new Metrics();
const tts = createTtsProvider(config);
const playback = new GuildPlayback({ config, storage, tts, metrics, logger });
const pluralKit = new PluralKitClient({
  apiBase: config.pluralKit.apiBase,
  userAgent: config.pluralKit.userAgent,
  timeoutMs: config.pluralKit.lookupTimeoutMs,
  onFailure: (guildId) => {
    if (guildId) {
      metrics.increment(guildId, 'pluralKitLookupFailures');
    }
  },
  logger
});
const router = new MessageRouter({ config, storage, playback, pluralKit, tts, metrics, logger });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ]
});

client.once(Events.ClientReady, (readyClient) => {
  logger.info({ user: readyClient.user.tag }, 'Discord bot logged in');
});

client.on(Events.MessageCreate, (message) => {
  void router.handleMessage(message).catch((error) => logger.warn({ error }, 'Message handling failed'));
});

client.on(Events.MessageDelete, (message) => {
  router.handleMessageDelete(message);
});

client.on(Events.VoiceStateUpdate, (_oldState, newState) => {
  void playback.handleVoiceStateChange(newState.guild).catch((error) => logger.warn({ error, guildId: newState.guild.id }, 'Voice-state handling failed'));
});

client.on(Events.InteractionCreate, (interaction) => {
  if (interaction.isAutocomplete() && interaction.commandName === 'tts') {
    void handleAutocomplete(interaction).catch((error) => logger.warn({ error }, 'Autocomplete failed'));
    return;
  }

  if (!interaction.isChatInputCommand() || interaction.commandName !== 'tts') {
    return;
  }

  void handleTtsCommand(interaction).catch(async (error) => {
    logger.warn({ error }, 'Command failed');
    const content = error instanceof Error ? error.message : 'Command failed.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(content);
    } else {
      await interaction.reply(ephemeralReply(content));
    }
  });
});

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

await client.login(config.discord.token);

async function handleTtsCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild || !interaction.member) {
    await interaction.reply(ephemeralReply('TTS commands only work in servers.'));
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  const group = interaction.options.getSubcommandGroup(false);
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const requiredPermission = requiredTtsPermission(group, subcommand);

  if (requiredPermission === 'admin' && !isGuildAdminOrOwner(member)) {
    await interaction.reply(ephemeralReply('Only the server owner or administrators can manage TTS permissions.'));
    return;
  }

  if (requiredPermission !== undefined && requiredPermission !== 'admin' && !(await canUseTtsPermission(member, requiredPermission))) {
    await interaction.reply(ephemeralReply(`You need the ${formatPermission(requiredPermission)} TTS permission to use this command.`));
    return;
  }

  if (subcommand === 'join') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await playback.join(member, resolveTextChannelIdForJoin(interaction, member));
    await interaction.editReply('Joined your voice channel and bound TTS to this text channel.');
    return;
  }

  if (subcommand === 'leave') {
    await playback.leave(interaction.guild.id);
    await interaction.reply(ephemeralReply('Left the voice channel.'));
    return;
  }

  if (subcommand === 'skip') {
    playback.skip(interaction.guild.id);
    await interaction.reply(ephemeralReply('Skipped the current message.'));
    return;
  }

  if (subcommand === 'clear') {
    const count = playback.clear(interaction.guild.id);
    await interaction.reply(ephemeralReply(`Cleared ${count} queued message${count === 1 ? '' : 's'}.`));
    return;
  }

  if (subcommand === 'voices') {
    const voices = await tts.listVoices();
    const language = interaction.options.getString('language');
    const content = voices.length > 0
      ? formatVoicesReply(voices, language)
      : 'No voices are available from the configured TTS provider.';
    await interaction.reply(ephemeralReply(truncateDiscordReply(content)));
    return;
  }

  if (subcommand === 'ignore-me') {
    const enabled = interaction.options.getBoolean('enabled', true);
    if (enabled) {
      await storage.upsertIgnoredUser({ guildId: interaction.guild.id, userId: interaction.user.id });
      await interaction.reply(ephemeralReply('Your normal Discord messages will be ignored by TTS.'));
    } else {
      await storage.deleteIgnoredUser(interaction.guild.id, interaction.user.id);
      await interaction.reply(ephemeralReply('Your normal Discord messages will be read by TTS again.'));
    }
    return;
  }

  if (subcommand === 'nickname') {
    const spokenName = normalizePronunciationText(interaction.options.getString('name', true));
    if (!spokenName) {
      await interaction.reply(ephemeralReply('Nickname cannot be empty.'));
      return;
    }

    await storage.upsertSpeakerNamePronunciation({
      guildId: interaction.guild.id,
      speakerId: `discord_user:${interaction.user.id}`,
      spokenName
    });
    await interaction.reply(ephemeralReply(`Your Discord TTS nickname is now: ${spokenName}`));
    return;
  }

  if (subcommand === 'nickname-clear') {
    await storage.deleteSpeakerNamePronunciation(interaction.guild.id, `discord_user:${interaction.user.id}`);
    await interaction.reply(ephemeralReply('Your Discord TTS nickname was cleared.'));
    return;
  }

  if (subcommand === 'volume') {
    const settings = await ensureGuildSettings(interaction.guild.id);
    const percent = interaction.options.getInteger('percent', true);
    await storage.upsertGuildSettings({ ...settings, volume: percent / 100 });
    await interaction.reply(ephemeralReply(`Server volume is now ${percent}%.`));
    return;
  }

  if (subcommand === 'my-volume') {
    const percent = interaction.options.getInteger('percent', true);
    await upsertSpeakerMapping(guildIdFor(interaction), `discord_user:${interaction.user.id}`, { volume: percent / 100 });
    await interaction.reply(ephemeralReply(`Your speaker volume is now ${percent}%.`));
    return;
  }

  if (subcommand === 'last-volume') {
    const percent = interaction.options.getInteger('percent', true);
    const speaker = router.getLastSpeaker(interaction.guild.id);
    if (!speaker) {
      await interaction.reply(ephemeralReply('No recent speaker found yet. Send or proxy a message first, then try again.'));
      return;
    }

    await upsertSpeakerMapping(interaction.guild.id, speaker.id, { volume: percent / 100 });
    await interaction.reply(ephemeralReply(`${speaker.displayName}'s volume is now ${percent}%.`));
    return;
  }

  if (subcommand === 'pk-volume') {
    const percent = interaction.options.getInteger('percent', true);
    const pluralKitMemberId = normalizePluralKitMemberId(interaction.options.getString('member-id', true));
    await upsertSpeakerMapping(interaction.guild.id, `pluralkit_member:${pluralKitMemberId}`, { volume: percent / 100 });
    await interaction.reply(ephemeralReply(`PluralKit member ${pluralKitMemberId}'s volume is now ${percent}%.`));
    return;
  }

  if (subcommand === 'speed') {
    const settings = await ensureGuildSettings(interaction.guild.id);
    const speed = interaction.options.getNumber('multiplier', true);
    await storage.upsertGuildSettings({ ...settings, speed });
    await interaction.reply(ephemeralReply(`Server speed is now ${formatMultiplier(speed)}x.`));
    return;
  }

  if (subcommand === 'my-speed') {
    const speed = interaction.options.getNumber('multiplier', true);
    await upsertSpeakerMapping(guildIdFor(interaction), `discord_user:${interaction.user.id}`, { speed });
    await interaction.reply(ephemeralReply(`Your speaker speed is now ${formatMultiplier(speed)}x.`));
    return;
  }

  if (subcommand === 'last-speed') {
    const speed = interaction.options.getNumber('multiplier', true);
    const speaker = router.getLastSpeaker(interaction.guild.id);
    if (!speaker) {
      await interaction.reply(ephemeralReply('No recent speaker found yet. Send or proxy a message first, then try again.'));
      return;
    }

    await upsertSpeakerMapping(interaction.guild.id, speaker.id, { speed });
    await interaction.reply(ephemeralReply(`${speaker.displayName}'s speed is now ${formatMultiplier(speed)}x.`));
    return;
  }

  if (subcommand === 'pk-speed') {
    const speed = interaction.options.getNumber('multiplier', true);
    const pluralKitMemberId = normalizePluralKitMemberId(interaction.options.getString('member-id', true));
    await upsertSpeakerMapping(interaction.guild.id, `pluralkit_member:${pluralKitMemberId}`, { speed });
    await interaction.reply(ephemeralReply(`PluralKit member ${pluralKitMemberId}'s speed is now ${formatMultiplier(speed)}x.`));
    return;
  }

  if (subcommand === 'enable') {
    const settings = await ensureGuildSettings(interaction.guild.id);
    await storage.upsertGuildSettings({ ...settings, enabled: true });
    await interaction.reply(ephemeralReply('TTS is enabled in this server.'));
    return;
  }

  if (subcommand === 'disable') {
    const settings = await ensureGuildSettings(interaction.guild.id);
    await storage.upsertGuildSettings({ ...settings, enabled: false });
    playback.clear(interaction.guild.id);
    await interaction.reply(ephemeralReply('TTS is disabled in this server. Pending messages were cleared.'));
    return;
  }

  if (subcommand === 'names') {
    const mode = interaction.options.getString('mode', true) as 'on-speaker-change' | 'always' | 'never';
    const settings = await ensureGuildSettings(interaction.guild.id);
    await storage.upsertGuildSettings({ ...settings, announceNames: mode });
    await interaction.reply(ephemeralReply(`Speaker names are now set to: ${formatNameMode(mode)}.`));
    return;
  }

  if (group === 'voice') {
    await handleVoiceCommand(interaction, subcommand);
    return;
  }

  if (group === 'permissions') {
    await handlePermissionCommand(interaction, subcommand);
    return;
  }

  if (group === 'pronounce') {
    await handlePronounceCommand(interaction, subcommand);
    return;
  }

  if (subcommand === 'status') {
    const binding = await storage.getChannelBinding(interaction.guild.id);
    const settings = normalizeGuildSettings(await storage.getGuildSettings(interaction.guild.id), interaction.guild.id, config.tts.defaultVoiceId);
    const snapshot = metrics.snapshot(interaction.guild.id);
    const health = `Seen: ${snapshot.messagesReceived}. Queued: ${snapshot.messagesQueued}. Spoken: ${snapshot.messagesSpoken}. Dropped: ${snapshot.messagesDropped}. Skipped: ${snapshot.messagesSkipped}. Failures: TTS ${snapshot.ttsFailures}, playback ${snapshot.playbackFailures}, PK ${snapshot.pluralKitLookupFailures}, invalid audio ${snapshot.invalidAudio}.`;
    const status = binding
      ? `Connected to <#${binding.voiceChannelId}> and reading <#${binding.textChannelId}>. Queue: ${playback.queueLength(interaction.guild.id)}. Voice: ${settings.defaultVoiceId}. Volume: ${Math.round(settings.volume * 100)}%. Speed: ${formatMultiplier(settings.speed)}x. Names: ${formatNameMode(settings.announceNames)}. ${settings.enabled === false ? 'Disabled.' : 'Enabled.'} ${health}`
      : `Not connected. ${health}`;
    await interaction.reply(ephemeralReply(status));
  }
}

async function handlePronounceCommand(interaction: ChatInputCommandInteraction, subcommand: string): Promise<void> {
  const guildId = guildIdFor(interaction);

  if (subcommand === 'list') {
    const entries = await storage.listPronunciationEntries(guildId);
    const content = entries.length > 0
      ? entries.map((entry) => `${entry.fromText} -> ${entry.toText}`).join('\n')
      : 'No pronunciation replacements configured.';
    await interaction.reply(ephemeralReply(truncateDiscordReply(content)));
    return;
  }

  if (subcommand === 'speaker-list') {
    const speakerId = pluralKitSpeakerIdFromInteraction(interaction);
    const entries = await storage.listSpeakerPronunciationEntries(guildId, speakerId);
    const content = entries.length > 0
      ? entries.map((entry) => `${entry.fromText} -> ${entry.toText}`).join('\n')
      : `No pronunciation replacements configured for PluralKit member ${speakerId.slice('pluralkit_member:'.length)}.`;
    await interaction.reply(ephemeralReply(truncateDiscordReply(content)));
    return;
  }

  if (subcommand === 'name-set') {
    const speakerId = pluralKitSpeakerIdFromInteraction(interaction);
    const spokenName = normalizePronunciationText(interaction.options.getString('spoken-as', true));
    if (!spokenName) {
      await interaction.reply(ephemeralReply('Spoken name cannot be empty.'));
      return;
    }

    await storage.upsertSpeakerNamePronunciation({ guildId, speakerId, spokenName });
    await interaction.reply(ephemeralReply(`PluralKit member ${speakerId.slice('pluralkit_member:'.length)} will be announced as: ${spokenName}`));
    return;
  }

  if (subcommand === 'name-clear') {
    const speakerId = pluralKitSpeakerIdFromInteraction(interaction);
    await storage.deleteSpeakerNamePronunciation(guildId, speakerId);
    await interaction.reply(ephemeralReply(`Cleared name pronunciation for PluralKit member ${speakerId.slice('pluralkit_member:'.length)}.`));
    return;
  }

  const fromText = normalizePronunciationText(interaction.options.getString('from', true));
  if (!fromText) {
    await interaction.reply(ephemeralReply('Pronunciation source text cannot be empty.'));
    return;
  }

  if (subcommand === 'add' || subcommand === 'speaker-add') {
    const speakerId = subcommand === 'speaker-add' ? pluralKitSpeakerIdFromInteraction(interaction) : undefined;
    const entries = speakerId
      ? await storage.listSpeakerPronunciationEntries(guildId, speakerId)
      : await storage.listPronunciationEntries(guildId);
    const existing = entries.find((entry) => entry.fromText.toLowerCase() === fromText.toLowerCase());
    if (!existing && entries.length >= 100) {
      await interaction.reply(ephemeralReply(speakerId ? 'This speaker already has the maximum of 100 pronunciation replacements.' : 'This server already has the maximum of 100 pronunciation replacements.'));
      return;
    }

    const toText = normalizePronunciationText(interaction.options.getString('to', true));
    if (!toText) {
      await interaction.reply(ephemeralReply('Pronunciation replacement text cannot be empty.'));
      return;
    }

    const storedFromText = existing?.fromText ?? fromText;
    if (speakerId) {
      await storage.upsertSpeakerPronunciationEntry({ guildId, speakerId, fromText: storedFromText, toText });
      await interaction.reply(ephemeralReply(`Speaker pronunciation added for PluralKit member ${speakerId.slice('pluralkit_member:'.length)}: ${storedFromText} -> ${toText}`));
    } else {
      await storage.upsertPronunciationEntry({ guildId, fromText: storedFromText, toText });
      await interaction.reply(ephemeralReply(`Pronunciation added: ${storedFromText} -> ${toText}`));
    }
    return;
  }

  if (subcommand === 'remove' || subcommand === 'speaker-remove') {
    const speakerId = subcommand === 'speaker-remove' ? pluralKitSpeakerIdFromInteraction(interaction) : undefined;
    if (speakerId) {
      await storage.deleteSpeakerPronunciationEntry(guildId, speakerId, fromText);
      await interaction.reply(ephemeralReply(`Speaker pronunciation removed for PluralKit member ${speakerId.slice('pluralkit_member:'.length)}: ${fromText}`));
    } else {
      await storage.deletePronunciationEntry(guildId, fromText);
      await interaction.reply(ephemeralReply(`Pronunciation removed: ${fromText}`));
    }
  }
}

async function handlePermissionCommand(interaction: ChatInputCommandInteraction, subcommand: string): Promise<void> {
  const guildId = guildIdFor(interaction);

  if (subcommand === 'show') {
    const grants = await storage.listPermissionGrants(guildId);
    const content = grants.length > 0
      ? grants.map(formatPermissionGrant).join('\n')
      : 'No delegated TTS permissions yet. Server owner and administrators can manage all TTS controls.';
    await interaction.reply(ephemeralReply(truncateDiscordReply(content)));
    return;
  }

  const permission = interaction.options.getString('permission', true) as TtsPermission;
  const scope = interaction.options.getString('scope', true) as PermissionScope;
  const role = interaction.options.getRole('role');

  if (scope === 'role' && !role) {
    await interaction.reply(ephemeralReply('Choose a role when scope is set to role.'));
    return;
  }

  if (scope === 'everyone' && role) {
    await interaction.reply(ephemeralReply('Leave role empty when scope is set to everyone.'));
    return;
  }

  if (subcommand === 'allow') {
    await storage.upsertPermissionGrant({ guildId, permission, scope, roleId: role?.id });
    await interaction.reply(ephemeralReply(`Allowed ${formatScope(scope, role?.id)} to use ${formatPermission(permission)}.`));
    return;
  }

  if (subcommand === 'deny') {
    await storage.deletePermissionGrant(guildId, permission, scope, role?.id);
    await interaction.reply(ephemeralReply(`Removed ${formatScope(scope, role?.id)} from ${formatPermission(permission)}.`));
  }
}

async function handleVoiceCommand(interaction: ChatInputCommandInteraction, subcommand: string): Promise<void> {
  const guildId = interaction.guildId!;

  if (subcommand === 'set-user') {
    const voice = await resolveVoiceInput(interaction.options.getString('voice', true));
    await upsertSpeakerMapping(guildId, `discord_user:${interaction.user.id}`, { voiceId: voice.id });
    await interaction.reply(ephemeralReply(`Your Discord user voice is now ${formatVoiceChoice(voice)}.`));
    return;
  }

  if (subcommand === 'set-last') {
    const voice = await resolveVoiceInput(interaction.options.getString('voice', true));
    const speaker = router.getLastSpeaker(guildId);
    if (!speaker) {
      await interaction.reply(ephemeralReply('No recent speaker found yet. Send or proxy a message first, then try again.'));
      return;
    }

    await upsertSpeakerMapping(guildId, speaker.id, { voiceId: voice.id });
    await interaction.reply(ephemeralReply(`${speaker.displayName}'s voice is now ${formatVoiceChoice(voice)}.`));
    return;
  }

  if (subcommand === 'set-pk') {
    const voice = await resolveVoiceInput(interaction.options.getString('voice', true));
    const pluralKitMemberId = normalizePluralKitMemberId(interaction.options.getString('member-id', true));

    await upsertSpeakerMapping(guildId, `pluralkit_member:${pluralKitMemberId}`, { voiceId: voice.id });
    await interaction.reply(ephemeralReply(`PluralKit member ${pluralKitMemberId}'s voice is now ${formatVoiceChoice(voice)}.`));
    return;
  }

  if (subcommand === 'set-default') {
    const voice = await resolveVoiceInput(interaction.options.getString('voice', true));
    const settings = await ensureGuildSettings(guildId);
    await storage.upsertGuildSettings({ ...settings, defaultVoiceId: voice.id });
    await interaction.reply(ephemeralReply(`Server default voice is now ${formatVoiceChoice(voice)}.`));
    return;
  }

  if (subcommand === 'reset-user') {
    await upsertSpeakerMapping(guildId, `discord_user:${interaction.user.id}`, { voiceId: undefined });
    await interaction.reply(ephemeralReply('Your Discord user voice was reset to the server default.'));
    return;
  }

  if (subcommand === 'reset-last') {
    const speaker = router.getLastSpeaker(guildId);
    if (!speaker) {
      await interaction.reply(ephemeralReply('No recent speaker found yet. Send or proxy a message first, then try again.'));
      return;
    }

    await upsertSpeakerMapping(guildId, speaker.id, { voiceId: undefined });
    await interaction.reply(ephemeralReply(`${speaker.displayName}'s voice was reset to the server default.`));
    return;
  }

  if (subcommand === 'reset-pk') {
    const pluralKitMemberId = normalizePluralKitMemberId(interaction.options.getString('member-id', true));
    await upsertSpeakerMapping(guildId, `pluralkit_member:${pluralKitMemberId}`, { voiceId: undefined });
    await interaction.reply(ephemeralReply(`PluralKit member ${pluralKitMemberId}'s voice was reset to the server default.`));
  }
}

async function upsertSpeakerMapping(guildId: string, speakerId: string, patch: { voiceId?: string; volume?: number; speed?: number }): Promise<void> {
  const existing = await storage.getVoiceMapping(guildId, speakerId);
  await storage.upsertVoiceMapping({
    guildId,
    speakerId,
    voiceId: Object.hasOwn(patch, 'voiceId') ? patch.voiceId : existing?.voiceId,
    volume: Object.hasOwn(patch, 'volume') ? patch.volume : existing?.volume,
    speed: Object.hasOwn(patch, 'speed') ? patch.speed : existing?.speed
  });
}

async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'voice' && focused.name !== 'language') {
    await interaction.respond([]);
    return;
  }

  const query = String(focused.value).toLowerCase();
  const voices = await tts.listVoices();

  if (focused.name === 'language') {
    const languages = countVoicesByLanguage(voices);
    const choices = Array.from(languages.entries())
      .filter(([language]) => language.toLowerCase().includes(query))
      .slice(0, 25)
      .map(([language, count]) => ({ name: `${language} (${count})`, value: language }));
    await interaction.respond(choices);
    return;
  }

  const choices = voices
    .filter((voice) => {
      const searchable = `${voice.id} ${voice.label} ${voice.language ?? ''} ${voice.gender ?? ''}`.toLowerCase();
      return searchable.includes(query);
    })
    .slice(0, 25)
    .map((voice) => ({
      name: formatVoiceChoice(voice).slice(0, 100),
      value: voice.id
    }));

  await interaction.respond(choices);
}

async function ensureGuildSettings(guildId: string) {
  const existing = await storage.getGuildSettings(guildId);
  if (existing) {
    return normalizeGuildSettings(existing, guildId, config.tts.defaultVoiceId);
  }

  const settings = {
    guildId,
    defaultVoiceId: config.tts.defaultVoiceId,
    announceNames: 'on-speaker-change' as const,
    enabled: true,
    volume: 1,
    speed: 1
  };
  await storage.upsertGuildSettings(settings);
  return settings;
}

async function resolveVoiceInput(voiceId: string): Promise<TtsVoice> {
  const voices = await tts.listVoices();
  const normalized = voiceId.toLowerCase();
  const voice = voices.find((candidate) => candidate.id.toLowerCase() === normalized || candidate.label.toLowerCase() === normalized);
  if (voice) {
    return voice;
  }

  throw new Error(`Unknown voice "${voiceId}". Use autocomplete in the voice field, or run /tts voices language:<code> to browse friendly names.`);
}

function formatVoicesReply(voices: TtsVoice[], language: string | null): string {
  const languages = countVoicesByLanguage(voices);
  const normalizedLanguage = language?.trim();

  if (!normalizedLanguage) {
    return [
      'Voice languages:',
      Array.from(languages.entries()).map(([code, count]) => `${code}: ${count}`).join('\n'),
      'Use /tts voices language:<code> to list friendly voice names.'
    ].join('\n');
  }

  const selected = voices
    .filter((voice) => voice.language?.toLowerCase() === normalizedLanguage.toLowerCase())
    .sort(compareVoices);

  if (selected.length === 0) {
    return `No voices found for ${normalizedLanguage}. Available languages: ${Array.from(languages.keys()).join(', ') || 'none'}.`;
  }

  return [
    `Voices for ${selected[0]?.language ?? normalizedLanguage}:`,
    ...selected.map((voice) => `- ${formatVoiceChoice(voice)}`)
  ].join('\n');
}

function countVoicesByLanguage(voices: TtsVoice[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const voice of voices) {
    const language = voice.language ?? 'unknown';
    counts.set(language, (counts.get(language) ?? 0) + 1);
  }

  return new Map(Array.from(counts.entries()).sort(([a], [b]) => a.localeCompare(b)));
}

function formatVoiceChoice(voice: { id: string; label: string; language?: string; gender?: string }): string {
  const gender = formatGender(voice.gender);
  const details = [voice.language, gender].filter(Boolean).join(', ');
  return details ? `${voice.label} (${details})` : voice.label;
}

function compareVoices(a: TtsVoice, b: TtsVoice): number {
  return a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
}

function formatGender(gender: string | undefined): string | undefined {
  if (gender === 'masculine') {
    return 'masc';
  }

  if (gender === 'feminine') {
    return 'fem';
  }

  return undefined;
}

function formatNameMode(mode: 'on-speaker-change' | 'always' | 'never'): string {
  if (mode === 'on-speaker-change') {
    return 'only when speaker changes';
  }

  return mode;
}

function formatMultiplier(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function formatPermission(permission: TtsPermission): string {
  return permission.replace(/_/g, ' ');
}

function formatScope(scope: PermissionScope, roleId?: string): string {
  return scope === 'everyone' ? 'everyone' : `<@&${roleId}>`;
}

function formatPermissionGrant(grant: PermissionGrant): string {
  return `${formatPermission(grant.permission)}: ${formatScope(grant.scope, grant.roleId)}`;
}

function requiredTtsPermission(group: string | null, subcommand: string): TtsPermission | 'admin' | undefined {
  if (group === 'permissions') {
    return 'admin';
  }

  if (group === 'pronounce') {
    if (subcommand.startsWith('speaker-') || subcommand.startsWith('name-')) {
      return 'speaker_settings';
    }

    return 'server_settings';
  }

  if (group === 'voice') {
    if (subcommand === 'set-user' || subcommand === 'reset-user') {
      return undefined;
    }

    if (subcommand === 'set-default') {
      return 'server_settings';
    }

    return 'speaker_settings';
  }

  switch (subcommand) {
    case 'join':
      return 'join';
    case 'leave':
      return 'leave';
    case 'skip':
      return 'skip';
    case 'ignore-me':
    case 'nickname':
    case 'nickname-clear':
      return undefined;
    case 'clear':
      return 'clear';
    case 'volume':
    case 'speed':
    case 'enable':
    case 'disable':
    case 'names':
      return 'server_settings';
    case 'last-volume':
    case 'pk-volume':
    case 'last-speed':
    case 'pk-speed':
      return 'speaker_settings';
    default:
      return undefined;
  }
}

function resolveTextChannelIdForJoin(interaction: ChatInputCommandInteraction, member: GuildMember): string {
  if (interaction.channel?.isTextBased()) {
    return interaction.channelId;
  }

  const voiceChannel = member.voice.channel;
  const maybeTextBased = voiceChannel as { isTextBased?: () => boolean; id?: string } | null;
  if (maybeTextBased?.isTextBased?.() && maybeTextBased.id) {
    return maybeTextBased.id;
  }

  throw new Error('I could not find a text channel to read. Run /tts join from a normal text channel, or from the voice channel chat if your server exposes one.');
}

async function canUseTtsPermission(member: GuildMember, permission: TtsPermission): Promise<boolean> {
  if (isGuildAdminOrOwner(member)) {
    return true;
  }

  if (permission === 'join' && member.voice.channelId) {
    return true;
  }

  if ((permission === 'leave' || permission === 'skip') && (await isMemberInBoundVoiceChannel(member))) {
    return true;
  }

  const grants = await storage.listPermissionGrantsForPermission(member.guild.id, permission);
  if (grants.some((grant) => grant.scope === 'everyone')) {
    return true;
  }

  return grants.some((grant) => grant.scope === 'role' && grant.roleId && member.roles.cache.has(grant.roleId));
}

function isGuildAdminOrOwner(member: GuildMember): boolean {
  return member.guild.ownerId === member.id || member.permissions.has(PermissionFlagsBits.Administrator);
}

async function isMemberInBoundVoiceChannel(member: GuildMember): Promise<boolean> {
  const binding = await storage.getChannelBinding(member.guild.id);
  return Boolean(binding && member.voice.channelId === binding.voiceChannelId);
}

function guildIdFor(interaction: ChatInputCommandInteraction): string {
  if (!interaction.guildId) {
    throw new Error('TTS commands only work in servers.');
  }

  return interaction.guildId;
}

function truncateDiscordReply(content: string): string {
  return content.length <= 1900 ? content : `${content.slice(0, 1897)}...`;
}

function normalizePluralKitMemberId(input: string): string {
  const trimmed = input.trim();
  const withoutPrefix = trimmed.startsWith('pluralkit_member:') ? trimmed.slice('pluralkit_member:'.length) : trimmed;

  if (!/^[A-Za-z0-9-]{5,64}$/.test(withoutPrefix)) {
    throw new Error('PluralKit member ID should be the short ID or UUID, not a display name.');
  }

  return withoutPrefix;
}

function pluralKitSpeakerIdFromInteraction(interaction: ChatInputCommandInteraction): string {
  return `pluralkit_member:${normalizePluralKitMemberId(interaction.options.getString('member-id', true))}`;
}

function ephemeralReply(content: string): InteractionReplyOptions {
  return { content, flags: MessageFlags.Ephemeral };
}

async function shutdown(): Promise<void> {
  logger.info('Shutting down');
  client.destroy();
  await storage.close();
  process.exit(0);
}
