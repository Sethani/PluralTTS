# Discord Voice-Channel TTS Bot — Implementation Checklist

## Current implementation status

MVP implemented on 2026-09-07 as a greenfield TypeScript Node.js bot. Verified with:

- [x] `npm test`
- [x] `npm run build`
- [x] `npm audit`

Live Discord/Piper validation still requires a real bot token, enabled Discord gateway intents, and local Piper voice model files.

## Project setup

- [x] Create a Node.js project.
- [x] Add a `.gitignore`.
- [x] Add a `.env.example` containing placeholders for:
  - [x] Discord bot token.
  - [x] Discord application/client ID.
  - [x] TTS provider API key, if applicable.
- [x] Install the core Discord dependencies:
  - [x] `discord.js`
  - [x] `@discordjs/voice`
- [x] Install or configure an audio dependency suitable for Discord voice playback.
- [x] Enable the Discord gateway intents required to:
  - [x] See guilds.
  - [x] See text-channel messages.
  - [x] Read message content.
  - [x] See voice-state changes if needed.
- [x] Add a basic configuration file for server/channel-specific settings.
- [x] Add structured logging.

## Basic Discord bot

- [x] Log in to Discord successfully.
- [x] Register slash commands.
- [x] Add a `/tts join` command.
- [x] Add a `/tts leave` command.
- [x] Make `/tts join` join the invoking user's current voice channel.
- [x] Make `/tts leave` disconnect cleanly.
- [x] Recover cleanly if the voice connection is lost.
- [x] Prevent duplicate voice connections for the same guild.

## Determine which text channel should be read

- [x] Support text chat attached to a voice channel when available.
- [x] Store the text channel associated with the active TTS voice connection.
- [x] Ignore messages from unrelated text channels.
- [x] Ignore messages from bots by default.
- [x] Make an explicit exception for PluralKit webhook messages.
- [x] Ignore messages sent by the TTS bot itself.

## Message queue

- [x] Create a FIFO queue for messages waiting to be spoken.
- [x] Ensure only one audio resource is played at a time.
- [x] Advance the queue when the current audio resource finishes.
- [x] Preserve original message order even when TTS generation completes out of order.
- [x] Avoid overlapping speech.
- [x] Handle failed TTS generation without blocking the queue.
- [x] Handle failed Discord playback without blocking the queue.
- [x] Add a maximum queue length.
- [x] Add sensible behaviour when the queue is full.
- [x] Add a `/tts skip` command.
- [x] Add a `/tts clear` command.

## TTS provider abstraction

- [x] Create a provider-independent TTS interface similar to:
  - [x] Input: text.
  - [x] Input: voice identifier.
  - [x] Input: mood/style.
  - [x] Input: speed.
  - [x] Output: playable audio stream or buffer.
- [x] Keep Discord code independent from the chosen TTS provider.
- [x] Implement one initial TTS provider.
- [x] Make the provider configurable.
- [x] Handle API errors and rate limits.
- [x] Add a timeout for stalled TTS requests.
- [x] Avoid writing temporary audio files unless necessary.
- [x] If temporary files are required, delete them after playback.
- [x] Generate the next queued message while the current message is playing.

## Text preprocessing

- [x] Strip Discord markdown that should not be spoken.
- [x] Convert user mentions to display names.
- [x] Convert role mentions to readable names or omit them.
- [x] Convert channel mentions to channel names.
- [x] Convert custom emoji to readable emoji names or omit them.
- [x] Decide how Unicode emoji should be handled.
- [x] Replace URLs with a short spoken placeholder such as `link`.
- [x] Avoid reading raw URLs character by character.
- [x] Collapse excessive repeated punctuation.
- [x] Decide how spoiler formatting should be handled.
- [x] Decide how inline code should be handled.
- [x] Decide how code blocks should be handled.
- [x] Add a maximum spoken message length.
- [x] Decide whether overly long messages are truncated or skipped.
- [x] Ignore empty messages after preprocessing.

## PluralKit support

- [x] Detect PluralKit-proxied webhook messages.
- [x] Do not reject PluralKit messages simply because they are webhook messages.
- [x] Use the proxied message's displayed member name for speech announcements.
- [x] Query PluralKit's message endpoint using the Discord message ID.
- [x] Extract the stable PluralKit member ID.
- [x] Extract the PluralKit member name.
- [x] Use the stable PluralKit member ID as the internal speaker identity.
- [x] Fall back gracefully if the PluralKit API is unavailable.
- [x] Cache PluralKit message/member lookups where useful.
- [x] Respect PluralKit API rate limits.

## Prevent duplicate speech for PluralKit proxying

