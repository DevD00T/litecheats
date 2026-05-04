import { Bot, bold, format, link, webhookHandler } from "gramio";
import type { Collection, Document, WithId } from "mongodb";
import { getAuthDb } from "./auth-server";

const TELEGRAM_WEBHOOK_PATH_DEFAULT = "/telegram-webhook";
const TELEGRAM_USERNAME_PATTERN = /^[a-zA-Z0-9_]{5,32}$/;
const TELEGRAM_BOT_ENABLED_FLAG = Bun.env.TELEGRAM_BOT_ENABLED?.trim().toLowerCase();
const TELEGRAM_BOT_ENABLED =
	TELEGRAM_BOT_ENABLED_FLAG === undefined ||
	TELEGRAM_BOT_ENABLED_FLAG === "" ||
	TELEGRAM_BOT_ENABLED_FLAG === "1" ||
	TELEGRAM_BOT_ENABLED_FLAG === "true" ||
	TELEGRAM_BOT_ENABLED_FLAG === "yes";
const RUNTIME_MODE = (Bun.env.NODE_ENV ?? Bun.env.node_env ?? "development").trim().toLowerCase();
const IS_PRODUCTION = RUNTIME_MODE === "production";
const TELEGRAM_WEBHOOK_BASE_URL =
	Bun.env.TELEGRAM_WEBHOOK_BASE_URL?.trim() ?? Bun.env.API_URL?.trim() ?? "";
const TELEGRAM_WEBHOOK_SECRET_TOKEN = Bun.env.TELEGRAM_WEBHOOK_SECRET_TOKEN?.trim() ?? "";
const TELEGRAM_DEV_WEBHOOK_TUNNEL =
	Bun.env.TELEGRAM_DEV_WEBHOOK_TUNNEL === "1" || Bun.env.TELEGRAM_DEV_WEBHOOK_TUNNEL === "true";
const TELEGRAM_DEV_WEBHOOK_TUNNEL_PORT = Number(Bun.env.TELEGRAM_DEV_WEBHOOK_TUNNEL_PORT ?? 8080);
const TELEGRAM_STATUS_HTTP_TIMEOUT_MS = Number(Bun.env.TELEGRAM_STATUS_HTTP_TIMEOUT_MS ?? 5000);
const TELEGRAM_ADMIN_USERNAMES = (Bun.env.TELEGRAM_ADMIN_USERNAMES ?? "")
	.split(",")
	.map((username) => normalizeTelegramUsername(username))
	.filter((username): username is string => Boolean(username));
const LITECHEATS_STATUS_BASE_URL =
	Bun.env.LITECHEATS_STATUS_BASE_URL?.trim() ??
	Bun.env.TELEGRAM_WEBHOOK_BASE_URL?.trim() ??
	Bun.env.API_URL?.trim() ??
	"https://litecheats.com";

interface TelegramBotStartOptions {
	localPort?: number;
}

type TelegramWebhookRequestHandler = (request: Request) => Promise<Response> | Response;
type TelegramRole = "admin" | "owner";

interface TelegramAdminDocument extends Document {
	_id: string;
	username: string;
	usernameLower: string;
	role: TelegramRole;
	addedByTelegramId: number | null;
	addedByUsername: string | null;
	createdAt: Date;
	updatedAt: Date;
}

interface TelegramUserLike {
	id?: number;
	firstName?: string;
	username?: string;
}

interface TelegramCommandContext {
	args: string | null;
	from?: TelegramUserLike;
	send(message: unknown): unknown;
}

interface HttpPingResult {
	ok: boolean;
	status: number | null;
	url: string;
	durationMs: number;
	error: string | null;
}

let bot: Bot | null = null;
let webhookRequestHandler: TelegramWebhookRequestHandler | null = null;
let bootPromise: Promise<void> | null = null;

