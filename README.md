# PluralTTS

A minimal Discord voice-channel TTS bot with basic PluralKit support. It uses `discord.js`, `@discordjs/voice`, SQLite or PostgreSQL for storage, and a modular Piper TTS provider so the database and speech engine can be swapped later.

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

## Database

SQLite is the default and is enough for one-machine development or small self-hosting:

```env
DATABASE_URL=sqlite:./plural-tts.db
```

PostgreSQL is supported for hosted databases and production-style deployments:

```env
DATABASE_URL=postgresql://user:password@host:5432/database
DATABASE_URL=postgresql://user:password@host:5432/database?sslmode=require
```

`postgres://` URLs also work. Use `sslmode=require` for hosted providers that require TLS.

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

To point the Docker bot at a hosted database, set `BOT_DATABASE_URL` in `.env`:

```env
BOT_DATABASE_URL=postgresql://user:password@host:5432/database?sslmode=require
```

For a local Postgres container, start the optional profile and use `postgres` as the host from inside Docker:

```sh
docker compose --profile postgres up -d postgres
```

```env
BOT_DATABASE_URL=postgresql://plural_tts:change-me@postgres:5432/plural_tts
```

To update slash commands from Docker, run:

```sh
docker compose run --rm bot npm run register-commands
```

## Piper Voices

The MVP expects voice IDs like `en_US-amy-medium`. The CLI provider resolves this to:

- `${PIPER_VOICES_DIR}/en_US-amy-medium.onnx`
- `${PIPER_VOICES_DIR}/en_US-amy-medium.onnx.json`

The bot does not bundle voice models. Review each voice model's license before use. The `rhasspy/piper-voices` repository is MIT licensed on Hugging Face, but individual voice/data provenance is still worth checking when choosing voices.

The checked-out `models/` directory is ignored by git because Piper model binaries are large. Copy or download the model files onto each host before starting the stack.

You can discover and download English Piper voices from Hugging Face:

```sh
npm run voices:list -- --language en_US --quality medium
npm run voices:list -- --root de --root fr --root nl
npm run voices:download -- --voice en_US-amy-medium
npm run voices:download -- --root de --root fr --root nl --root ja --root es --root zh --all
npm run voices:download -- --language en_GB --quality medium --limit 5
npm run voices:cleanup -- --dry-run
npm run voices:cleanup
```

The downloader fetches matching `.onnx` and `.onnx.json` files into `models/piper`, then merges new voices into `models/piper/models.json`. Voice IDs stay canonical, such as `en_GB-northern_english_male-medium`, while friendly names such as `Dave` are labels. By default it selects only the highest available quality for each voice family. Use `--all-qualities` if you intentionally want low/medium/high variants.

The cleanup command removes duplicate alias entries, unused model files, `ALIASES`, and `MODEL_CARD` files. It keeps friendly names and known gender labels on canonical voice IDs.

See [HOSTING.md](HOSTING.md) for VPS deployment notes.

## Commands

- `/tts join`: joins your current voice channel and binds TTS to the current text channel.
- `/tts leave`: disconnects and clears playback state for the server.
- `/tts status`: shows the voice connection, text channel, queue length, default voice, and in-memory reliability counters.
- `/tts skip`: skips the current spoken message.
- `/tts clear`: clears pending messages.
- `/tts voices language:<code?>`: lists voice languages, or friendly voice names for one language.
- `/tts ignore-me enabled:<true|false>`: opts your normal Discord messages out of, or back into, TTS.
- `/tts nickname name:<text>`: sets the name TTS uses when announcing your normal Discord messages.
- `/tts nickname-clear`: clears your Discord TTS nickname.
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
- `/tts pronounce speaker-add member-id:<id> from:<text> to:<text>`: adds a PluralKit member-specific pronunciation replacement.
- `/tts pronounce speaker-remove member-id:<id> from:<text>`: removes a PluralKit member-specific pronunciation replacement.
- `/tts pronounce speaker-list member-id:<id>`: lists PluralKit member-specific pronunciation replacements.
- `/tts pronounce name-set member-id:<id> spoken-as:<text>`: sets how a PluralKit member name is announced.
- `/tts pronounce name-clear member-id:<id>`: clears a PluralKit member name pronunciation.

Voice options support Discord autocomplete after the updated command schema has been registered. Start typing a friendly name, language code, or gender hint, such as `Dave`, `nl_NL`, `zh`, `fem`, or `masc`, then choose one of Discord's suggested voices. The stored value remains the canonical Piper ID, but normal users should not need to type it.

Volume is applied as `server volume * speaker volume` and clamped to 0-200%. Speed uses the speaker-specific value when present, otherwise the server value.

## Permissions

The server owner and members with Discord's `Administrator` permission can always manage TTS. Permission management commands are admin-only and cannot lock admins out.

