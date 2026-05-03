#!/usr/bin/env bun

import { createConnection } from "node:net";

const DEV_SERVER_URL = "http://localhost:5173";
const DEV_SERVER_PORT = 5173;
const DEV_SERVER_PROBE_TIMEOUT_MS = 1200;
const WEB_SCRIPT = "web";

const watchMode = process.argv.includes("--watch");
const appScript = watchMode ? "app:watch" : "app";

interface ProcessHandle {
	name: string;
	proc: Bun.Subprocess;
}

function spawnScript(script: string): Bun.Subprocess {
	return Bun.spawn({
		cmd: ["bun", "run", script],
		stdio: ["inherit", "inherit", "inherit"],
	});
}

function isPortInUse(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection({ port, host: "localhost" });
		socket.once("connect", () => {
			socket.destroy();
			resolve(true);
		});
		socket.once("error", () => {
			resolve(false);
		});
	});
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response | null> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, { signal: controller.signal });
	} catch {
		return null;
	} finally {
		clearTimeout(timeout);
	}
}

async function isViteServerRunning(): Promise<boolean> {
	const response = await fetchWithTimeout(DEV_SERVER_URL, DEV_SERVER_PROBE_TIMEOUT_MS);
	if (!response?.ok) {
		return false;
	}

	const text = await response.text();
	return text.includes("/@vite/client");
}

function stopProcess(handle: ProcessHandle | null): void {
	if (!handle) return;
	try {
		handle.proc.kill("SIGTERM");
	} catch {
		// ignore shutdown race
	}
}

async function runAppOnly(): Promise<number> {
	const app = spawnScript(appScript);
	return app.exited;
}

async function runWebAndApp(): Promise<number> {
	const web: ProcessHandle = { name: WEB_SCRIPT, proc: spawnScript(WEB_SCRIPT) };
	const app: ProcessHandle = { name: appScript, proc: spawnScript(appScript) };

	let finalized = false;

	const finalize = (exitCode: number) => {
		if (finalized) return;
		finalized = true;
		stopProcess(web);
		stopProcess(app);
		process.exit(exitCode);
	};

	process.once("SIGINT", () => finalize(0));
	process.once("SIGTERM", () => finalize(0));

	const webExit = web.proc.exited.then((code) => ({ name: web.name, code }));
	const appExit = app.proc.exited.then((code) => ({ name: app.name, code }));

	const firstExit = await Promise.race([webExit, appExit]);

	if (firstExit.code === 0 && firstExit.name === app.name) {
		stopProcess(web);
		return 0;
	}

	stopProcess(web);
	stopProcess(app);
	return firstExit.code === 0 ? 1 : firstExit.code;
}

const portUsed = await isPortInUse(DEV_SERVER_PORT);
if (portUsed) {
	const viteServerRunning = await isViteServerRunning();
	if (viteServerRunning) {
		console.log(`Reusing existing Vite server at ${DEV_SERVER_URL}. Starting desktop app only.`);
		process.exit(await runAppOnly());
	}

	console.error(
		`Port ${DEV_SERVER_PORT} is in use by a non-Vite process. Stop that process and retry.`,
	);
	process.exit(1);
}

process.exit(await runWebAndApp());
