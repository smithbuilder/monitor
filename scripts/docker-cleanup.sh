#!/bin/bash
# docker-cleanup.sh — Weekly Docker disk cleanup for Mac Mini
# Install: Add to crontab on Mac Mini
#   0 3 * * 0 /usr/local/bin/docker-cleanup.sh >> /tmp/docker-cleanup.log 2>&1
#
# Or run manually: bash docker-cleanup.sh

set -euo pipefail
export PATH=/opt/orbstack/bin:/usr/local/bin:$PATH

WEBHOOK_URL="${DISCORD_WEBHOOK_MONITORING:-}"
TIMESTAMP=$(date "+%Y-%m-%d %H:%M")

echo "=== Docker Cleanup — $TIMESTAMP ==="

# Capture before stats
BEFORE=$(docker system df --format "table {{.Type}}\t{{.Size}}\t{{.Reclaimable}}" 2>/dev/null)
echo "Before:"
echo "$BEFORE"

# Remove stopped containers older than 24h
echo ""
echo "--- Pruning stopped containers (>24h) ---"
docker container prune -f --filter "until=24h" 2>/dev/null || true

# Remove unused images older than 7 days
echo ""
echo "--- Pruning unused images (>7 days) ---"
docker image prune -f --filter "until=168h" 2>/dev/null || true

# Remove dangling images
echo ""
echo "--- Pruning dangling images ---"
docker image prune -f 2>/dev/null || true

# Remove build cache older than 7 days
echo ""
echo "--- Pruning build cache (>7 days) ---"
docker builder prune -f --filter "until=168h" 2>/dev/null || true

# Remove unused networks
echo ""
echo "--- Pruning unused networks ---"
docker network prune -f 2>/dev/null || true

# NOTE: We intentionally do NOT prune volumes — they may contain database data
# If you want to prune volumes too, uncomment the next line (DANGEROUS):
# docker volume prune -f 2>/dev/null || true

# Capture after stats
AFTER=$(docker system df --format "table {{.Type}}\t{{.Size}}\t{{.Reclaimable}}" 2>/dev/null)
echo ""
echo "After:"
echo "$AFTER"

# Get disk free space
DISK_FREE=$(df -h /System/Volumes/Data 2>/dev/null | tail -1 | awk '{print $4}') || DISK_FREE="unknown"

echo ""
echo "Disk free after cleanup: $DISK_FREE"
echo "=== Cleanup complete ==="

# Send Discord notification if webhook is configured
if [ -n "$WEBHOOK_URL" ]; then
  curl -s -H "Content-Type: application/json" -d "{
    \"username\": \"Mac Mini Monitor\",
    \"embeds\": [{
      \"title\": \":broom: Docker Cleanup Complete\",
      \"color\": 3066993,
      \"fields\": [
        {\"name\": \"Disk Free\", \"value\": \"$DISK_FREE\", \"inline\": true},
        {\"name\": \"Timestamp\", \"value\": \"$TIMESTAMP\", \"inline\": true}
      ],
      \"footer\": {\"text\": \"Weekly Docker cleanup\"}
    }]
  }" "$WEBHOOK_URL"
fi
