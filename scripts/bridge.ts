#!/usr/bin/env bun

/**
 * The bridge: a small watchdog that runs next to the web server under pm2 and
 * keeps the droplet, the Cloudflare tunnel and the apps connected.
 *
 * Every BRIDGE_INTERVAL_SECONDS it checks
 *   - the web server       GET http://127.0.0.1:$PORT/healthz
 *   - the API + MongoDB     GET http://127.0.0.1:$PORT/api/status/health
 *   - the Android channel   GET http://127.0.0.1:$PORT/downloads/android/latest
 *   - the public tunnel     GET $BRIDGE_PUBLIC_URL/api/status/health
 * and restarts the pm2 process that is at fault after a few failures in a row
 * (the web server when a local check fails, the tunnel when only the public
 * check fails). Process names default to litecheats-pwa-web / -tunnel.
 *
 * With BRIDGE_AUTO_DEPLOY=true it also follows GitHub: when origin/main moves
 * it pulls, installs, builds into a fresh folder, swaps it in and reloads the
 * server. If the new version does not come up healthy it is rolled back.
 *
 * Run it with pm2 (see deploy/ecosystem.config.cjs), or `bun run bridge`.
 */

import { existsSync, renameSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoDir = fileURLToPath(new URL("..", import.meta.url));
const port = Number(Bun.env.PORT ?? Bun.env.HTTP_PORT ?? 8080);
const localBase = `http://127.0.0.1:${port}`;
const publicBase = (Bun.env.BRIDGE_PUBLIC_URL ?? "https://pwa.litecheats.cc").replace(/\/+$/, "");
const intervalMs = seconds(Bun.env.BRIDGE_INTERVAL_SECONDS, 30);
const failuresBeforeRestart = Math.max(1, Number(Bun.env.BRIDGE_FAILURES_BEFORE_RESTART ?? 3));
const restartCooldownMs = seconds(Bun.env.BRIDGE_RESTART_COOLDOWN_SECONDS, 120);
const autoDeploy = isTrue(Bun.env.BRIDGE_AUTO_DEPLOY);
const deployIntervalMs = seconds(Bun.env.BRIDGE_DEPLOY_INTERVAL_SECONDS, 120);
const deployBranch = Bun.env.BRIDGE_DEPLOY_BRANCH ?? "main";
const webProcess = Bun.env.BRIDGE_WEB_PROCESS ?? "litecheats-pwa-web";
const tunnelProcess = Bun.env.BRIDGE_TUNNEL_PROCESS ?? "litecheats-pwa-tunnel";
// cloudflared runs with --metrics on this address (deploy/ecosystem.config.cjs).
const tunnelMetricsBase = `http://${Bun.env.BRIDGE_TUNNEL_METRICS ?? "127.0.0.1:20291"}`;
let dnsWarned = false;
const pm2Bin = Bun.env.PM2_BIN ?? "pm2";

/** pm2 is a .cmd shim on Windows, which only cmd.exe can start. */
function pm2(...args: string[]): string[] {
	return process.platform === "win32" ? ["cmd.exe", "/d", "/c", pm2Bin, ...args] : [pm2Bin, ...args];
}
const bunBin = process.execPath;

const distDir = `${repoDir}dist`;
const nextDistDir = `${repoDir}.dist-next`;
const prevDistDir = `${repoDir}.dist-prev`;

function seconds(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return (Number.isFinite(parsed) && parsed > 0 ? parsed : fallback) * 1000;
}

function isTrue(value: string | undefined): boolean {
	return value === "1" || value?.toLowerCase() === "true";
}

function log(message: string, extra?: Record<string, unknown>): void {
	const line = `[bridge] ${new Date().toISOString()} ${message}`;
	console.log(extra ? `${line} ${JSON.stringify(extra)}` : line);
}

type CheckResult = { ok: boolean; status: number; ms: number; detail?: string };

async function check(url: string, acceptStatus: (status: number) => boolean): Promise<CheckResult> {
	const startedAt = performance.now();
	try {
		const response = await fetch(url, {
			signal: AbortSignal.timeout(10_000),
			headers: { "User-Agent": "litecheats-bridge", "Cache-Control": "no-cache" },
		});
		await response.arrayBuffer();
		return { ok: acceptStatus(response.status), status: response.status, ms: Math.round(performance.now() - startedAt) };
	} catch (error) {
		return {
			ok: false,
			status: 0,
			ms: Math.round(performance.now() - startedAt),
			detail: error instanceof Error ? error.message : String(error),
		};
	}
}

const is200 = (status: number) => status === 200;
// No published APK yet is a 404, which still means the channel answers.
const answered = (status: number) => status > 0 && status < 500;

async function run(cmd: string[], timeoutMs = 10 * 60_000): Promise<{ code: number; output: string }> {
	const proc = Bun.spawn(cmd, {
		cwd: repoDir,
		stdout: "pipe",
		stderr: "pipe",
		env: process.env,
		// Under pm2 on Windows every git/pm2/bun call would otherwise open a
		// console window on the desktop (every two minutes for `git fetch`).
		windowsHide: true,
	});
	const timer = setTimeout(() => proc.kill(), timeoutMs);
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	clearTimeout(timer);
	return { code, output: `${stdout}${stderr}`.trim() };
}

// ---------------------------------------------------------------------------
// Health watchdog
// ---------------------------------------------------------------------------

let localFailures = 0;
let publicFailures = 0;
const lastRestartAt: Record<string, number> = {};
let deploying = false;

async function restart(processName: string, reason: string): Promise<void> {
	const last = lastRestartAt[processName] ?? 0;
	if (Date.now() - last < restartCooldownMs) {
		log(`${processName} still unhealthy, waiting for restart cooldown`, { reason });
		return;
	}
	lastRestartAt[processName] = Date.now();
	log(`restarting ${processName}`, { reason });
	const result = await run(pm2("restart", processName, "--update-env"), 60_000);
	if (result.code !== 0) log(`pm2 restart ${processName} failed`, { output: result.output.slice(-500) });
}

async function healthTick(): Promise<void> {
	if (deploying) return;

	const [web, api, android] = await Promise.all([
		check(`${localBase}/healthz`, is200),
		check(`${localBase}/api/status/health`, is200),
		check(`${localBase}/downloads/android/latest`, answered),
	]);
	const localOk = web.ok && api.ok && android.ok;

	if (localOk) {
		if (localFailures > 0) log("local server healthy again");
		localFailures = 0;
	} else {
		localFailures += 1;
		log(`local check failed (${localFailures}/${failuresBeforeRestart})`, { web, api, android });
		if (localFailures >= failuresBeforeRestart) {
			await restart(webProcess, api.status === 503 ? "database unreachable" : "local checks failing");
		}
		// The tunnel cannot be judged while the server behind it is down.
		return;
	}

	// cloudflared's own readiness (200 once it holds a connection to Cloudflare's
	// edge) is the direct signal; the public round trip confirms the whole path.
	const [ready, tunnel] = await Promise.all([
		check(`${tunnelMetricsBase}/ready`, is200),
		check(`${publicBase}/api/status/health`, is200),
	]);
	// This machine not resolving the hostname (e.g. its router still caching
	// "no such domain" after the record was created) says nothing about the
	// tunnel, and restarting cloudflared would not fix it.
	const dnsOnly = !tunnel.ok && /ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(tunnel.detail ?? "");
	if (ready.ok && (tunnel.ok || dnsOnly)) {
		if (publicFailures > 0) log(`${publicBase} reachable again`);
		if (dnsOnly && !dnsWarned) {
			log(`tunnel connected; ${publicBase} does not resolve from this machine yet (local DNS cache)`);
			dnsWarned = true;
		}
		if (tunnel.ok) dnsWarned = false;
		publicFailures = 0;
		return;
	}
	publicFailures += 1;
	log(`tunnel check failed (${publicFailures}/${failuresBeforeRestart})`, { url: publicBase, ready, tunnel });
	if (publicFailures >= failuresBeforeRestart) {
		await restart(tunnelProcess, ready.ok ? "public URL unreachable" : "cloudflared not connected to Cloudflare");
	}
}

// ---------------------------------------------------------------------------
// Auto-deploy from GitHub
// ---------------------------------------------------------------------------

async function waitForHealthy(timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		await Bun.sleep(3000);
		const [web, api] = await Promise.all([
			check(`${localBase}/healthz`, is200),
			check(`${localBase}/api/status/health`, is200),
		]);
		if (web.ok && api.ok) return true;
	}
	return false;
}

