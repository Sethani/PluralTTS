# Hosting PluralTTS

PluralTTS is best hosted as a two-service Docker Compose stack:

- `bot`: the Node.js Discord bot.
- `piper`: the local Piper HTTP sidecar.

The bot only needs outbound internet access. Piper should stay private to the host or Docker network.

## Budget Host Shape

For low-cost hosting, use a small VPS with Docker support.

Recommended minimum:

- 2 GB RAM.
- 1-2 vCPU.
- 25 GB disk.
- Ubuntu or Debian.
- Full root access.

1 GB RAM may work for light use, but Piper can be slow or memory-constrained.

## Deployment

Copy this repo to the host, create `.env`, and make sure `models/piper` contains the Piper model files and `models.json` catalog.

Register commands once:

```sh
docker compose run --rm bot npm run register-commands
```

Start the stack:

```sh
docker compose up -d --build
```

Check status:

```sh
docker compose ps
docker compose logs -f bot
curl http://127.0.0.1:18950/health
```

Stop the stack:

```sh
docker compose down
```

## Environment

Compose loads `.env`, then overrides the service-to-service settings:

```env
DATABASE_URL=sqlite:/data/plural-tts.db
TTS_PROVIDER=piper-http
PIPER_URL=http://piper:8080
```

The SQLite database is stored in the `plural-tts-data` Docker volume.

Reliability-related values you may want to tune:

```env
TTS_TIMEOUT_MS=15000
TTS_RETRY_ATTEMPTS=1
TTS_RETRY_DELAY_MS=500
AUTO_DISCONNECT_MS=300000
```

The `/tts status` reliability counters are in memory and reset when the bot container restarts.

## Secrets

Never commit `.env`. Also avoid sharing `docker compose config` output, because Docker expands `.env` values and may print the Discord token.

## Notes

If you also run `npm run dev` locally with the same token, Discord will see two bot processes. Stop one of them to avoid duplicate handling.