function normalizeWebhookPath(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return TELEGRAM_WEBHOOK_PATH_DEFAULT;
	if (trimmed.startsWith("/")) return trimmed;
	return `/${trimmed}`;
}

const TELEGRAM_WEBHOOK_PATH = normalizeWebhookPath(
	Bun.env.TELEGRAM_WEBHOOK_PATH ?? TELEGRAM_WEBHOOK_PATH_DEFAULT,
);

function getBotToken(): string | null {
	const token = Bun.env.BOT_TOKEN?.trim();
	return token ? token : null;
}

function normalizeTelegramUsername(value: string): string | null {
	const normalized = value.trim().replace(/^@/, "");
	if (!TELEGRAM_USERNAME_PATTERN.test(normalized)) return null;
	return normalized;
}

function getTelegramUsernameLower(value: string): string {
	return value.toLowerCase();
}

function joinUrlPath(baseUrl: string, path: string): string {
	return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function normalizeUrlForCompare(value: string): string {
	return value.trim().replace(/\/+$/, "");
}

function formatStatusLine(label: string, ok: boolean, detail: string): string {
	return `${label}: ${ok ? "OK" : "FAIL"}${detail ? ` - ${detail}` : ""}`;
}

function formatUnixTimestamp(value: number | undefined): string {
	if (!value) return "none";
	return new Date(value * 1000).toISOString();
}

async function pingUrl(url: string): Promise<HttpPingResult> {
	const startedAt = performance.now();
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), TELEGRAM_STATUS_HTTP_TIMEOUT_MS);

	try {
		const response = await fetch(url, {
			method: "GET",
			signal: controller.signal,
			headers: {
				Accept: "text/plain, application/json, */*",
			},
		});

		return {
			ok: response.ok,
			status: response.status,
			url,
			durationMs: Math.round(performance.now() - startedAt),
			error: null,
		};
	} catch (error) {
		return {
			ok: false,
			status: null,
			url,
			durationMs: Math.round(performance.now() - startedAt),
			error: error instanceof Error ? error.message : "request failed",
		};
	} finally {
		clearTimeout(timeout);
	}
}

async function getTelegramAdminsCollection(): Promise<Collection<TelegramAdminDocument>> {
	const db = await getAuthDb();
	return db.collection<TelegramAdminDocument>("telegram_admins");
}

async function seedTelegramAdmins(): Promise<void> {
	if (!TELEGRAM_ADMIN_USERNAMES.length) return;

	const admins = await getTelegramAdminsCollection();
	const now = new Date();

	await Promise.all(
		TELEGRAM_ADMIN_USERNAMES.map((username) =>
			admins.updateOne(
				{ usernameLower: getTelegramUsernameLower(username) },
				{
					$setOnInsert: {
						_id: crypto.randomUUID(),
						username,
						usernameLower: getTelegramUsernameLower(username),
						role: "owner",
						addedByTelegramId: null,
						addedByUsername: "env",
						createdAt: now,
					},
					$set: {
						updatedAt: now,
					},
				},
				{ upsert: true },
			),
		),
	);
}

async function findTelegramAdminByUsername(
	username: string | undefined,
): Promise<WithId<TelegramAdminDocument> | null> {
	const normalized = username ? normalizeTelegramUsername(username) : null;
	if (!normalized) return null;

	const admins = await getTelegramAdminsCollection();
	return admins.findOne({ usernameLower: getTelegramUsernameLower(normalized) });
}

async function hasTelegramAdminAccess(from: TelegramUserLike | undefined): Promise<boolean> {
	await seedTelegramAdmins();
	return Boolean(await findTelegramAdminByUsername(from?.username));
}

async function listTelegramAdmins(): Promise<WithId<TelegramAdminDocument>[]> {
	await seedTelegramAdmins();
	const admins = await getTelegramAdminsCollection();
	return admins.find().sort({ role: -1, usernameLower: 1 }).toArray();
}

