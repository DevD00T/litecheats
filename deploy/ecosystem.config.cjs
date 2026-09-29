/**
 * pm2 processes for the Litecheats PWA server (a Linux droplet or a Windows PC).
 *
 *   litecheats-pwa-web     the Bun server (scripts/serve-dist.ts): web app, PWA and every API.
 *                          Port 8080. Without MONGODB_URI in .env it runs in upstream mode:
 *                          it serves the PWA and relays API calls to API_UPSTREAM_URL
 *                          (default https://litecheats.com, the App Platform server).
 *   litecheats-pwa-tunnel  Cloudflare Tunnel: pwa.litecheats.cc -> http://localhost:8080.
 *   litecheats-pwa-bridge  Watchdog: health-checks the server, API and tunnel, restarts what is
 *                          broken, and deploys new commits from GitHub.
 *
 *   pm2 start deploy/ecosystem.config.cjs && pm2 save
 *
 * The names are prefixed so they never collide with other pm2 apps on the same machine.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const isWindows = process.platform === "win32";

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

/** First existing path among the candidates, else the first one found on PATH. */
function findBinary(name, candidates) {
	for (const candidate of candidates) {
		if (candidate && fs.existsSync(candidate)) return candidate;
	}
	try {
		const found = execSync(isWindows ? `where ${name}` : `command -v ${name}`, {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		const first = found.split("\n").map((line) => line.trim()).find(Boolean);
		if (first) return first;
	} catch {
		// Not on PATH; fall through to the bare name.
	}
	return name;
}

const exe = isWindows ? ".exe" : "";
const bun = findBinary("bun", [
	process.env.BUN_BIN,
	fromDotEnv("BUN_BIN"),
	path.join(os.homedir(), ".bun", "bin", `bun${exe}`),
]);
const cloudflared = findBinary("cloudflared", [
	process.env.CLOUDFLARED_BIN,
	fromDotEnv("CLOUDFLARED_BIN"),
	isWindows ? "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe" : "",
	isWindows ? "C:\\Program Files\\cloudflared\\cloudflared.exe" : "",
]);
const tunnelConfig = process.env.CLOUDFLARED_CONFIG || path.join(root, "deploy", "cloudflared.yml");

// Two ways to run the tunnel: a token from the Cloudflare dashboard
// (CLOUDFLARE_TUNNEL_TOKEN in .env), or a locally created tunnel described by
// deploy/cloudflared.yml. The token is passed as TUNNEL_TOKEN, never on the
// command line, so it does not show up in the process list.
const tunnelToken = process.env.CLOUDFLARE_TUNNEL_TOKEN || fromDotEnv("CLOUDFLARE_TUNNEL_TOKEN");
// --metrics exposes /ready locally, which the bridge uses to tell whether the
// tunnel is connected to Cloudflare.
// A fixed port away from cloudflared's defaults (20241+), which other tunnels
// on the same machine may already hold.
const tunnelMetrics = "127.0.0.1:20291";
const tunnelArgs = tunnelToken
	? `tunnel --no-autoupdate --metrics ${tunnelMetrics} run`
	: `tunnel --no-autoupdate --metrics ${tunnelMetrics} --config "${tunnelConfig}" run`;
const publicUrl =
	process.env.BRIDGE_PUBLIC_URL || fromDotEnv("BRIDGE_PUBLIC_URL") || "https://pwa.litecheats.cc";

// Without database credentials this machine can't run the API itself, so it
// relays API calls to the main server instead (see scripts/serve-dist.ts).
const apiUpstream = fromDotEnv("MONGODB_URI")
	? ""
	: process.env.API_UPSTREAM_URL || fromDotEnv("API_UPSTREAM_URL") || "https://litecheats.com";
const autoDeploy = process.env.BRIDGE_AUTO_DEPLOY || fromDotEnv("BRIDGE_AUTO_DEPLOY") || "true";

module.exports = {
	apps: [
		{
			name: "litecheats-pwa-web",
			cwd: root,
			script: bun,
			args: "scripts/serve-dist.ts",
			interpreter: "none",
			env: { NODE_ENV: "production", PORT: "8080", API_UPSTREAM_URL: apiUpstream },
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
			name: "litecheats-pwa-tunnel",
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
			name: "litecheats-pwa-bridge",
			cwd: root,
			script: bun,
			args: "scripts/bridge.ts",
			interpreter: "none",
			env: {
				PORT: "8080",
				BRIDGE_PUBLIC_URL: publicUrl,
				BRIDGE_INTERVAL_SECONDS: "30",
				BRIDGE_WEB_PROCESS: "litecheats-pwa-web",
				BRIDGE_TUNNEL_PROCESS: "litecheats-pwa-tunnel",
				BRIDGE_TUNNEL_METRICS: tunnelMetrics,
				// Pull, build and reload when origin/main gets new commits.
				BRIDGE_AUTO_DEPLOY: autoDeploy,
				BRIDGE_DEPLOY_BRANCH: "main",
				BRIDGE_DEPLOY_INTERVAL_SECONDS: "120",
			},
			autorestart: true,
			restart_delay: 5000,
			time: true,
		},
	],
};