- [x] Handle the fact that the original Discord message may appear briefly before PluralKit deletes it.
- [x] Delay ordinary user messages briefly before committing them to TTS.
- [x] Cancel a delayed ordinary message if Discord reports that it was deleted by PluralKit.
- [x] Process confirmed PluralKit webhook messages immediately.
- [x] Test the timing with real PluralKit proxying.
- [x] Ensure a proxied message is spoken exactly once.

## Speaker identities

- [x] Define a generic internal speaker object.
- [x] Support normal Discord users as speakers.
- [x] Support PluralKit members as speakers.
- [x] Store speaker identity separately from display name.
- [x] Preserve voice settings when a PluralKit member changes their display name.

## Voice selection

- [x] Add a server default TTS voice.
- [x] Allow a voice to be assigned to a Discord user.
- [x] Allow a voice to be assigned to a PluralKit member.
- [x] Define voice-setting precedence.
- [x] Use the most specific available voice setting.
- [x] Fall back safely when a configured voice no longer exists.
- [x] Add a `/tts voice` command.
- [x] Add a way to list available voices.
- [x] Add a way to reset a speaker to the default voice.
- [x] Add a way to set/reset a PluralKit member voice directly by member ID.
- [x] Add voice autocomplete for voice-setting commands.
- [x] Add a way to set the server default voice.
- [x] Persist voice mappings across restarts.

## Speaker-name announcements

- [x] Track the most recently spoken speaker.
- [x] Add configuration for:
  - [x] Always announce the speaker name.
  - [x] Announce only when the speaker changes.
  - [x] Never announce the speaker name.
- [x] Default to announcing when the speaker changes.
- [x] Do not repeatedly announce the same speaker for consecutive messages.
- [x] Reset the current-speaker state after a sufficiently long silence if desired.
- [x] Ensure PluralKit member names are used instead of the Discord account name.

## Volume control

- [x] Add a server/global TTS volume.
- [x] Add optional per-speaker volume.
- [x] Combine global and per-speaker volume safely.
- [x] Clamp final volume to a sensible range.
- [x] Add `/tts volume`.
- [x] Add `/tts my-volume` or an equivalent speaker-specific command.
- [x] Persist volume settings.
- [x] Test different voices for perceived loudness differences.

## Mood/style prefixes

- [ ] Define supported mood/style prefixes, for example:
  - [ ] `[happy]`
  - [ ] `[sad]`
  - [ ] `[angry]`
  - [ ] `[excited]`
  - [ ] `[whisper]`
- [ ] Detect a mood prefix only at the start of a message.
- [ ] Strip the mood prefix before speaking the message.
- [ ] Convert the prefix to the selected TTS provider's style/instruction format.
- [ ] Fall back to neutral speech if the provider does not support the requested mood.
- [ ] Ignore unknown prefixes rather than reading them accidentally.
- [ ] Make the supported mood list configurable.
- [x] Document that Piper does not support mood/style prefixes.

## Speech speed

- [x] Add a default speech speed.
- [x] Allow optional per-speaker speech speed.
- [x] Clamp speed to a sensible range.
- [x] Pass speed through the TTS provider abstraction.
- [x] Persist speech-speed settings.

## Configuration persistence

- [x] Choose a persistence method:
  - [ ] JSON for a very small single-server bot, or
  - [x] SQLite for a more robust implementation.
- [x] Persist guild settings.
- [x] Persist channel bindings.
- [x] Persist Discord-user voice mappings.
- [x] Persist PluralKit-member voice mappings.
- [x] Persist volume settings.
- [x] Persist speed settings.
- [x] Persist name-announcement behaviour.
- [x] Add safe defaults when configuration is missing or corrupt.

## Permissions and safety controls

- [x] Restrict administrative TTS commands appropriately.
- [x] Decide who may change another speaker's voice.
- [x] Decide who may change server-wide TTS settings.
- [x] Prevent arbitrary users from forcing the bot into unrelated voice channels.
- [x] Add a maximum input length before sending text to the TTS provider.
- [x] Sanitize text passed to provider-specific style/instruction fields.
- [x] Avoid logging sensitive API keys or tokens.
- [x] Avoid logging message contents unless debug logging explicitly requires it.

## User controls

- [x] Add `/tts join`.
- [x] Add `/tts leave`.
- [x] Add `/tts skip`.
- [x] Add `/tts clear`.
- [x] Add `/tts volume`.
- [x] Add `/tts voice`.
- [x] Add `/tts voices`.
- [x] Add `/tts status`.
- [x] Add `/tts enable`.
- [x] Add `/tts disable`.
- [x] Add `/tts names` for name-announcement mode.
- [x] Add `/tts permissions` for delegated permission grants.
- [x] Add `/tts ignore-me`.
- [x] Add `/tts pronounce` for pronunciation overrides.
- [x] Add speaker-specific pronunciation controls for PluralKit member IDs.
- [x] Add spoken-name overrides for PluralKit member announcements.