async function addTelegramAdmin(
	username: string,
	addedBy: TelegramUserLike | undefined,
): Promise<{ admin: WithId<TelegramAdminDocument>; created: boolean }> {
	const normalized = normalizeTelegramUsername(username);
	if (!normalized) {
		throw new Error("Send a valid Telegram username, for example /admins add @username.");
	}

	const admins = await getTelegramAdminsCollection();
	const now = new Date();
	const usernameLower = getTelegramUsernameLower(normalized);
	const existing = await admins.findOneAndUpdate(
		{ usernameLower },
		{
			$setOnInsert: {
				_id: crypto.randomUUID(),
				username: normalized,
				usernameLower,
				role: "admin",
				addedByTelegramId: addedBy?.id ?? null,
				addedByUsername: addedBy?.username ?? null,
				createdAt: now,
			},
			$set: {
				updatedAt: now,
			},
		},
		{ upsert: true, returnDocument: "before" },
	);

	if (existing) {
		return { admin: existing, created: false };
	}

	const admin = await admins.findOne({ usernameLower });
	if (!admin) {
		throw new Error("Telegram admin was not saved. Please try again.");
	}

	return { admin, created: true };
}

async function handleAdminsCommand(ctx: TelegramCommandContext): Promise<unknown> {
	const hasAccess = await hasTelegramAdminAccess(ctx.from);
	if (!hasAccess) {
		return ctx.send(
			"Telegram admin access required. Ask an existing Telegram admin to add your @username.",
		);
	}

	const args = (ctx.args ?? "").trim();
	const [action, username] = args.split(/\s+/);

	if (action === "add") {
		try {
			const result = await addTelegramAdmin(username ?? "", ctx.from);
			const prefix = result.created ? "Added" : "Already added";
			return ctx.send(`${prefix} @${result.admin.username} as Telegram admin.`);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unable to add Telegram admin.";
			return ctx.send(message);
		}
	}

	if (args.length > 0) {
		return ctx.send(
			["Usage:", "/admins - List Telegram admins", "/admins add @username - Add an admin"].join(
				"\n",
			),
		);
	}

	const admins = await listTelegramAdmins();
	if (!admins.length) {
		return ctx.send("No Telegram admins are configured.");
	}

	return ctx.send(
		["Telegram admins:", ...admins.map((admin) => `@${admin.username} - ${admin.role}`)].join("\n"),
	);
}

