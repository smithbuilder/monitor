# Monitor — Setup Guide

## What's Included

```
monitor/
├── .github/workflows/
│   ├── uptime.yml          # Every 15 min — curl all services, alert Discord on failure
│   ├── health-digest.yml   # Every 6 hours — SSH health report with disk/docker/memory
│   └── daily-report.yml    # 8 AM EST daily — comprehensive audit
├── scripts/
│   ├── health-check.sh     # Mac Mini cron script — comprehensive local health check
│   ├── docker-cleanup.sh   # Weekly Docker disk cleanup
│   └── docker-log-rotation.json  # Docker daemon config to cap log sizes
├── bot/
│   ├── bot.js              # Discord bot — /status, /disk, /docker, /services, /logs, /cleanup
│   ├── register-commands.js
│   ├── Dockerfile
│   └── package.json
├── docker-compose.yml      # Deploy bot on Mac Mini
└── .env.example            # Required environment variables
```

## Step 1: Push to GitHub (Public Repo for Free GHA Minutes)

```bash
cd C:\Users\olive\Projects\monitor
gh repo create jkthndr/monitor --public --source=. --push
```

## Step 2: Add GitHub Secrets

You already have most of these from your deploy workflows. Go to the repo Settings > Secrets > Actions and add:

| Secret | Value | Notes |
|--------|-------|-------|
| `TAILSCALE_AUTHKEY` | Your Tailscale auth key | Already have this |
| `MAC_MINI_HOST` | `100.94.30.56` | Already have this |
| `MAC_MINI_USER` | `oliversmith` | Already have this |
| `DEPLOY_KEY` | SSH private key | Already have this |
| `DISCORD_WEBHOOK_MONITORING` | Discord webhook URL | Create a new webhook in your #monitoring channel |

## Step 3: Create Discord Webhook

1. In Discord, go to your server
2. Create a `#monitoring` channel (or use existing)
3. Channel Settings > Integrations > Webhooks > New Webhook
4. Name it "Mac Mini Monitor", copy the URL
5. Add as `DISCORD_WEBHOOK_MONITORING` in both GitHub Secrets and Mac Mini env

## Step 4: Apply Docker Log Rotation on Mac Mini

SSH into the Mac Mini and configure Docker/OrbStack log rotation:

```bash
ssh -i ~/.ssh/mac_mini_key oliversmith@100.94.30.56

# Check if OrbStack uses Docker daemon.json
# OrbStack may handle this differently — check first:
docker info --format '{{.LoggingDriver}}'

# If using json-file driver, set log rotation per-container
# The safest approach with OrbStack is adding logging config to each docker-compose.yml
```

For each docker-compose.yml on the Mac Mini, add logging config:

```yaml
services:
  your-service:
    # ... existing config ...
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

Then recreate containers: `docker compose down && docker compose up -d`

## Step 5: Install Health Check Cron on Mac Mini

```bash
ssh -i ~/.ssh/mac_mini_key oliversmith@100.94.30.56

# Copy scripts
mkdir -p ~/monitor-scripts

# (From your Windows machine, SCP the scripts:)
# scp -i ~/.ssh/mac_mini_key scripts/health-check.sh scripts/docker-cleanup.sh oliversmith@100.94.30.56:~/monitor-scripts/

# Make executable
chmod +x ~/monitor-scripts/health-check.sh ~/monitor-scripts/docker-cleanup.sh

# Add to crontab
crontab -e
```

Add these cron entries:

```cron
# Health check every 5 minutes
*/5 * * * * DISCORD_WEBHOOK_MONITORING="https://discord.com/api/webhooks/..." /Users/oliversmith/monitor-scripts/health-check.sh >> /tmp/health-check.log 2>&1

# Docker cleanup weekly (Sunday 3 AM)
0 3 * * 0 DISCORD_WEBHOOK_MONITORING="https://discord.com/api/webhooks/..." /Users/oliversmith/monitor-scripts/health-check.sh >> /tmp/docker-cleanup.log 2>&1
```

## Step 6: Discord Bot (Optional)

### Create Bot Application

1. Go to https://discord.com/developers/applications
2. New Application > Name it "Mac Mini Monitor"
3. Bot tab > Reset Token > Copy token
4. Bot tab > Enable "Message Content Intent" (under Privileged Gateway Intents)
5. OAuth2 tab > URL Generator:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Embed Links`, `Read Message History`
6. Copy generated URL, open in browser to invite bot to your server

### Deploy Bot on Mac Mini

```bash
ssh -i ~/.ssh/mac_mini_key oliversmith@100.94.30.56

cd ~/monitor  # or wherever you cloned the repo

# Create .env file
cp .env.example .env
# Edit .env with your bot token, client ID, channel ID, webhook URL

# Register slash commands (one-time)
docker compose run --rm bot node register-commands.js

# Start the bot
docker compose up -d
```

### Verify

Type `/status` in any channel the bot can see. You should get a server health embed.

## Architecture

```
Mac Mini Health Monitoring — 4 Layers

Layer 1: Cron Scripts (on Mac Mini)          ← health-check.sh, docker-cleanup.sh
  └── Fires Discord webhook on issues
  └── Every 5 min (health), weekly (cleanup)

Layer 2: GitHub Actions (external)           ← .github/workflows/*.yml
  ├── uptime.yml: curl services every 15 min
  ├── health-digest.yml: SSH metrics every 6 hours
  └── daily-report.yml: full audit at 8 AM EST
  └── Catches issues even when Mac Mini can't alert (total outage)

Layer 3: Discord Bot (on Mac Mini)           ← bot/bot.js
  ├── /status /disk /docker /services /logs /cleanup
  └── Hourly auto-post to #monitoring

Layer 4: External (optional future)
  └── StatusCake, Beszel, Uptime Kuma
```
