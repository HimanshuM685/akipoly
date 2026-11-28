#!/bin/sh
# Wipe all game data (clears the leaderboard). Users are kept.
# Usage: scripts/wipe-game-data.sh [--force]
set -e
cd "$(dirname "$0")/.."
docker compose build game
docker compose stop game
docker compose run --rm --no-deps game node dist/db/wipe-games.js --yes "$@" || { docker compose start game; exit 1; }
docker compose start game