Everyone can use informational and personal controls: `/tts status`, `/tts voices`, `/tts ignore-me`, `/tts nickname`, `/tts nickname-clear`, `/tts my-volume`, `/tts my-speed`, `/tts voice set-user`, and `/tts voice reset-user`.

Other controls require one of these delegated TTS permissions:

- `join`: `/tts join`
- `leave`: `/tts leave`
- `skip`: `/tts skip`
- `clear`: `/tts clear`
- `server_settings`: `/tts enable`, `/tts disable`, `/tts volume`, `/tts speed`, `/tts names`, `/tts voice set-default`, `/tts pronounce add`, `/tts pronounce remove`, `/tts pronounce list`
- `speaker_settings`: `/tts last-volume`, `/tts last-speed`, `/tts pk-volume`, `/tts pk-speed`, `/tts voice set-last`, `/tts voice reset-last`, `/tts voice set-pk`, `/tts voice reset-pk`, `/tts pronounce speaker-add`, `/tts pronounce speaker-remove`, `/tts pronounce speaker-list`, `/tts pronounce name-set`, `/tts pronounce name-clear`

`/tts join` also works for non-admin users who are currently in any voice channel, even without a grant. `/tts leave` and `/tts skip` also work for non-admin users who are currently in the bound voice channel. Grants are only needed when you want broader access than that.

## PluralKit Behavior

Webhook messages are checked against PluralKit's `GET /messages/{messageId}` endpoint. Confirmed PluralKit messages use the member ID internally and the member display/name for speech. Normal Discord messages are delayed briefly so the bot can cancel the original message if PluralKit deletes it during proxying.

To set a PluralKit voice without relying on the last detected speaker, use the member's stable PluralKit ID with `/tts voice set-pk`. The command accepts either `abcde` or `pluralkit_member:abcde` and stores both as `pluralkit_member:abcde`.

PluralKit member-specific pronunciation commands use that same stable member ID, so replacements and spoken-name settings survive display-name changes.

For normal Discord messages, each user can set their own TTS announcement nickname with `/tts nickname`. This does not affect PluralKit messages, which use the PluralKit member name or member-specific spoken-name override.

## Reliability

The playback queue advances after TTS or Discord playback failures, so one broken message should not block later speech. TTS synthesis retries are limited to the pre-playback step where a retry cannot duplicate audio.

While one message is playing, the bot prepares the next queued message in the background. It only prepares one item ahead to reduce silence without overloading Piper or wasting too much work when the queue is cleared.

Useful environment settings:

- `TTS_TIMEOUT_MS`: aborts stalled TTS requests or CLI synthesis.
- `TTS_RETRY_ATTEMPTS`: retries failed synthesis before playback starts. Defaults to `1`.
- `TTS_RETRY_DELAY_MS`: delay between TTS retry attempts. Defaults to `500`.
- `AUTO_DISCONNECT_MS`: disconnects after the bound voice channel has no human listeners. Set `0` to disable.

The Piper HTTP provider rejects empty or non-audio responses. The PluralKit client caches successful and missing-message lookups, reports lookup failures to status counters, and pauses lookups briefly when PluralKit returns `429`.

Fresh PluralKit webhook messages are retried briefly before the bot gives up, because the webhook can arrive before PluralKit's message API is ready. Tune this with `PLURALKIT_WEBHOOK_LOOKUP_ATTEMPTS` and `PLURALKIT_WEBHOOK_LOOKUP_DELAY_MS`.

If a saved speaker voice is no longer available, the bot falls back to the server default. If the server default is also unavailable, it uses the first voice reported by the provider. Messages are skipped only when the provider reports no voices or cannot list voices.

Persisted settings are normalized at use time so out-of-range volume/speed and unknown name modes fall back to safe values.

## Pronunciation And Emoji

Unicode emoji are converted to spoken names where known, and to `emoji` otherwise. Custom Discord emoji continue to use their custom names.

Pronunciation replacements are applied after Discord markup/mention cleanup but before truncation. Server-wide replacements require the `server_settings` TTS permission. PluralKit member-specific replacements and spoken-name overrides require `speaker_settings`.

Matching is case-insensitive and whole-word/whole-phrase. Each replacement is applied once per preprocessing pass to avoid recursive replacements. When a server-wide and speaker-specific replacement use the same source text, the speaker-specific replacement wins for that speaker.

## Mood and Style

Piper does not support prompt-style mood controls such as `[happy]`, `[sad]`, or `[angry]`. Voice choice is the main expressiveness control while using Piper. The provider interface still has a `style` field so a future remote TTS provider can support mood/style without changing Discord command routing. The bundled Piper sidecar does support speed by translating the multiplier to Piper `length_scale`.

## Known MVP Limits

Mood/style prefixes are intentionally left for a future provider that supports them.
