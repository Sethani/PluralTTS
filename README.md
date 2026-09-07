# PluralTTS

A minimal Discord voice-channel TTS bot with basic PluralKit support. It uses `discord.js`, `@discordjs/voice`, SQLite for development storage, and a modular Piper TTS provider so the database and speech engine can be swapped later.

## Requirements

- Node.js 22.12 or newer.
- A Discord application with a bot token.
- Discord gateway intents enabled in the Developer Portal:
  - Server Members Intent is not required for the MVP.
  - Message Content Intent is required.
  - Presence Intent is not required.
- Bot permissions:
  - Send Messages
  - Use Slash Commands
  - Read Message History
  - View Channels
  - Connect
  - Speak
- Piper installed as a CLI, or a compatible HTTP sidecar.
- One or more Piper voice model/config pairs in `PIPER_VOICES_DIR`.

## Setup

```sh
npm install
cp .env.example .env
npm run register-commands
npm run dev
```

For faster iteration, set `DISCORD_GUILD_ID` before `npm run register-commands` to register slash commands in one guild.

## Invite The Bot

In the Discord Developer Portal, open your application, then go to OAuth2 -> URL Generator.

Select these scopes:

- `bot`
- `applications.commands`

Select these bot permissions:

- View Channels
- Send Messages
- Read Message History
- Use Slash Commands
- Connect
- Speak

Open the generated URL and choose the server to invite the bot. The bot also needs Message Content Intent enabled under Bot -> Privileged Gateway Intents.

## Docker Compose

This repo includes the Piper HTTP sidecar from Solmate under `docker/piper-http` and expects Piper model files under `models/piper`.

For local or VPS hosting:

```sh
docker compose up -d --build
```

The compose stack runs:

- `bot`: the Discord bot.
- `piper`: the local Piper HTTP sidecar.
- `plural-tts-data`: a Docker volume containing the SQLite database.

Compose overrides the bot's runtime environment so the bot talks to Piper privately at `http://piper:8080` and stores SQLite data at `/data/plural-tts.db`.

To update slash commands from Docker, run:

```sh
docker compose run --rm bot npm run register-commands
```

## Piper Voices

The MVP expects voice IDs like `en_US-amy-medium`. The CLI provider resolves this to:

- `${PIPER_VOICES_DIR}/en_US-amy-medium.onnx`
- `${PIPER_VOICES_DIR}/en_US-amy-medium.onnx.json`

The bot does not download or bundle voice models. Review each voice model's license before use.

The checked-out `models/` directory is ignored by git because Piper model binaries are large. Copy or download the model files onto each host before starting the stack.

See [HOSTING.md](HOSTING.md) for VPS deployment notes.

## Commands

- `/tts join`: joins your current voice channel and binds TTS to the current text channel.
- `/tts leave`: disconnects and clears playback state for the server.
- `/tts status`: shows the voice connection, text channel, queue length, default voice, and in-memory reliability counters.
- `/tts skip`: skips the current spoken message.
- `/tts clear`: clears pending messages.
- `/tts voices`: lists voices reported by the configured TTS provider.
- `/tts ignore-me enabled:<true|false>`: opts your normal Discord messages out of, or back into, TTS.
- `/tts volume percent:<0-200>`: sets server volume.
- `/tts my-volume percent:<0-200>`: sets your Discord-user volume.
- `/tts last-volume percent:<0-200>`: sets the most recently detected speaker volume.
- `/tts pk-volume member-id:<id> percent:<0-200>`: sets a PluralKit member volume by stable member ID.
- `/tts speed multiplier:<0.5-2>`: sets server speech speed.
- `/tts my-speed multiplier:<0.5-2>`: sets your Discord-user speech speed.
- `/tts last-speed multiplier:<0.5-2>`: sets the most recently detected speaker speed.
- `/tts pk-speed member-id:<id> multiplier:<0.5-2>`: sets a PluralKit member speed by stable member ID.
- `/tts enable`: enables TTS message reading in the server.
- `/tts disable`: disables TTS message reading in the server and clears pending messages.
- `/tts voice set-user voice:<id>`: sets the invoking Discord user's voice.
- `/tts voice set-last voice:<id>`: sets the most recently detected speaker's voice, including a PluralKit member when the last message was proxied.
- `/tts voice set-pk member-id:<id> voice:<id>`: sets a PluralKit member's voice by stable member ID.
- `/tts voice set-default voice:<id>`: sets the server default voice.
- `/tts voice reset-user`: resets the invoking Discord user's voice to the server default.
- `/tts voice reset-last`: resets the most recently detected speaker's voice to the server default.
- `/tts voice reset-pk member-id:<id>`: resets a PluralKit member's voice by stable member ID.
- `/tts names mode:<mode>`: sets speaker-name announcements to always, only on speaker change, or never.
- `/tts permissions show`: shows delegated TTS permissions.
- `/tts permissions allow permission:<permission> scope:<everyone|role> role:<role?>`: grants a permission to everyone or a role.
- `/tts permissions deny permission:<permission> scope:<everyone|role> role:<role?>`: removes a delegated permission grant.
- `/tts pronounce add from:<text> to:<text>`: adds a server-wide pronunciation replacement.
- `/tts pronounce remove from:<text>`: removes a pronunciation replacement.
- `/tts pronounce list`: lists pronunciation replacements.

