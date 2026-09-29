# Droplet deployment

The DigitalOcean droplet runs Litecheats from a git checkout of this repo with **pm2**. It runs three processes:

| pm2 process | What it runs | Job |
| --- | --- | --- |
| `litecheats-web` | `bun scripts/serve-dist.ts` | The web app, the PWA and every API (`/login`, `/downloads`, `/api/status`, Razorpay and WhatsApp webhooks, Telegram bot). Port 8080; the API is on 8787 inside it. |
| `litecheats-tunnel` | `cloudflared tunnel run` | Connects `https://pwa.litecheats.cc` to `http://localhost:8080` through Cloudflare. It needs no open ports or certificates on the droplet. |
| `litecheats-bridge` | `bun scripts/bridge.ts` | A watchdog that keeps everything connected and up to date (details below). |

The Android app (1.7+) calls `https://pwa.litecheats.cc` first and falls back to `https://litecheats.com` by itself. Both hosts reach the same server and database, so the user stays signed in whichever one answers.

## First-time setup

Run these on the droplet, as the user that should own the processes:

```bash
git clone https://github.com/DevD00T/litecheats.git && cd litecheats   # or cd into the existing checkout
cp .env.example .env   # then fill in MONGODB_URI, Razorpay, BOT_TOKEN, ANDROID_PUBLISH_TOKEN, ...
bash deploy/setup-droplet.sh
```

The script is safe to re-run. It does the following:

1. Installs Bun, Node + pm2 and cloudflared.
2. Runs `bun install` and `bun run build`.
3. Creates the tunnel `litecheats-pwa` (you log in to Cloudflare once in the browser) and writes `deploy/cloudflared.yml`.
4. Adds the DNS record `pwa.litecheats.cc` → the tunnel (`cloudflared tunnel route dns`).
5. Starts the three processes, registers pm2 with systemd so they come back after a reboot, and checks `/api/status/health` locally and through `pwa.litecheats.cc`.

**Tunnel from the dashboard instead.** You can create the tunnel in Cloudflare Zero Trust → Networks → Tunnels, with public hostname `pwa.litecheats.cc` → `http://localhost:8080`. Then put its token in `.env` as `CLOUDFLARE_TUNNEL_TOKEN=...` and re-run the script. That token takes priority over `deploy/cloudflared.yml`.

**Port 8080 already in use.** If an older server is already on port 8080 (a previous pm2 app or a systemd unit), the script stops and shows what holds the port. Remove the old process and run it again.

## The bridge

Every 30 seconds the bridge checks these endpoints:

- `GET /healthz`: the web server answers.
- `GET /api/status/health`: the API answers and MongoDB responds to a ping. This returns 503 when the database is unreachable.
- `GET /downloads/android/latest`: the Android update channel answers.
- `GET https://pwa.litecheats.cc/api/status/health`: the tunnel works end to end.

After three failures in a row it acts on what failed:

- If a local check fails, it restarts `litecheats-web`.
- If only the public check fails, it restarts `litecheats-tunnel`.

Restarts are at least two minutes apart.

**Auto-deploy (on by default).** Every two minutes the bridge also looks at `origin/main` and redeploys when there are new commits:

1. Fast-forwards the checkout.
2. Runs `bun install`.
3. Builds into `.dist-next`.
4. Swaps the new build in and reloads `litecheats-web`.

If the new version isn't healthy within a minute, the bridge puts the previous build and commit back. It never touches a checkout with local changes. Pushing to GitHub is all it takes to update the site and the API. Set `BRIDGE_AUTO_DEPLOY` to `false` in `deploy/ecosystem.config.cjs` to turn this off.

**Database watchdog.** `litecheats-web` has its own database watchdog, so a single stuck query doesn't have to wait for a restart. After an Atlas election or maintenance, a long-running MongoDB client can reject the new primary: "primary marked stale due to electionId/setVersion mismatch". Every query then fails until the client is recreated. The server pings MongoDB every 30 seconds and reconnects after two failed pings, or immediately when a request hits that error. Requests answer 503 while it reconnects, and the app retries them.

## Everyday commands

```bash
pm2 ls                          # status of the three processes
pm2 logs litecheats-web         # server logs (add --lines 200)
pm2 logs litecheats-bridge      # health checks, restarts, deploys
pm2 restart litecheats-web      # restart the server by hand
pm2 startOrReload deploy/ecosystem.config.cjs --update-env && pm2 save   # after editing the ecosystem file or .env
curl -s localhost:8080/api/status/health                                  # {"ok":true,"db":{"ok":true,...}}
```
