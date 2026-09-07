# Privacy Policy

Last updated: 2026-09-07

PluralTTS is a self-hosted Discord bot that reads messages aloud from a configured Discord text channel while connected to a voice channel.

## Data Processed

The bot processes Discord message content from the bound text channel so it can generate speech. It may also process Discord user IDs, guild IDs, channel IDs, display names, and PluralKit member IDs/names.

## Data Stored

The MVP stores configuration in the configured database:

- Guild settings.
- Bound text and voice channel IDs.
- Voice mappings for Discord users and PluralKit members.
- Name announcement mode.

The bot does not intentionally store message contents. Logs avoid message contents by default and redact token-like fields.

## PluralKit

For webhook messages, the bot may call PluralKit's message lookup endpoint with the Discord message ID to identify the proxied PluralKit member. Lookup results may be cached in memory while the bot is running.

## TTS Provider

Message text is sent to the configured TTS provider or sidecar to generate audio. With the default local Piper setup, this stays on the host running the sidecar. If you configure a remote TTS provider, that provider may receive message text.

## Data Retention

Persistent configuration remains until deleted from the database or reset with bot commands. In-memory PluralKit lookup cache is cleared when the bot restarts.

## Contact

For a hosted instance, replace this section with the operator's contact information.

## Notes

This policy is a practical template for a self-hosted bot and is not legal advice.
