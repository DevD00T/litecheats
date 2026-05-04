#!/usr/bin/env bun

import { createConnection } from "node:net";

const DEV_SERVER_URL = Bun.env.APPBUN_URL ?? "http://localhost:5173";
const DEV_SERVER_PORT = resolvePort(DEV_SERVER_URL);
const WRAPPER_DIR = Bun.env.APPBUN_OUT_DIR ?? "./litecheats";
const WEB_SCRIPT = "web";

interface ProcessHandle {
	name: string;
	proc: Bun.Subprocess;
}

function resolvePort(url: string): number {
	try {
		const parsed = new URL(url);
		if (parsed.port) return Number(parsed.port);
		return parsed.protocol === "https:" ? 443 : 80;
	} catch {
		return 5173;
	}
}

function spawnRootScript(script: string): Bun.Subprocess {
	return Bun.spawn({
		cmd: ["bun", "run", script],
		stdio: ["inherit", "inherit", "inherit"],
	});
}

function spawnWrapperDev(cwd: string): Bun.Subprocess {
	return Bun.spawn({
		cmd: ["bun", "run", "dev"],
		cwd,
		stdio: ["inherit", "inherit", "inherit"],
	});
}

function stopProcess(handle: ProcessHandle | null): void {
	if (!handle) return;
	try {
		handle.proc.kill("SIGTERM");
	} catch {
		// Ignore shutdown race.
	}
}

function isPortInUse(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection({ port, host: "localhost" });
		socket.once("connect", () => {
			socket.destroy();
			resolve(true);
		});
		socket.once("error", () => resolve(false));
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

async function isViteServerRunning(url: string): Promise<boolean> {
	const response = await fetchWithTimeout(url, 1500);
	if (!response?.ok) return false;

	const html = await response.text();
	return html.includes("/@vite/client");
}

async function runWrapperOnly(): Promise<number> {
	const wrapper = spawnWrapperDev(WRAPPER_DIR);
	return wrapper.exited;
}

async function runWebAndWrapper(): Promise<number> {
	const web: ProcessHandle = { name: WEB_SCRIPT, proc: spawnRootScript(WEB_SCRIPT) };
	const wrapper: ProcessHandle = { name: "wrapper-dev", proc: spawnWrapperDev(WRAPPER_DIR) };

	let finalized = false;
	const finalize = (exitCode: number) => {
		if (finalized) return;
		finalized = true;
		stopProcess(web);
		stopProcess(wrapper);
		process.exit(exitCode);
	};

	process.once("SIGINT", () => finalize(0));
	process.once("SIGTERM", () => finalize(0));

	const webExit = web.proc.exited.then((code) => ({ name: web.name, code }));
	const wrapperExit = wrapper.proc.exited.then((code) => ({ name: wrapper.name, code }));
	const firstExit = await Promise.race([webExit, wrapperExit]);

	if (firstExit.code === 0 && firstExit.name === wrapper.name) {
		stopProcess(web);
		return 0;
	}

	stopProcess(web);
	stopProcess(wrapper);
	return firstExit.code === 0 ? 1 : firstExit.code;
}

const portUsed = await isPortInUse(DEV_SERVER_PORT);
if (portUsed) {
	const viteServerRunning = await isViteServerRunning(DEV_SERVER_URL);
	if (!viteServerRunning) {
		console.error(
			`Port ${DEV_SERVER_PORT} is in use by a non-Vite process. Stop it or set APPBUN_URL to a different dev URL.`,
		);
		process.exit(1);
	}

	console.log(`Reusing existing Vite server at ${DEV_SERVER_URL}. Starting wrapper only.`);
	process.exit(await runWrapperOnly());
}

process.exit(await runWebAndWrapper());
