/**
 * Receiver for the WhatsApp gateway's webhook (POST /whatsapp/webhook).
 *
 * Every delivery looks like
 *   { "event": "message.received", "sessionId": "...", "timestamp": "ISO", "data": { ... } }
 * and, when a secret is set on the webhook, carries
 *   X-Webhook-Signature: sha256=<hex HMAC-SHA256(secret, raw body)>
 *
 * Deliveries are refused unless that signature matches one of our secrets, so
 * nobody else can write events into the database. A verified delivery is stored
 * as sent (minus any login QR code) and a session drop is announced to admins,
 * because WhatsApp sign-in stops working until the session reconnects.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
	WHATSAPP_WEBHOOK_PATH,
	type WhatsAppConnectionState,
	type WhatsAppWebhookEventSummary,
} from "../../shared/whatsapp";
import {
	type WhatsAppWebhookEventDocument,
	findLatestWhatsAppWebhookEvent,
	getDb,
	insertWhatsAppWebhookEvent,
} from "./db";

export const WHATSAPP_WEBHOOK_MAX_BYTES = 256 * 1024;
const SUMMARY_MAX_LENGTH = 200;
/** Session states in which the gateway cannot send sign-in codes. */
const UNHEALTHY_CONNECTION_STATES = new Set(["DISCONNECTED", "LOGGED_OUT", "STOPPED", "SCAN_QR"]);

