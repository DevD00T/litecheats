/**
 * Client for the WhatsApp OTP gateway.
 *
 *   POST {WHATSAPP_OTP_API_URL}/send    { phone }         -> sends a code
 *   POST {WHATSAPP_OTP_API_URL}/verify  { phone, code }   -> checks it
 *
 * Both authenticate with the `x-api-key` header. The gateway generates, stores
 * and expires the code itself; we never see it. Our own record of each send
 * (see db/whatsapp-otp.ts) only bounds guesses and resends.
 *
 * The gateway's response shape is not formally documented. Its errors look like
 * `{"status": false, "message": "...", "error": "..."}`, so the parser below reads
 * the usual boolean flags and, for verification, fails closed: a 2xx reply that
 * does not positively say "verified" is treated as the gateway being unusable,
 * never as a correct code.
 */

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_COUNTRY_CODE = "91";

/** Characters people type in phone numbers. Anything else is refused, not stripped. */
const PHONE_INPUT_PATTERN = /^\+?[\d\s().-]+$/;
/** E.164 without the "+": a non-zero country code digit, 8 to 15 digits in total. */
const E164_DIGITS_PATTERN = /^[1-9]\d{7,14}$/;

export type WhatsAppOtpFailureReason =
	/** The gateway judged the request and said no: wrong code, number not on WhatsApp. */
	| "rejected"
	/** The gateway is throttling this number or our key. */
	| "rate_limited"
	/** Not configured, unreachable, misconfigured key, or a reply we cannot read. */
	| "unavailable";

export type WhatsAppOtpResult =
	| { ok: true }
	| { ok: false; reason: WhatsAppOtpFailureReason; detail: string };

export interface WhatsAppOtpClient {
	readonly configured: boolean;
	sendCode(phone: string): Promise<WhatsAppOtpResult>;
	verifyCode(phone: string, code: string): Promise<WhatsAppOtpResult>;
}

export interface WhatsAppOtpClientOptions {
	/** Base URL up to and including the session segment, e.g. ".../api/otp/d3nngw". */
	baseUrl: string;
	apiKey: string;
	timeoutMs?: number;
	fetch?: typeof fetch;
}

/**
 * Turns what someone typed into digits-only international form, or null when it
 * cannot be a phone number. A 10-digit local number gets the default country
 * code, as does an 11-digit one written with a leading trunk "0".
 */
export function normalizeWhatsAppPhone(
	input: string,
	defaultCountryCode: string = readDefaultCountryCode(),
): string | null {
	const trimmed = input.trim();
	if (!trimmed || !PHONE_INPUT_PATTERN.test(trimmed)) return null;

	let digits = trimmed.replace(/\D/g, "");
	if (!trimmed.startsWith("+")) {
		if (digits.startsWith("00")) {
			digits = digits.slice(2);
		} else if (defaultCountryCode && digits.length === 10) {
			digits = `${defaultCountryCode}${digits}`;
		} else if (defaultCountryCode && digits.length === 11 && digits.startsWith("0")) {
			digits = `${defaultCountryCode}${digits.slice(1)}`;
		}
	}

	return E164_DIGITS_PATTERN.test(digits) ? digits : null;
}

function readDefaultCountryCode(): string {
	const configured = Bun.env.WHATSAPP_DEFAULT_COUNTRY_CODE?.replace(/\D/g, "");
	return configured ?? DEFAULT_COUNTRY_CODE;
}

/**
 * Reads the gateway's yes/no out of a reply body: `true`, `false`, or null when
 * the body carries no recognisable flag at all.
 */
export function readGatewayVerdict(body: unknown): boolean | null {
	if (!body || typeof body !== "object") return null;
	const record = body as Record<string, unknown>;

	// A single explicit false anywhere wins over any true, so a reply such as
	// {"success": true, "verified": false} is never read as a pass.
	let sawTrue = false;
	for (const key of ["success", "status", "verified", "valid", "ok"]) {
		const value = record[key];
		let flag: boolean | null = null;
		if (typeof value === "boolean") {
			flag = value;
		} else if (typeof value === "string") {
			const normalized = value.trim().toLowerCase();
			if (["success", "ok", "verified", "approved", "valid", "sent"].includes(normalized)) {
				flag = true;
			} else if (
				["failed", "failure", "error", "invalid", "expired", "denied"].includes(normalized)
			) {
				flag = false;
			}
		}
		if (flag === false) return false;
		if (flag === true) sawTrue = true;
	}

	if (record.data && typeof record.data === "object") {
		const nested = readGatewayVerdict(record.data);
		if (nested === false) return false;
		if (nested === true) sawTrue = true;
	}

	return sawTrue ? true : null;
}