function swapDist(from: string, keepAs: string): void {
	rmSync(keepAs, { recursive: true, force: true });
	if (existsSync(distDir)) renameSync(distDir, keepAs);
	renameSync(from, distDir);
}

async function deployTick(): Promise<void> {
	if (deploying) return;

	const fetched = await run(["git", "fetch", "--quiet", "origin", deployBranch], 120_000);
	if (fetched.code !== 0) {
		log("git fetch failed", { output: fetched.output.slice(-300) });
		return;
	}
	const head = (await run(["git", "rev-parse", "HEAD"])).output;
	const remote = (await run(["git", "rev-parse", `origin/${deployBranch}`])).output;
	if (!head || !remote || head === remote) return;

	// Only fast-forwards, and only on a clean checkout: the bridge never
	// overwrites work someone did by hand on the droplet.
	const ahead = await run(["git", "merge-base", "--is-ancestor", "HEAD", `origin/${deployBranch}`]);
	if (ahead.code !== 0) {
		log(`origin/${deployBranch} is not a fast-forward of HEAD; skipping auto-deploy`);
		return;
	}
	const dirty = (await run(["git", "status", "--porcelain", "--untracked-files=no"])).output;
	if (dirty) {
		log("working tree has local changes; skipping auto-deploy", { changes: dirty.slice(0, 300) });
		return;
	}

	deploying = true;
	log(`deploying ${remote.slice(0, 7)} (was ${head.slice(0, 7)})`);
	try {
		const steps: string[][] = [
			["git", "merge", "--ff-only", "--quiet", `origin/${deployBranch}`],
			[bunBin, "install", "--frozen-lockfile"],
			[bunBin, "x", "vite", "build", "--outDir", nextDistDir, "--emptyOutDir"],
		];
		for (const step of steps) {
			const result = await run(step);
			if (result.code !== 0) {
				log(`deploy step failed: ${step.slice(0, 3).join(" ")}`, { output: result.output.slice(-800) });
				await rollbackCode(head);
				return;
			}
		}

		swapDist(nextDistDir, prevDistDir);
		await run(pm2("reload", webProcess, "--update-env"), 120_000);

		if (await waitForHealthy(60_000)) {
			log(`deployed ${remote.slice(0, 7)}`);
			return;
		}

		log("new version did not become healthy; rolling back");
		if (existsSync(prevDistDir)) {
			rmSync(distDir, { recursive: true, force: true });
			renameSync(prevDistDir, distDir);
		}
		await rollbackCode(head);
		await run(pm2("reload", webProcess, "--update-env"), 120_000);
	} finally {
		rmSync(nextDistDir, { recursive: true, force: true });
		deploying = false;
	}
}

async function rollbackCode(sha: string): Promise<void> {
	await run(["git", "reset", "--quiet", "--hard", sha]);
	await run([bunBin, "install", "--frozen-lockfile"]);
	log(`code rolled back to ${sha.slice(0, 7)}`);
}

// ---------------------------------------------------------------------------

function loop(task: () => Promise<void>, everyMs: number): void {
	const tick = () => {
		task()
			.catch((error) => log("tick failed", { error: error instanceof Error ? error.message : String(error) }))
			.finally(() => setTimeout(tick, everyMs));
	};
	setTimeout(tick, Math.min(everyMs, 15_000));
}

log("started", {
	local: localBase,
	public: publicBase,
	intervalSeconds: intervalMs / 1000,
	autoDeploy,
	branch: autoDeploy ? deployBranch : undefined,
});
loop(healthTick, intervalMs);
if (autoDeploy) loop(deployTick, deployIntervalMs);