async function handleStatusCommand(ctx: TelegramCommandContext): Promise<unknown> {
	const hasAccess = await hasTelegramAdminAccess(ctx.from);
	if (!hasAccess) {
		return ctx.send("Telegram admin access required.");
	}

	const currentBot = bot ?? getOrCreateBot();
	if (!currentBot) {
		return ctx.send("Telegram bot is not initialized.");
	}

	const baseUrl = LITECHEATS_STATUS_BASE_URL;
	const websiteUrl = baseUrl.replace(/\/+$/, "");
	const healthUrl = joinUrlPath(baseUrl, "/healthz");
	const authSessionUrl = joinUrlPath(baseUrl, "/login/session");
	const expectedWebhookUrl = resolveProductionWebhookUrl();
	const statusWebhookUrl = expectedWebhookUrl ?? joinUrlPath(baseUrl, TELEGRAM_WEBHOOK_PATH);

	const [botResult, webhookResult, websitePing, healthPing, authPing, webhookPing] =
		await Promise.allSettled([
			currentBot.api.getMe(),
			currentBot.api.getWebhookInfo(),
			pingUrl(websiteUrl),
			pingUrl(healthUrl),
			pingUrl(authSessionUrl),
			pingUrl(statusWebhookUrl),
		]);

	const lines = ["Litecheats Telegram Status"];

	if (botResult.status === "fulfilled") {
		lines.push(formatStatusLine("Telegram bot", true, `@${botResult.value.username ?? "unknown"}`));
	} else {
		lines.push(
			formatStatusLine(
				"Telegram bot",
				false,
				botResult.reason instanceof Error ? botResult.reason.message : "getMe failed",
			),
		);
	}

	if (webhookResult.status === "fulfilled") {
		const webhook = webhookResult.value;
		const webhookSet = webhook.url.length > 0;
		const webhookMatchesExpected =
			Boolean(expectedWebhookUrl) &&
			normalizeUrlForCompare(webhook.url) === normalizeUrlForCompare(expectedWebhookUrl ?? "");
		lines.push(
			formatStatusLine("Telegram webhook", webhookSet, webhookSet ? webhook.url : "not set"),
		);
		lines.push(
			formatStatusLine(
				"Webhook string",
				webhookMatchesExpected,
				expectedWebhookUrl
					? `expected ${expectedWebhookUrl}`
					: "TELEGRAM_WEBHOOK_BASE_URL is not configured",
			),
		);
		lines.push(`Webhook path: ${TELEGRAM_WEBHOOK_PATH}`);
		lines.push(`Expected webhook: ${expectedWebhookUrl ?? "not configured"}`);
		lines.push(`Pending updates: ${webhook.pending_update_count}`);
		lines.push(`Last webhook error: ${webhook.last_error_message ?? "none"}`);
		lines.push(`Last webhook error at: ${formatUnixTimestamp(webhook.last_error_date)}`);
	} else {
		lines.push(
			formatStatusLine(
				"Telegram webhook",
				false,
				webhookResult.reason instanceof Error
					? webhookResult.reason.message
					: "getWebhookInfo failed",
			),
		);
	}

	for (const [label, result] of [
		["Website", websitePing],
		["API health", healthPing],
		["Auth API", authPing],
		["Webhook endpoint", webhookPing],
	] as const) {
		if (result.status === "fulfilled") {
			const ping = result.value;
			const detail = ping.status
				? `${ping.status} in ${ping.durationMs}ms (${ping.url})`
				: `${ping.error ?? "request failed"} in ${ping.durationMs}ms (${ping.url})`;
			lines.push(formatStatusLine(label, ping.ok, detail));
		} else {
			lines.push(
				formatStatusLine(
					label,
					false,
					result.reason instanceof Error ? result.reason.message : "request failed",
				),
			);
		}
	}

	lines.push(`Runtime mode: ${RUNTIME_MODE}`);
	lines.push(`Local webhook handler: ${webhookRequestHandler ? "ready" : "not ready"}`);

	return ctx.send(lines.join("\n"));
}

function toWebhookUrl(baseUrl: string, path: string): string {
	return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function resolveProductionWebhookUrl(): string | null {
	if (!TELEGRAM_WEBHOOK_BASE_URL) return null;
	return toWebhookUrl(TELEGRAM_WEBHOOK_BASE_URL, TELEGRAM_WEBHOOK_PATH);
}

function isHttpsUrl(value: string): boolean {
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return false;
	}
}

async function resolveDevelopmentWebhookUrl(localPort: number): Promise<string | null> {
	if (!TELEGRAM_DEV_WEBHOOK_TUNNEL) {
		return null;
	}

	const { startTunnel } = await import("untun");
	const tunnel = await startTunnel({
		port: Number.isFinite(localPort) ? localPort : TELEGRAM_DEV_WEBHOOK_TUNNEL_PORT,
	});
	if (!tunnel) {
		return null;
	}

	const baseUrl = await tunnel.getURL();
	return toWebhookUrl(baseUrl, TELEGRAM_WEBHOOK_PATH);
}