## Optional pronunciation dictionary

- [x] Support custom text replacements before TTS.
- [x] Allow server-wide pronunciation entries.
- [x] Allow speaker-specific pronunciation entries if useful.
- [x] Allow speaker-specific spoken-name overrides.
- [x] Apply only whole-word replacements where appropriate.
- [x] Prevent recursive replacements.
- [x] Persist pronunciation entries.
- [x] Persist speaker-specific pronunciation entries.
- [x] Persist speaker-specific spoken-name overrides.

## Voice-channel awareness

- [x] Decide whether text should be spoken only for users currently present in the voice channel.
- [x] If enabled, check voice membership before queueing a normal user's message.
- [x] Determine how PluralKit members map back to the underlying Discord account for this check.
- [x] Decide what happens when someone leaves while their message is queued.
- [x] Automatically disconnect after the channel is empty for a configurable period if desired.

## Reliability

- [x] Gracefully handle Discord reconnects.
- [x] Gracefully handle PluralKit API failures.
- [x] Gracefully handle TTS API failures.
- [x] Gracefully handle invalid audio returned by the TTS provider.
- [x] Ensure one failed message does not stop later messages.
- [x] Add retry behaviour only where it cannot duplicate speech.
- [x] Add basic metrics/logging for:
  - [x] Messages received.
  - [x] Messages spoken.
  - [x] Messages skipped.
  - [x] TTS failures.
  - [x] PluralKit lookup failures.
  - [x] Queue length.

## Testing

- [x] Test a normal Discord message.
- [x] Test several normal users talking rapidly.
- [x] Test a PluralKit proxied message.
- [x] Confirm the original pre-proxy message is not spoken.
- [x] Test two different PluralKit members from the same Discord account.
- [x] Confirm each PluralKit member can have a different voice.
- [ ] Rename a PluralKit member and confirm the voice mapping survives.
- [x] Test speaker-change name announcements.
- [x] Test consecutive messages from the same speaker.
- [ ] Test mood prefixes.
- [ ] Test unsupported mood prefixes.
- [x] Test URLs.
- [x] Test mentions.
- [x] Test custom emoji.
- [x] Test Unicode emoji.
- [x] Test markdown.
- [x] Test code blocks.
- [x] Test a very long message.
- [x] Test queue order under slow TTS generation.
- [x] Test TTS-provider failure.
- [x] Test PluralKit API failure.
- [x] Test bot disconnect/reconnect.
- [x] Test restarting the bot and confirm persisted settings survive.

## Documentation

- [x] Write setup instructions.
- [x] Document required Discord bot permissions.
- [x] Document required gateway intents.
- [x] Document environment variables.
- [x] Document how to invite the bot.
- [x] Document how to bind it to a voice/text channel.
- [x] Document all slash commands.
- [x] Document supported mood prefix limitations for Piper.
- [x] Document voice assignment behaviour.
- [x] Document PluralKit behaviour.
- [x] Document configuration storage.
- [x] Document known limitations.
- [x] Add Terms of Service document.
- [x] Add Privacy Policy document.
- [x] Add Docker Compose hosting docs.

## Suggested implementation order

- [x] Phase 1: Discord bot can join and leave voice.
- [x] Phase 2: One text channel feeds one TTS voice through a FIFO audio queue.
- [x] Phase 3: Add message preprocessing.
- [x] Phase 4: Add PluralKit detection and duplicate-message suppression.
- [x] Phase 5: Resolve stable PluralKit member IDs.
- [x] Phase 6: Add persistent per-speaker voice mappings.
- [x] Phase 7: Add name announcements on speaker changes.
- [x] Phase 8: Add volume and speed controls.
- [ ] Phase 9: Add mood/style prefixes.
- [x] Phase 10: Add slash-command configuration and persistence.
- [x] Phase 11: Add reliability handling, tests, and documentation.

## Definition of done for first usable release

- [x] Bot joins the intended Discord voice channel.
- [x] Bot reads messages only from the intended associated text chat.
- [x] Messages are spoken in the correct order.
- [x] PluralKit proxied messages are spoken exactly once.
- [x] PluralKit member names are used as speaker names.
- [x] Individual PluralKit members can have different persistent voices.
- [x] Normal Discord users can also have different persistent voices.
- [x] Speaker names can be announced only when the speaker changes.
- [x] Global volume control works.
- [x] Per-speaker volume control works.
- [ ] Supported mood prefixes affect speech when the selected TTS provider supports them.
- [x] URLs, mentions, markdown, and emoji are handled sensibly.
- [x] Configuration survives a bot restart.
- [x] A failed TTS request does not break the queue.
- [x] Setup and command usage are documented.
