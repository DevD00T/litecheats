#!/usr/bin/env bash
# One-time setup (safe to re-run) for the Litecheats DigitalOcean droplet.
#
#   cd /path/to/litecheats && bash deploy/setup-droplet.sh
#
# It installs Bun, pm2 and cloudflared, builds the web app, connects the
# Cloudflare Tunnel for pwa.litecheats.cc, and starts three pm2 processes
# (litecheats-web, litecheats-tunnel, litecheats-bridge) that come back after
# a reboot. See deploy/README.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
HOSTNAME_PUBLIC="${PUBLIC_HOSTNAME:-pwa.litecheats.cc}"
TUNNEL_NAME="${TUNNEL_NAME:-litecheats-pwa}"
PORT="${PORT:-8080}"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!!  %s\033[0m\n' "$*"; }

# ── Checks ───────────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
	warn ".env is missing. Copy .env.example to .env and fill in MONGODB_URI, Razorpay keys etc. first."
	exit 1
fi
grep -q '^MONGODB_URI=.\+' .env || { warn "MONGODB_URI is empty in .env."; exit 1; }
grep -q '^ANDROID_PUBLISH_TOKEN=.\+' .env || warn "ANDROID_PUBLISH_TOKEN is not set in .env: build.ps1 cannot auto-publish APKs until it is."

# ── Packages ─────────────────────────────────────────────────────────────────
say "System packages"
if command -v apt-get >/dev/null; then
	sudo apt-get update -qq
	sudo apt-get install -y -qq git curl unzip ca-certificates >/dev/null
fi

say "Bun"
if ! command -v bun >/dev/null && [ ! -x "$HOME/.bun/bin/bun" ]; then
	curl -fsSL https://bun.sh/install | bash
fi
export PATH="$HOME/.bun/bin:$PATH"
bun --version

say "Node.js and pm2"
if ! command -v node >/dev/null; then
	curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
	sudo apt-get install -y -qq nodejs >/dev/null
fi
command -v pm2 >/dev/null || sudo npm install -g pm2
pm2 --version

say "cloudflared"
if ! command -v cloudflared >/dev/null; then
	sudo mkdir -p --mode=0755 /usr/share/keyrings
	curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
	echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" |
		sudo tee /etc/apt/sources.list.d/cloudflared.list >/dev/null
	sudo apt-get update -qq && sudo apt-get install -y -qq cloudflared >/dev/null
fi
cloudflared --version

# ── App ──────────────────────────────────────────────────────────────────────
say "Installing dependencies and building the web app"
bun install --frozen-lockfile
bun run build

# ── Tunnel ───────────────────────────────────────────────────────────────────
say "Cloudflare Tunnel for $HOSTNAME_PUBLIC"
if grep -q '^CLOUDFLARE_TUNNEL_TOKEN=.\+' .env; then
	echo "Using CLOUDFLARE_TUNNEL_TOKEN from .env (dashboard-managed tunnel)."
	echo "In Cloudflare Zero Trust > Networks > Tunnels, give it the public hostname"
	echo "$HOSTNAME_PUBLIC -> http://localhost:$PORT"
elif [ -f deploy/cloudflared.yml ]; then
	echo "deploy/cloudflared.yml already exists; keeping it."
else
	if [ ! -f "$HOME/.cloudflared/cert.pem" ]; then
		echo "Log in to Cloudflare: open the URL below and pick the litecheats.cc zone."
		cloudflared tunnel login
	fi
	if ! cloudflared tunnel info "$TUNNEL_NAME" >/dev/null 2>&1; then
		cloudflared tunnel create "$TUNNEL_NAME"
	fi
	TUNNEL_ID="$(cloudflared tunnel info "$TUNNEL_NAME" 2>/dev/null | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -n1)"
	[ -n "$TUNNEL_ID" ] || { warn "Could not read the tunnel id."; exit 1; }
	sed -e "s#TUNNEL_ID#$TUNNEL_ID#" \
		-e "s#CREDENTIALS_FILE#$HOME/.cloudflared/$TUNNEL_ID.json#" \
		-e "s#pwa.litecheats.cc#$HOSTNAME_PUBLIC#" \
		-e "s#localhost:8080#localhost:$PORT#" \
		deploy/cloudflared.example.yml >deploy/cloudflared.yml
	# Creates (or repoints) the proxied CNAME pwa.litecheats.cc -> <id>.cfargotunnel.com.
	cloudflared tunnel route dns --overwrite-dns "$TUNNEL_NAME" "$HOSTNAME_PUBLIC"
fi

# ── Processes ────────────────────────────────────────────────────────────────
say "pm2 processes"
if ss -ltnp 2>/dev/null | grep -q ":$PORT " && ! pm2 describe litecheats-web >/dev/null 2>&1; then
	warn "Something else already listens on :$PORT:"
	ss -ltnp | grep ":$PORT " || true
	warn "Stop the old server (e.g. 'pm2 delete <old name>' or 'systemctl stop <unit>'), then re-run this script."
	exit 1
fi
BUN_BIN="$HOME/.bun/bin/bun" pm2 startOrReload deploy/ecosystem.config.cjs --update-env
pm2 save
# Start pm2 (and so all three processes) at boot.
sudo env PATH="$PATH" "$(command -v pm2)" startup systemd -u "$USER" --hp "$HOME" >/dev/null
pm2 save

say "Checking"
for i in $(seq 1 30); do
	curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && break
	sleep 2
done
curl -sS -w '  local  /api/status/health -> %{http_code}\n' "http://127.0.0.1:$PORT/api/status/health" || true
sleep 5
curl -sS -w "  public https://$HOSTNAME_PUBLIC/api/status/health -> %{http_code}\n" "https://$HOSTNAME_PUBLIC/api/status/health" || true
pm2 ls
echo
echo "Logs:   pm2 logs litecheats-web | pm2 logs litecheats-bridge | pm2 logs litecheats-tunnel"