function getOrCreateBot(): Bot | null {
	if (bot) return bot;

	const token = getBotToken();
	if (!token) return null;

	const nextBot = new Bot(token)
		.command("start", (ctx) =>
			ctx.send(
				format`${bold`Hello, ${ctx.from?.firstName ?? "stranger"}!`}

Welcome to ${link("Litecheats Technologies", "https://litecheats.com")}.`,
			),
		)
		.command("help", (ctx) =>
			ctx.send(
				[
					"Litecheats Bot Commands:",
					"/start - Start chat and view intro message",
					"/help - Show available commands",
					"/admins - List Telegram admins",
					"/admins add @username - Add a Telegram admin",
					"/status - Show Telegram, webhook, and Litecheats API status",
				].join("\n"),
			),
		)
		.command("admins", (ctx) => handleAdminsCommand(ctx))
		.command("status", (ctx) => handleStatusCommand(ctx))
		.onError(({ kind, error }) => {
			console.error(`[telegram:${kind}]`, error);
		})
		.onStart(({ info }) => {
			console.log(`Telegram bot running as @${info.username}`);
		});

	const handlerOptions = TELEGRAM_WEBHOOK_SECRET_TOKEN
		? {
				secretToken: TELEGRAM_WEBHOOK_SECRET_TOKEN,
			}
		: undefined;

	webhookRequestHandler = webhookHandler(nextBot, "Request", handlerOptions);
	bot = nextBot;
	return bot;
}

export function getTelegramWebhookPath(): string {
	return TELEGRAM_WEBHOOK_PATH;
}

export function getTelegramWebhookRouteHandler():
	| ((context: { request: Request }) => Promise<Response> | Response)
	| null {
	const currentBot = getOrCreateBot();
	if (!currentBot || !webhookRequestHandler) return null;
	return ({ request }) => webhookRequestHandler?.(request) ?? new Response("ok!");
}

export function getTelegramWebhookHealthHandler(): (() => Response) | null {
	const currentBot = getOrCreateBot();
	if (!currentBot || !webhookRequestHandler) return null;

	return () =>
		Response.json({
			ok: true,
			status: "ready",
			path: TELEGRAM_WEBHOOK_PATH,
			methods: ["GET", "POST"],
			post: "Telegram webhook delivery endpoint",
			get: "Webhook health check endpoint",
		});
}

export async function startTelegramBot(options?: TelegramBotStartOptions): Promise<void> {
	if (bootPromise) return bootPromise;

	bootPromise = (async () => {
		if (!TELEGRAM_BOT_ENABLED) {
			console.log("Telegram bot disabled via TELEGRAM_BOT_ENABLED.");
			return;
		}

		const currentBot = getOrCreateBot();
		if (!currentBot) {
			console.warn("BOT_TOKEN is not set. Telegram bot startup skipped.");
			return;
		}

		const localPort =
			options?.localPort ??
			Number(Bun.env.PORT ?? Bun.env.HTTP_PORT ?? TELEGRAM_DEV_WEBHOOK_TUNNEL_PORT);
		const productionWebhookUrl = resolveProductionWebhookUrl();
		const developmentWebhookUrl = await resolveDevelopmentWebhookUrl(localPort);
		const webhookUrl = IS_PRODUCTION ? productionWebhookUrl : developmentWebhookUrl;

		if (IS_PRODUCTION && !webhookUrl) {
			console.warn(
				`Runtime mode is "${RUNTIME_MODE}" but webhook base URL is not set. Falling back to long polling.`,
			);
		}

		if (webhookUrl && !isHttpsUrl(webhookUrl)) {
			console.warn(
				`Webhook URL must be HTTPS for Telegram. Falling back to long polling. URL=${webhookUrl}`,
			);
			await currentBot.start();
			return;
		}

		if (webhookUrl) {
			await currentBot.start({
				webhook: {
					url: webhookUrl,
					...(TELEGRAM_WEBHOOK_SECRET_TOKEN
						? {
								secret_token: TELEGRAM_WEBHOOK_SECRET_TOKEN,
							}
						: {}),
				},
			});
			console.log(`Telegram webhook enabled at ${webhookUrl}`);
			return;
		}

		await currentBot.start();
		console.log("Telegram bot started with long polling.");
	})();

	return bootPromise;
}
