import { Bot, bold, format, link, webhookHandler } from "gramio";

const TELEGRAM_WEBHOOK_PATH_DEFAULT = "/telegram-webhook";
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

interface TelegramBotStartOptions {
	localPort?: number;
}

type TelegramWebhookRequestHandler = (request: Request) => Promise<Response> | Response;

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
				].join("\n"),
			),
		)
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
