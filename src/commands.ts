import { SlashCommandBuilder, type SlashCommandStringOption } from 'discord.js';

const permissionChoices = [
  { name: 'Join', value: 'join' },
  { name: 'Leave', value: 'leave' },
  { name: 'Skip', value: 'skip' },
  { name: 'Clear', value: 'clear' },
  { name: 'Server settings', value: 'server_settings' },
  { name: 'Speaker settings', value: 'speaker_settings' }
] as const;

const scopeChoices = [
  { name: 'Everyone', value: 'everyone' },
  { name: 'Role', value: 'role' }
] as const;

function permissionOption(option: SlashCommandStringOption): SlashCommandStringOption {
  return option
    .setName('permission')
    .setDescription('TTS permission to configure')
    .setRequired(true)
    .addChoices(...permissionChoices);
}

function scopeOption(option: SlashCommandStringOption): SlashCommandStringOption {
  return option
    .setName('scope')
    .setDescription('Allow or deny everyone, or a specific role')
    .setRequired(true)
    .addChoices(...scopeChoices);
}

export const ttsCommand = new SlashCommandBuilder()
  .setName('tts')
  .setDescription('Control voice-channel text to speech')
  .addSubcommand((command) => command.setName('join').setDescription('Join your voice channel and read this text channel'))
  .addSubcommand((command) => command.setName('leave').setDescription('Leave the voice channel'))
  .addSubcommand((command) => command.setName('status').setDescription('Show the TTS connection status'))
  .addSubcommand((command) => command.setName('skip').setDescription('Skip the current spoken message'))
  .addSubcommand((command) => command.setName('clear').setDescription('Clear queued messages'))
  .addSubcommand((command) => command.setName('voices').setDescription('List available TTS voices'))
  .addSubcommand((command) =>
    command
      .setName('ignore-me')
      .setDescription('Choose whether your normal Discord messages are read')
      .addBooleanOption((option) => option.setName('enabled').setDescription('True to ignore your messages, false to read them again').setRequired(true))
  )
  .addSubcommand((command) =>
    command
      .setName('volume')
      .setDescription('Set the server TTS volume')
      .addIntegerOption((option) => option.setName('percent').setDescription('Volume percent, 0 to 200').setRequired(true).setMinValue(0).setMaxValue(200))
  )
  .addSubcommand((command) =>
    command
      .setName('my-volume')
      .setDescription('Set your speaker-specific TTS volume')
      .addIntegerOption((option) => option.setName('percent').setDescription('Volume percent, 0 to 200').setRequired(true).setMinValue(0).setMaxValue(200))
  )
  .addSubcommand((command) =>
    command
      .setName('last-volume')
      .setDescription('Set the most recently detected speaker volume')
      .addIntegerOption((option) => option.setName('percent').setDescription('Volume percent, 0 to 200').setRequired(true).setMinValue(0).setMaxValue(200))
  )
  .addSubcommand((command) =>
    command
      .setName('pk-volume')
      .setDescription('Set a PluralKit member volume by member ID')
      .addStringOption((option) => option.setName('member-id').setDescription('PluralKit member ID').setRequired(true))
      .addIntegerOption((option) => option.setName('percent').setDescription('Volume percent, 0 to 200').setRequired(true).setMinValue(0).setMaxValue(200))
  )
  .addSubcommand((command) =>
    command
      .setName('speed')
      .setDescription('Set the server TTS speed')
      .addNumberOption((option) => option.setName('multiplier').setDescription('Speed multiplier, 0.5 to 2.0').setRequired(true).setMinValue(0.5).setMaxValue(2))
  )
  .addSubcommand((command) =>
    command
      .setName('my-speed')
      .setDescription('Set your speaker-specific TTS speed')
      .addNumberOption((option) => option.setName('multiplier').setDescription('Speed multiplier, 0.5 to 2.0').setRequired(true).setMinValue(0.5).setMaxValue(2))
  )
  .addSubcommand((command) =>
    command
      .setName('last-speed')
      .setDescription('Set the most recently detected speaker speed')
      .addNumberOption((option) => option.setName('multiplier').setDescription('Speed multiplier, 0.5 to 2.0').setRequired(true).setMinValue(0.5).setMaxValue(2))
  )
  .addSubcommand((command) =>
    command
      .setName('pk-speed')
      .setDescription('Set a PluralKit member speed by member ID')
      .addStringOption((option) => option.setName('member-id').setDescription('PluralKit member ID').setRequired(true))
      .addNumberOption((option) => option.setName('multiplier').setDescription('Speed multiplier, 0.5 to 2.0').setRequired(true).setMinValue(0.5).setMaxValue(2))
  )
  .addSubcommand((command) => command.setName('enable').setDescription('Enable TTS in this server'))
  .addSubcommand((command) => command.setName('disable').setDescription('Disable TTS in this server'))
  .addSubcommandGroup((group) =>
    group
      .setName('voice')
      .setDescription('Set or reset speaker voices')
      .addSubcommand((command) =>
        command
          .setName('set-user')
          .setDescription('Set your Discord user voice')
          .addStringOption((option) => option.setName('voice').setDescription('Voice ID from /tts voices').setRequired(true).setAutocomplete(true))
      )
      .addSubcommand((command) =>
        command
          .setName('set-last')
          .setDescription('Set the most recently detected speaker voice')
          .addStringOption((option) => option.setName('voice').setDescription('Voice ID from /tts voices').setRequired(true).setAutocomplete(true))
      )
      .addSubcommand((command) =>
        command
          .setName('set-pk')
          .setDescription('Set a PluralKit member voice by member ID')
          .addStringOption((option) => option.setName('member-id').setDescription('PluralKit member ID').setRequired(true))
          .addStringOption((option) => option.setName('voice').setDescription('Voice ID from /tts voices').setRequired(true).setAutocomplete(true))
      )
      .addSubcommand((command) =>
        command
          .setName('set-default')
          .setDescription('Set the server default voice')
          .addStringOption((option) => option.setName('voice').setDescription('Voice ID from /tts voices').setRequired(true).setAutocomplete(true))
      )
      .addSubcommand((command) => command.setName('reset-user').setDescription('Reset your Discord user voice to the server default'))
      .addSubcommand((command) => command.setName('reset-last').setDescription('Reset the most recently detected speaker voice to the server default'))
      .addSubcommand((command) =>
        command
          .setName('reset-pk')
          .setDescription('Reset a PluralKit member voice by member ID')
          .addStringOption((option) => option.setName('member-id').setDescription('PluralKit member ID').setRequired(true))
      )
  )
  .addSubcommand((command) =>
    command
      .setName('names')
      .setDescription('Set speaker name announcement behavior')
      .addStringOption((option) =>
        option
          .setName('mode')
          .setDescription('When to announce speaker names')
          .setRequired(true)
          .addChoices(
            { name: 'Only when speaker changes', value: 'on-speaker-change' },
            { name: 'Always', value: 'always' },
            { name: 'Never', value: 'never' }
          )
      )
  )
  .addSubcommandGroup((group) =>
    group
      .setName('permissions')
      .setDescription('Delegate TTS controls to everyone or roles')
      .addSubcommand((command) => command.setName('show').setDescription('Show configured TTS permission grants'))
      .addSubcommand((command) =>
        command
          .setName('allow')
          .setDescription('Allow everyone or a role to use a TTS permission')
          .addStringOption(permissionOption)
          .addStringOption(scopeOption)
          .addRoleOption((option) => option.setName('role').setDescription('Role to allow when scope is role'))
      )
      .addSubcommand((command) =>
        command
          .setName('deny')
          .setDescription('Remove an everyone or role TTS permission grant')
          .addStringOption(permissionOption)
          .addStringOption(scopeOption)
          .addRoleOption((option) => option.setName('role').setDescription('Role to remove when scope is role'))
      )
  )
  .addSubcommandGroup((group) =>
    group
      .setName('pronounce')
      .setDescription('Manage server-wide pronunciation replacements')
      .addSubcommand((command) =>
        command
          .setName('add')
          .setDescription('Add or update a pronunciation replacement')
          .addStringOption((option) => option.setName('from').setDescription('Word or phrase to replace').setRequired(true).setMaxLength(80))
          .addStringOption((option) => option.setName('to').setDescription('Spoken replacement').setRequired(true).setMaxLength(120))
      )
      .addSubcommand((command) =>
        command
          .setName('remove')
          .setDescription('Remove a pronunciation replacement')
          .addStringOption((option) => option.setName('from').setDescription('Word or phrase to remove').setRequired(true).setMaxLength(80))
      )
      .addSubcommand((command) => command.setName('list').setDescription('List pronunciation replacements'))
  );

export const commands = [ttsCommand.toJSON()];