function describeBody(body: unknown, raw: string): string {
	if (body && typeof body === "object") {
		const record = body as Record<string, unknown>;
		const text = record.message ?? record.error ?? record.detail;
		if (typeof text === "string" && text.trim()) return text.trim().slice(0, 300);
	}
	return raw.trim().slice(0, 300) || "(empty body)";
}

export function createWhatsAppOtpClient(options: WhatsAppOtpClientOptions): WhatsAppOtpClient {
	const baseUrl = options.baseUrl.trim().replace(/\/+$/, "");
	const apiKey = options.apiKey.trim();
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const fetchImpl = options.fetch ?? fetch;
	const configured = Boolean(baseUrl && apiKey);

	async function call(
		action: "send" | "verify",
		payload: Record<string, string>,
	): Promise<{ status: number; body: unknown; detail: string } | { error: string }> {
		try {
			const response = await fetchImpl(`${baseUrl}/${action}`, {
				method: "POST",
				headers: {
					"x-api-key": apiKey,
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify(payload),
				signal: AbortSignal.timeout(timeoutMs),
			});
			const raw = await response.text();
			let body: unknown = null;
			try {
				body = raw ? JSON.parse(raw) : null;
			} catch {
				body = null;
			}
			return { status: response.status, body, detail: describeBody(body, raw) };
		} catch (error) {
			return { error: error instanceof Error ? error.message : String(error) };
		}
	}

	function notConfigured(): WhatsAppOtpResult {
		return {
			ok: false,
			reason: "unavailable",
			detail: "WHATSAPP_OTP_API_URL or WHATSAPP_OTP_API_KEY is not set.",
		};
	}

	/**
	 * Status codes the gateway uses to say "I understood you, and no". Anything
	 * else outside 2xx (401/403 for a bad key, 5xx, a dead tunnel) is our problem
	 * or theirs, not the user's, and is reported as unavailable.
	 */
	function classifyFailureStatus(status: number): WhatsAppOtpFailureReason {
		if (status === 429) return "rate_limited";
		if (status === 400 || status === 404 || status === 409 || status === 410 || status === 422) {
			return "rejected";
		}
		return "unavailable";
	}

	return {
		configured,

		async sendCode(phone) {
			if (!configured) return notConfigured();
			const reply = await call("send", { phone });
			if ("error" in reply) return { ok: false, reason: "unavailable", detail: reply.error };

			const verdict = readGatewayVerdict(reply.body);
			if (reply.status >= 200 && reply.status < 300) {
				// Sending is not a security decision, so a 2xx with no flag counts as sent.
				if (verdict === false) return { ok: false, reason: "rejected", detail: reply.detail };
				return { ok: true };
			}
			return {
				ok: false,
				reason: classifyFailureStatus(reply.status),
				detail: `HTTP ${reply.status}: ${reply.detail}`,
			};
		},

		async verifyCode(phone, code) {
			if (!configured) return notConfigured();
			const reply = await call("verify", { phone, code });
			if ("error" in reply) return { ok: false, reason: "unavailable", detail: reply.error };

			const verdict = readGatewayVerdict(reply.body);
			if (reply.status >= 200 && reply.status < 300) {
				if (verdict === true) return { ok: true };
				if (verdict === false) return { ok: false, reason: "rejected", detail: reply.detail };
				// Fail closed: a success status alone is not proof the code matched.
				return {
					ok: false,
					reason: "unavailable",
					detail: `Unrecognised verify reply (HTTP ${reply.status}): ${reply.detail}`,
				};
			}
			return {
				ok: false,
				reason: classifyFailureStatus(reply.status),
				detail: `HTTP ${reply.status}: ${reply.detail}`,
			};
		},
	};
}

let defaultClient: WhatsAppOtpClient | null = null;

/** The client configured from the environment. Built once, on first use. */
export function getWhatsAppOtpClient(): WhatsAppOtpClient {
	if (!defaultClient) {
		defaultClient = createWhatsAppOtpClient({
			baseUrl: Bun.env.WHATSAPP_OTP_API_URL ?? "",
			apiKey: Bun.env.WHATSAPP_OTP_API_KEY ?? "",
			timeoutMs: Number(Bun.env.WHATSAPP_OTP_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
		});
	}
	return defaultClient;
}

/** Swaps the client used by the auth server. For tests only. */
export function setWhatsAppOtpClientForTests(client: WhatsAppOtpClient | null): void {
	defaultClient = client;
}
