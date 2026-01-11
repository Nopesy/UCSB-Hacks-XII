#!/usr/bin/env bash
# Simple smoke test: POST sample events to Node API and GET them back
set -euo pipefail
NODE_API=${NODE_API:-http://localhost:3001}

echo "Posting sample events to $NODE_API/api/events/sync"
curl -s -X POST "$NODE_API/api/events/sync" -H "Content-Type: application/json" -d '{"user_id":"demo-user","events":[{"id":"evt1","calendar_id":"primary","title":"Test Event","description":"desc","location":"","start":"2026-01-10T15:00:00-08:00","end":"2026-01-10T16:00:00-08:00","raw":{}}]}' | jq -C || true

echo
sleep 1

echo "Fetching events for demo-user"
curl -s "$NODE_API/api/events?user_id=demo-user" | jq -C || true
