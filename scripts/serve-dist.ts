#!/usr/bin/env bun

import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import { Elysia } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import { AUTH_API_PORT, AUTH_BASE_PATH } from "../shared/auth";
import { DOWNLOADS_BASE_PATH } from "../shared/releases";
import { startAuthServer } from "../src/bun/auth-server";
import {
	getTelegramWebhookHealthHandler,
	getTelegramWebhookPath,
	getTelegramWebhookRouteHandler,
	startTelegramBot,
} from "../src/bun/telegram-bot";
import { handleContactInquiry } from "./lib/contact-inquiry";

const distDir = fileURLToPath(new URL("../dist", import.meta.url));
const port = Number(Bun.env.PORT ?? Bun.env.HTTP_PORT ?? 8080);
const host = "0.0.0.0";
const AUTH_SERVER_ORIGIN = `http://127.0.0.1:${AUTH_API_PORT}`;
const CONTACT_API_PATH = "/contact/inquiry";

async function isPortInUse(checkPort: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection({ port: checkPort, host: "127.0.0.1" });
		socket.once("connect", () => {
			socket.destroy();
			resolve(true);
		});
		socket.once("error", () => {
			resolve(false);
		});
	});
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
	const proxiedRequest = new Request(proxyUrl, request);
	return fetch(proxiedRequest);
}

await ensureAuthServerRunning();
await startTelegramBot({ localPort: port });
const telegramWebhookPath = getTelegramWebhookPath();
const telegramWebhookHealthHandler = getTelegramWebhookHealthHandler();
const telegramWebhookHandler = getTelegramWebhookRouteHandler();

const app = new Elysia({ name: "litecheats-web-server" });

if (telegramWebhookHandler) {
	app.post(telegramWebhookPath, telegramWebhookHandler);
}

if (telegramWebhookHealthHandler) {
	app.get(telegramWebhookPath, telegramWebhookHealthHandler);
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
	.use(
		await staticPlugin({
			assets: distDir,
			prefix: "/",
			indexHTML: true,
		}),
	)
	.listen({ hostname: host, port, idleTimeout: 30 });

console.log(`Elysia web server listening on http://${host}:${app.server?.port}`);
