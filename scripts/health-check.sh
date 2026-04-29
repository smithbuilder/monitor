#!/bin/bash
# health-check.sh — Comprehensive Mac Mini health check with Discord alerts
# Install: Add to crontab on Mac Mini
#   */5 * * * * DISCORD_WEBHOOK_MONITORING="https://discord.com/api/webhooks/..." /usr/local/bin/health-check.sh
#
# Or run manually: DISCORD_WEBHOOK_MONITORING="..." bash health-check.sh

set -eo pipefail
export PATH=/opt/orbstack/bin:/usr/local/bin:/opt/homebrew/bin:$PATH

WEBHOOK_URL="${DISCORD_WEBHOOK_MONITORING:-}"
DISK_THRESHOLD=80
MEMORY_THRESHOLD=85
LOG_SIZE_THRESHOLD_MB=100

ALERTS=""
ALERT_COUNT=0

add_alert() {
  ALERTS="${ALERTS}\n:warning: $1"
  ALERT_COUNT=$((ALERT_COUNT + 1))
}

# --- Disk Space Check ---
DISK_PCT=$(df /System/Volumes/Data 2>/dev/null | tail -1 | awk '{print $5}' | tr -d '%') || DISK_PCT=0
DISK_FREE=$(df -h /System/Volumes/Data 2>/dev/null | tail -1 | awk '{print $4}') || DISK_FREE="unknown"

if [ "$DISK_PCT" -gt "$DISK_THRESHOLD" ] 2>/dev/null; then
  add_alert "**Disk at ${DISK_PCT}%** (${DISK_FREE} free) — threshold: ${DISK_THRESHOLD}%"
fi

# --- Memory Check (macOS) ---
# Parse vm_stat for memory pressure
PAGE_SIZE=$(sysctl -n hw.pagesize 2>/dev/null || echo 4096)
VM_STAT=$(vm_stat 2>/dev/null)
if [ -n "$VM_STAT" ]; then
  PAGES_FREE=$(echo "$VM_STAT" | awk '/Pages free:/ {print $3}' | tr -d '.')
  PAGES_INACTIVE=$(echo "$VM_STAT" | awk '/Pages inactive:/ {print $3}' | tr -d '.')
  PAGES_ACTIVE=$(echo "$VM_STAT" | awk '/Pages active:/ {print $3}' | tr -d '.')
  PAGES_WIRED=$(echo "$VM_STAT" | awk '/Pages wired down:/ {print $4}' | tr -d '.')
  PAGES_COMPRESSED=$(echo "$VM_STAT" | awk '/Pages occupied by compressor:/ {print $5}' | tr -d '.')

  TOTAL_PAGES=$((PAGES_FREE + PAGES_INACTIVE + PAGES_ACTIVE + PAGES_WIRED + PAGES_COMPRESSED))
  USED_PAGES=$((PAGES_ACTIVE + PAGES_WIRED + PAGES_COMPRESSED))

  if [ "$TOTAL_PAGES" -gt 0 ] 2>/dev/null; then
    MEM_PCT=$((USED_PAGES * 100 / TOTAL_PAGES))
    FREE_MB=$(( (PAGES_FREE + PAGES_INACTIVE) * PAGE_SIZE / 1024 / 1024 ))

    if [ "$MEM_PCT" -gt "$MEMORY_THRESHOLD" ] 2>/dev/null; then
      add_alert "**Memory at ${MEM_PCT}%** (${FREE_MB}MB free) — threshold: ${MEMORY_THRESHOLD}%"
    fi
  fi
fi

# --- Docker Status Check ---
if ! docker info >/dev/null 2>&1; then
  add_alert "**Docker/OrbStack is not running!**"
else
  # Check for stopped/crashed containers
  STOPPED=$(docker ps -a --filter "status=exited" --format "{{.Names}}" 2>/dev/null)
  if [ -n "$STOPPED" ]; then
    STOPPED_LIST=$(echo "$STOPPED" | tr '\n' ', ' | sed 's/,$//')
    add_alert "**Stopped containers:** ${STOPPED_LIST}"
  fi

  # Check for restarting containers (crash loop)
  RESTARTING=$(docker ps -a --filter "status=restarting" --format "{{.Names}}" 2>/dev/null)
  if [ -n "$RESTARTING" ]; then
    RESTART_LIST=$(echo "$RESTARTING" | tr '\n' ', ' | sed 's/,$//')
    add_alert "**Crash-looping containers:** ${RESTART_LIST}"
  fi

  # Check container log sizes
  for container in $(docker ps --format "{{.Names}}" 2>/dev/null); do
    log_file=$(docker inspect --format='{{.LogPath}}' "$container" 2>/dev/null)
    if [ -n "$log_file" ] && [ -f "$log_file" ]; then
      size_bytes=$(stat -f%z "$log_file" 2>/dev/null || stat -c%s "$log_file" 2>/dev/null || echo 0)
      size_mb=$((size_bytes / 1024 / 1024))
      if [ "$size_mb" -gt "$LOG_SIZE_THRESHOLD_MB" ] 2>/dev/null; then
        add_alert "**Container log too large:** ${container} — ${size_mb}MB (limit: ${LOG_SIZE_THRESHOLD_MB}MB)"
      fi
    fi
  done
fi

# --- Bare Node.js App Checks ---
for port_name in "3000:OpenRouter Log Viewer" "3003:Homebase" "3004:Project Coach"; do
  port="${port_name%%:*}"
  name="${port_name##*:}"
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://localhost:$port" 2>/dev/null || echo "000")
  if [ "$code" = "000" ]; then
    add_alert "**${name}** (port ${port}) is **not responding**"
  fi
done

# --- Docker App Health Checks ---
for port_name in "3010:SmithBuilder"; do
  port="${port_name%%:*}"
  name="${port_name##*:}"
  url="http://localhost:${port}/"
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null || echo "000")
  if [ "$code" = "000" ]; then
    add_alert "**${name}** (port ${port}) is **not responding**"
  fi
done

# --- Ollama Check ---
OLLAMA_OK=$(curl -s --max-time 5 http://127.0.0.1:11434/api/tags 2>/dev/null | head -c 1)
if [ "$OLLAMA_OK" != "{" ]; then
  add_alert "**Ollama** is not responding on port 11434"
fi

# --- Send Alert if Any Issues Found ---
if [ "$ALERT_COUNT" -gt 0 ] && [ -n "$WEBHOOK_URL" ]; then
  TIMESTAMP=$(date -u +"%Y-%m-%d %H:%M UTC")

  if [ "$ALERT_COUNT" -ge 3 ]; then
    COLOR=15158332  # Red
    TITLE="CRITICAL: ${ALERT_COUNT} Issues Detected"
  else
    COLOR=15844367  # Yellow
    TITLE="WARNING: ${ALERT_COUNT} Issue(s) Detected"
  fi

  curl -s -H "Content-Type: application/json" -d "{
    \"username\": \"Mac Mini Monitor\",
    \"embeds\": [{
      \"title\": \"${TITLE}\",
      \"description\": \"$(echo -e "$ALERTS")\",
      \"color\": ${COLOR},
      \"footer\": {\"text\": \"Health check at ${TIMESTAMP}\"},
      \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\"
    }]
  }" "$WEBHOOK_URL"
fi

# Always output for cron log
if [ "$ALERT_COUNT" -gt 0 ]; then
  echo "[$(date)] ALERT: ${ALERT_COUNT} issue(s) found"
  echo -e "$ALERTS"
  exit 1
else
  echo "[$(date)] OK: All checks passed"
fi