export class WhatsAppWebhookError extends Error {
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

function readWebhookSecrets(): string[] {
	const secrets = [
		Bun.env.WHATSAPP_WEBHOOK_SECRET ?? "",
		...(Bun.env.WHATSAPP_WEBHOOK_SECRETS ?? "").split(","),
	]
		.map((secret) => secret.trim())
		.filter(Boolean);
	return [...new Set(secrets)];
}

export function isWhatsAppWebhookConfigured(): boolean {
	return readWebhookSecrets().length > 0;
}

function safeEquals(expected: string, received: string): boolean {
	const expectedBuffer = Buffer.from(expected, "utf8");
	const receivedBuffer = Buffer.from(received, "utf8");
	// A hex digest's length is not secret; timingSafeEqual throws on a mismatch.
	if (expectedBuffer.length !== receivedBuffer.length) return false;
	return timingSafeEqual(expectedBuffer, receivedBuffer);
}

/**
 * Checks `X-Webhook-Signature` against the exact raw body. Every secret is
 * tried even after a match, so timing does not reveal which one matched.
 */
export function verifyWhatsAppWebhookSignature(
	rawBody: string,
	header: string | null,
	secrets: string[] = readWebhookSecrets(),
): boolean {
	if (!header || !secrets.length) return false;
	const received = header
		.trim()
		.replace(/^sha256=/i, "")
		.toLowerCase();
	if (!/^[0-9a-f]{64}$/.test(received)) return false;

	let matched = false;
	for (const secret of secrets) {
		const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
		if (safeEquals(expected, received)) matched = true;
	}
	return matched;
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function text(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** "919876543210@s.whatsapp.net" -> "919876543210"; groups keep their id, marked as such. */
function describeJid(value: unknown): string | null {
	const jid = text(value);
	if (!jid) return null;
	if (jid.endsWith("@g.us")) return `group ${jid.slice(0, -"@g.us".length)}`;
	if (jid === "status@broadcast") return "status";
	return jid.replace(/@s\.whatsapp\.net$|@c\.us$|@lid$/, "");
}

function clip(value: string): string {
	const oneLine = value.replace(/\s+/g, " ").trim();
	return oneLine.length > SUMMARY_MAX_LENGTH
		? `${oneLine.slice(0, SUMMARY_MAX_LENGTH - 1)}…`
		: oneLine;
}

/** One readable line per event, for the admin list. Falls back to the event name. */
export function summarizeWhatsAppEvent(event: string, rawData: unknown): string {
	const data = asRecord(rawData);
	const key = asRecord(data.key);

	switch (event) {
		case "message.received":
		case "message.sent": {
			const party =
				event === "message.sent"
					? describeJid(data.receiver ?? data.from ?? key.remoteJid)
					: describeJid(data.sender ?? data.from ?? key.remoteJid);
			const name = event === "message.received" ? text(data.pushName) : null;
			const who = [name, party ? `(${party})` : null].filter(Boolean).join(" ") || "unknown";
			const where = data.isGroup === true && data.from ? ` in ${describeJid(data.from)}` : "";
			const type = text(data.type);
			const body = text(data.content) ?? text(data.caption) ?? (type ? `[${type}]` : "");
			return clip(`${event === "message.sent" ? "To" : "From"} ${who}${where}: ${body}`);
		}
		case "message.status":
			return clip(
				`${text(data.keyId) ?? "message"} to ${describeJid(data.remoteJid) ?? "unknown"}: ${text(data.status) ?? "?"}`,
			);
		case "message.edited":
			return clip(
				`${text(data.keyId) ?? "message"} in ${describeJid(data.remoteJid) ?? "unknown"} now reads: ${text(data.newContent) ?? ""}`,
			);
		case "message.deleted":
			return clip(
				`${text(data.keyId) ?? "message"} in ${describeJid(data.remoteJid) ?? "unknown"} was deleted`,
			);
		case "connection.update":
			return `Session is ${text(data.status) ?? "unknown"}`;
		case "group.update":
			return clip(
				`${text(data.subject) ?? describeJid(data.jid) ?? "A group"} was updated${text(data.desc) ? `: ${text(data.desc)}` : ""}`,
			);
		case "group.participant": {
			const participants = Array.isArray(data.participants)
				? data.participants.map((jid) => describeJid(jid) ?? "?").join(", ")
				: "someone";
			return clip(
				`${text(data.action) ?? "change"}: ${participants} in ${describeJid(data.jid) ?? "a group"}`,
			);
		}
		case "contact.update":
			return clip(
				`${text(data.name) ?? text(data.notify) ?? "Contact"} (${describeJid(data.jid) ?? "unknown"})`,
			);
		case "status.update":
			return clip(
				`${describeJid(data.from) ?? "status"}: ${text(data.content) ?? `[${text(data.type) ?? "update"}]`}`,
			);
		default:
			return event;
	}
}

/**
 * A `connection.update` in the SCAN_QR state carries the pairing QR. Anyone who
 * scans it within its lifetime links a device to the business number, so it is
 * never written to the database or shown in the admin page.
 */
function redact(event: string, data: unknown): unknown {
	if (event !== "connection.update") return data;
	const record = asRecord(data);
	if (record.qr === undefined || record.qr === null) return data;
	return { ...record, qr: "[redacted]" };
}

export function toWhatsAppEventSummary(
	doc: WhatsAppWebhookEventDocument,
): WhatsAppWebhookEventSummary {
	return {
		id: doc._id,
		event: doc.event,
		sessionId: doc.sessionId,
		occurredAt: doc.occurredAt?.toISOString() ?? null,
		receivedAt: doc.receivedAt.toISOString(),
		summary: summarizeWhatsAppEvent(doc.event, doc.data),
		data: doc.data,
	};
}

export function toWhatsAppConnectionState(
	doc: WhatsAppWebhookEventDocument | null,
): WhatsAppConnectionState | null {
	if (!doc) return null;
	return {
		status: text(asRecord(doc.data).status) ?? "UNKNOWN",
		at: (doc.occurredAt ?? doc.receivedAt).toISOString(),
	};
}

function parseTimestamp(value: unknown): Date | null {
	if (typeof value !== "string" && typeof value !== "number") return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

export interface WhatsAppWebhookResult {
	event: string;
	stored: boolean;
}

/** Alerts admins when the session's health changes. Never throws. */
async function announceConnectionChange(
	previous: WhatsAppConnectionState | null,
	current: WhatsAppWebhookEventDocument,
): Promise<void> {
	const state = toWhatsAppConnectionState(current);
	if (!state || state.status === previous?.status) return;

	const wasHealthy = !previous || !UNHEALTHY_CONNECTION_STATES.has(previous.status);
	const isHealthy = !UNHEALTHY_CONNECTION_STATES.has(state.status);
	if (wasHealthy === isHealthy) return;

	const session = current.sessionId ? ` (${current.sessionId})` : "";
	const message = isHealthy
		? `✅ WhatsApp session${session} is ${state.status} again. WhatsApp sign-in works.`
		: `⚠️ WhatsApp session${session} is ${state.status}. WhatsApp sign-in and signup will fail until it reconnects.`;
	console.warn(`[whatsapp] ${message}`);

	try {
		const { notifyTelegramAdmins } = await import("./telegram-bot");
		await notifyTelegramAdmins(message);
	} catch (error) {
		console.error("[whatsapp] Could not notify admins of the connection change:", error);
	}
}

/**
 * Verifies, parses and stores one delivery. Throws WhatsAppWebhookError for
 * anything the gateway should not retry as-is (bad signature, bad JSON).
 */
export async function handleWhatsAppWebhook(
	rawBody: string,
	signature: string | null,
): Promise<WhatsAppWebhookResult> {
	if (!isWhatsAppWebhookConfigured()) {
		console.error(
			`[whatsapp] A webhook arrived at ${WHATSAPP_WEBHOOK_PATH} but WHATSAPP_WEBHOOK_SECRET is not set, so it was refused.`,
		);
		throw new WhatsAppWebhookError(401, "Webhook signing secret is not configured.");
	}
	if (!verifyWhatsAppWebhookSignature(rawBody, signature)) {
		throw new WhatsAppWebhookError(401, "Invalid webhook signature.");
	}

	let payload: Record<string, unknown>;
	try {
		payload = asRecord(JSON.parse(rawBody));
	} catch {
		throw new WhatsAppWebhookError(400, "Webhook body is not valid JSON.");
	}

	const event = text(payload.event);
	if (!event || event.length > 100) {
		throw new WhatsAppWebhookError(400, "Webhook body has no event name.");
	}

	await getDb();
	const previous =
		event === "connection.update"
			? toWhatsAppConnectionState(await findLatestWhatsAppWebhookEvent("connection.update"))
			: null;

	const doc: WhatsAppWebhookEventDocument = {
		_id: createHash("sha256").update(rawBody, "utf8").digest("hex"),
		event,
		sessionId: text(payload.sessionId),
		occurredAt: parseTimestamp(payload.timestamp),
		receivedAt: new Date(),
		data: redact(event, payload.data ?? null),
	};

	const stored = await insertWhatsAppWebhookEvent(doc);
	if (stored && event === "connection.update") {
		void announceConnectionChange(previous, doc);
	}

	return { event, stored };
}
