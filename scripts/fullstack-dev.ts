#!/usr/bin/env bun

import { createConnection } from "node:net";
import { Elysia } from "elysia";
import { AUTH_API_PORT, AUTH_BASE_PATH } from "../shared/auth";
import { DOWNLOADS_BASE_PATH } from "../shared/releases";
import { startAuthServer } from "../src/bun/auth-server";
import {
	getTelegramWebhookPath,
	getTelegramWebhookRouteHandler,
	startTelegramBot,
} from "../src/bun/telegram-bot";
import { handleContactInquiry } from "./lib/contact-inquiry";

const FULLSTACK_HOST = "0.0.0.0";
const FULLSTACK_PORT = Number(Bun.env.PORT ?? Bun.env.HTTP_PORT ?? 8080);
const VITE_SERVER_ORIGIN = Bun.env.WEBVIEW_DEV_SERVER_URL ?? "http://localhost:5173";
const VITE_SERVER_PORT = Number(new URL(VITE_SERVER_ORIGIN).port || 5173);
const AUTH_SERVER_ORIGIN = `http://127.0.0.1:${AUTH_API_PORT}`;
const CONTACT_API_PATH = "/contact/inquiry";
const VITE_WAIT_TIMEOUT_MS = 20000;
const VITE_WAIT_INTERVAL_MS = 250;

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

function stopProcess(handle: ProcessHandle | null): void {
	if (!handle) return;
	try {
		handle.proc.kill("SIGTERM");
	} catch {
		// Ignore shutdown race conditions.
	}
}

async function isPortInUse(port: number, host = "127.0.0.1"): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection({ port, host });
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
	const response = await fetchWithTimeout(VITE_SERVER_ORIGIN, 1200);
	if (!response?.ok) {
		return false;
	}

	const html = await response.text();
	return html.includes("/@vite/client");
}

async function waitForViteServer(timeoutMs: number): Promise<boolean> {
	const startedAt = Date.now();

	while (Date.now() - startedAt < timeoutMs) {
		if (await isViteServerRunning()) {
			return true;
		}
		await Bun.sleep(VITE_WAIT_INTERVAL_MS);
	}

	return false;
}

async function ensureAuthServerRunning(): Promise<void> {
	if (await isPortInUse(AUTH_API_PORT)) {
		console.log(`Auth API is already running on :${AUTH_API_PORT}`);
		return;
	}

	await startAuthServer();
}

async function proxyAuthApi(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const proxyUrl = new URL(url.pathname + url.search, AUTH_SERVER_ORIGIN);
	return fetch(new Request(proxyUrl, request));
}

async function proxyVite(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const proxyUrl = new URL(url.pathname + url.search, VITE_SERVER_ORIGIN);
	return fetch(new Request(proxyUrl, request));
}

let viteProcess: ProcessHandle | null = null;
if (await isPortInUse(VITE_SERVER_PORT, "localhost")) {
	if (!(await isViteServerRunning())) {
		console.error(
			`Port ${VITE_SERVER_PORT} is occupied by a non-Vite process. Stop it or change WEBVIEW_DEV_SERVER_URL.`,
		);
		process.exit(1);
	}
	console.log(`Reusing existing Vite server at ${VITE_SERVER_ORIGIN}`);
} else {
	viteProcess = { name: "web", proc: spawnScript("web") };
	const ready = await waitForViteServer(VITE_WAIT_TIMEOUT_MS);
	if (!ready) {
		stopProcess(viteProcess);
		console.error(`Vite server was not reachable at ${VITE_SERVER_ORIGIN} within ${VITE_WAIT_TIMEOUT_MS}ms.`);
		process.exit(1);
	}
}

await ensureAuthServerRunning();
await startTelegramBot({ localPort: FULLSTACK_PORT });
const telegramWebhookPath = getTelegramWebhookPath();
const telegramWebhookHandler = getTelegramWebhookRouteHandler();

const app = new Elysia({ name: "litecheats-fullstack-dev" });

if (telegramWebhookHandler) {
	app.post(telegramWebhookPath, telegramWebhookHandler);
}

app.onRequest(({ request }) => {
	const pathname = new URL(request.url).pathname;

	if (pathname === CONTACT_API_PATH && request.method === "POST") {
		return handleContactInquiry(request);
	}

	if (pathname === AUTH_BASE_PATH || pathname.startsWith(`${AUTH_BASE_PATH}/`)) {
		return proxyAuthApi(request);
	}

	if (pathname === DOWNLOADS_BASE_PATH || pathname.startsWith(`${DOWNLOADS_BASE_PATH}/`)) {
		return proxyAuthApi(request);
	}

	return undefined;
})
	.get("/healthz", "ok")
	.all("/*", ({ request }) => proxyVite(request))
	.listen({ hostname: FULLSTACK_HOST, port: FULLSTACK_PORT, idleTimeout: 30 });

const shutdown = () => {
	app.server?.stop(true);
	stopProcess(viteProcess);
	process.exit(0);
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

console.log(`Elysia fullstack dev gateway: http://localhost:${app.server?.port}`);
console.log(`Frontend proxied to ${VITE_SERVER_ORIGIN} (Vite HMR remains active).`);