Voice options support Discord autocomplete after the updated command schema has been registered.

Volume is applied as `server volume * speaker volume` and clamped to 0-200%. Speed uses the speaker-specific value when present, otherwise the server value.

## Permissions

The server owner and members with Discord's `Administrator` permission can always manage TTS. Permission management commands are admin-only and cannot lock admins out.

Everyone can use informational and personal controls: `/tts status`, `/tts voices`, `/tts ignore-me`, `/tts my-volume`, `/tts my-speed`, `/tts voice set-user`, and `/tts voice reset-user`.

Other controls require one of these delegated TTS permissions:

- `join`: `/tts join`
- `leave`: `/tts leave`
- `skip`: `/tts skip`
- `clear`: `/tts clear`
- `server_settings`: `/tts enable`, `/tts disable`, `/tts volume`, `/tts speed`, `/tts names`, `/tts voice set-default`
- `speaker_settings`: `/tts last-volume`, `/tts last-speed`, `/tts pk-volume`, `/tts pk-speed`, `/tts voice set-last`, `/tts voice reset-last`, `/tts voice set-pk`, `/tts voice reset-pk`

`/tts skip` also works for non-admin users who are currently in the bound voice channel, even without a grant.

## PluralKit Behavior

Webhook messages are checked against PluralKit's `GET /messages/{messageId}` endpoint. Confirmed PluralKit messages use the member ID internally and the member display/name for speech. Normal Discord messages are delayed briefly so the bot can cancel the original message if PluralKit deletes it during proxying.

To set a PluralKit voice without relying on the last detected speaker, use the member's stable PluralKit ID with `/tts voice set-pk`. The command accepts either `abcde` or `pluralkit_member:abcde` and stores both as `pluralkit_member:abcde`.

## Reliability

The playback queue advances after TTS or Discord playback failures, so one broken message should not block later speech. TTS synthesis retries are limited to the pre-playback step where a retry cannot duplicate audio.

While one message is playing, the bot prepares the next queued message in the background. It only prepares one item ahead to reduce silence without overloading Piper or wasting too much work when the queue is cleared.

Useful environment settings:

- `TTS_TIMEOUT_MS`: aborts stalled TTS requests or CLI synthesis.
- `TTS_RETRY_ATTEMPTS`: retries failed synthesis before playback starts. Defaults to `1`.
- `TTS_RETRY_DELAY_MS`: delay between TTS retry attempts. Defaults to `500`.
- `AUTO_DISCONNECT_MS`: disconnects after the bound voice channel has no human listeners. Set `0` to disable.

The Piper HTTP provider rejects empty or non-audio responses. The PluralKit client caches successful and missing-message lookups, reports lookup failures to status counters, and pauses lookups briefly when PluralKit returns `429`.

If a saved speaker voice is no longer available, the bot falls back to the server default. If the server default is also unavailable, it uses the first voice reported by the provider. Messages are skipped only when the provider reports no voices or cannot list voices.

Persisted settings are normalized at use time so out-of-range volume/speed and unknown name modes fall back to safe values.

## Pronunciation And Emoji

Unicode emoji are converted to spoken names where known, and to `emoji` otherwise. Custom Discord emoji continue to use their custom names.

Pronunciation replacements are server-wide, require the `server_settings` TTS permission, and are applied after Discord markup/mention cleanup but before truncation. Matching is case-insensitive and whole-word/whole-phrase. Each replacement is applied once per preprocessing pass to avoid recursive replacements.

## Mood and Style

Piper does not support prompt-style mood controls such as `[happy]`, `[sad]`, or `[angry]`. Voice choice is the main expressiveness control while using Piper. The provider interface still has a `style` field so a future remote TTS provider can support mood/style without changing Discord command routing. The bundled Piper sidecar does support speed by translating the multiplier to Piper `length_scale`.

## Known MVP Limits

Pronunciation overrides are intentionally left for later phases.
