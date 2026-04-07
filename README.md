# Monitor

Monitor is a lightweight ops/health-monitoring toolkit for Mac Mini services, with Discord alerting, cron scripts, and GitHub Actions checks.

## What this repo contains

- GitHub Actions uptime and health workflows
- Local health scripts (`scripts/health-check.sh`, cleanup utilities)
- Discord monitoring bot in `bot/`
- Docker Compose deployment for the bot
- Environment template for bot/webhook credentials

## Quick start

1. Copy env template:

```bash
cp .env.example .env
```

2. Fill required values in `.env`:

- `DISCORD_BOT_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_WEBHOOK_MONITORING`
- Optional: `MONITORING_CHANNEL_ID`

3. Register Discord slash commands (one-time):

```bash
docker compose run --rm bot node register-commands.js
```

4. Start the bot:

```bash
docker compose up -d
```

## Documentation

Full setup and deployment steps are documented in [SETUP.md](./SETUP.md).

## Operational notes

- The bot mounts Docker socket read-only for container status checks.
- `network_mode: host` is used to reach local services directly.
- Add log rotation settings for long-running deployments.
