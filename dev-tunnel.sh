#!/usr/bin/env bash
# Runs the game with public https:// addresses, so phones can join from any network
# and use the mic (phone browsers only allow the mic on https or localhost).
#
#   ./dev-tunnel.sh        (needs cloudflared: brew install cloudflared)
#
# Starts two free Cloudflare tunnels (no account needed), one for the web app and one for
# the game server, then starts both with the tunnel addresses. Ctrl+C stops everything.
# The addresses are passed as environment variables, so your .env files aren't changed.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v cloudflared >/dev/null; then
  echo "cloudflared isn't installed. Run: brew install cloudflared"
  exit 1
fi

# Stops the tunnels and anything serving the game's ports.
stop_all() {
  pkill -f "cloudflared tunnel --url" 2>/dev/null || true
  for port in 3000 4000; do
    lsof -ti :"$port" | xargs kill 2>/dev/null || true
  done
}

# Clear out anything left from an earlier run, and clean up when this script exits (Ctrl+C).
stop_all
trap 'trap - EXIT INT TERM; stop_all; exit' EXIT INT TERM

logs=$(mktemp -d)

# Starts a tunnel to a local port and prints its https:// address.
tunnel() {
  local port=$1 log="$logs/tunnel-$1.log"
  cloudflared tunnel --url "http://localhost:$port" >"$log" 2>&1 &
  for _ in $(seq 60); do
    local url
    url=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$log" | head -1 || true)
    if [ -n "$url" ]; then
      echo "$url"
      return
    fi
    sleep 0.5
  done
  echo "Couldn't start a tunnel for port $port. Log:" >&2
  cat "$log" >&2
  exit 1
}

echo "Starting tunnels..."
server_url=$(tunnel 4000)
web_url=$(tunnel 3000)

(cd server && PUBLIC_URL="$server_url" CLIENT_ORIGIN="http://localhost:3000,$web_url" npm run dev) &
(cd web && NEXT_PUBLIC_SERVER_URL="$server_url" npm run dev) &

sleep 3
echo
echo "  Host screen:  $web_url/host"
echo "  (players scan the QR code; it can take ~30s before the address works)"
echo
wait
