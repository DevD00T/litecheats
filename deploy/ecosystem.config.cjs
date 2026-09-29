/**
 * pm2 processes for the Litecheats droplet.
 *
 *   litecheats-web     the Bun server (scripts/serve-dist.ts): web app, PWA, every API,
 *                      the Telegram bot. Listens on PORT (8080) and the API on 8787.
 *   litecheats-tunnel  Cloudflare Tunnel: pwa.litecheats.cc -> http://localhost:8080.
 *   litecheats-bridge  Watchdog: health-checks the server, database and tunnel, restarts
 *                      what is broken, and deploys new commits from GitHub.
 *
 *   pm2 start deploy/ecosystem.config.cjs && pm2 save
 *
 * The server reads its settings from .env in the repository root (Bun loads it).
 * deploy/setup-droplet.sh installs everything and registers pm2 to start on boot.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const root = path.resolve(__dirname, "..");
const bun = process.env.BUN_BIN || path.join(os.homedir(), ".bun", "bin", "bun");
const cloudflared = process.env.CLOUDFLARED_BIN || "cloudflared";
const tunnelConfig = process.env.CLOUDFLARED_CONFIG || path.join(root, "deploy", "cloudflared.yml");

/** Reads one KEY=value from the repository's .env (pm2 does not load it for us). */
function fromDotEnv(key) {
	try {
		const text = fs.readFileSync(path.join(root, ".env"), "utf8");
		const line = text.split("\n").find((l) => l.trim().startsWith(`${key}=`));
		return line ? line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") : "";
	} catch {
		return "";
	}
}

// Two ways to run the tunnel: a token from the Cloudflare dashboard
// (CLOUDFLARE_TUNNEL_TOKEN in .env), or a locally created tunnel described by
// deploy/cloudflared.yml. The token is passed as TUNNEL_TOKEN, never on the
// command line, so it does not show up in `ps`.
const tunnelToken = process.env.CLOUDFLARE_TUNNEL_TOKEN || fromDotEnv("CLOUDFLARE_TUNNEL_TOKEN");
const tunnelArgs = tunnelToken
	? "tunnel --no-autoupdate run"
	: `tunnel --no-autoupdate --config ${tunnelConfig} run`;
const publicUrl =
	process.env.BRIDGE_PUBLIC_URL || fromDotEnv("BRIDGE_PUBLIC_URL") || "https://pwa.litecheats.cc";

module.exports = {
	apps: [
		{
			name: "litecheats-web",
			cwd: root,
			script: bun,
			args: "scripts/serve-dist.ts",
			interpreter: "none",
			env: { NODE_ENV: "production", PORT: "8080" },
			autorestart: true,
			// Back off when it keeps crashing (e.g. MongoDB down) instead of spinning.
			exp_backoff_restart_delay: 200,
			max_restarts: 1000,
			min_uptime: "20s",
			max_memory_restart: "900M",
			kill_timeout: 8000,
			time: true,
			merge_logs: true,
		},
		{
			name: "litecheats-tunnel",
			cwd: root,
			script: cloudflared,
			args: tunnelArgs,
			interpreter: "none",
			env: tunnelToken ? { TUNNEL_TOKEN: tunnelToken } : {},
			autorestart: true,
			exp_backoff_restart_delay: 500,
			max_restarts: 1000,
			min_uptime: "20s",
			time: true,
		},
		{
			name: "litecheats-bridge",
			cwd: root,
			script: bun,
			args: "scripts/bridge.ts",
			interpreter: "none",
			env: {
				PORT: "8080",
				BRIDGE_PUBLIC_URL: publicUrl,
				BRIDGE_INTERVAL_SECONDS: "30",
				// Pull, build and reload when origin/main gets new commits.
				BRIDGE_AUTO_DEPLOY: "true",
				BRIDGE_DEPLOY_BRANCH: "main",
				BRIDGE_DEPLOY_INTERVAL_SECONDS: "120",
			},
			autorestart: true,
			restart_delay: 5000,
			time: true,
		},
	],
};
