import { createHmac, timingSafeEqual } from "node:crypto";
import Razorpay from "razorpay";
import type { BillingCycle, BillingPlanId } from "../../shared/billing";

const DEFAULT_TAX_PERCENT = 18;

export interface RazorpayConfig {
	keyId: string;
	keySecret: string;
	/**
	 * Every accepted webhook signing secret. Razorpay issues one secret per
	 * webhook, so a deployment serving several domains — or one mid-rotation —
	 * legitimately has more than one valid secret at the same time.
	 */
	webhookSecrets: string[];
	taxPercent: number;
}

let cachedClient: Razorpay | null = null;

function readEnv(name: string): string | null {
	const value = Bun.env[name]?.trim();
	return value ? value : null;
}

function readTaxPercent(): number {
	const raw = Bun.env.RAZORPAY_TAX_PERCENT?.trim();
	if (!raw) return DEFAULT_TAX_PERCENT;

	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
		console.warn(
			`[razorpay] Ignoring invalid RAZORPAY_TAX_PERCENT="${raw}", falling back to ${DEFAULT_TAX_PERCENT}.`,
		);
		return DEFAULT_TAX_PERCENT;
	}

	return parsed;
}

/**
 * Collects every configured webhook secret. `RAZORPAY_WEBHOOK_SECRET` stays the
 * single-webhook case; `RAZORPAY_WEBHOOK_SECRETS` takes a comma-separated list
 * for deployments with a webhook per domain.
 */
function readWebhookSecrets(): string[] {
	const secrets = [
		readEnv("RAZORPAY_WEBHOOK_SECRET"),
		...(Bun.env.RAZORPAY_WEBHOOK_SECRETS ?? "").split(","),
	]
		.map((secret) => secret?.trim())
		.filter((secret): secret is string => Boolean(secret));

	// A secret listed in both variables must not be tried twice.
	return [...new Set(secrets)];
}

/** Returns null when the keys are absent, so the app boots fine without Razorpay. */
export function getRazorpayConfig(): RazorpayConfig | null {
	const keyId = readEnv("RAZORPAY_KEY_ID");
	const keySecret = readEnv("RAZORPAY_KEY_SECRET");
	if (!keyId || !keySecret) return null;

	return {
		keyId,
		keySecret,
		webhookSecrets: readWebhookSecrets(),
		taxPercent: readTaxPercent(),
	};
}

export function isRazorpayConfigured(): boolean {
	return getRazorpayConfig() !== null;
}

export function getTaxPercent(): number {
	return readTaxPercent();
}

export function getRazorpayClient(): Razorpay | null {
	const config = getRazorpayConfig();
	if (!config) return null;

	if (!cachedClient) {
		cachedClient = new Razorpay({ key_id: config.keyId, key_secret: config.keySecret });
	}

	return cachedClient;
}

/**
 * Razorpay plan ids are created in the dashboard, not by this app. When a plan
 * id is configured for a tier the checkout uses Razorpay Subscriptions (an
 * auto-recurring mandate); otherwise it falls back to a one-time Order that
 * prepays the whole term.
 */
export function getRazorpayPlanId(planId: BillingPlanId, cycle: BillingCycle): string | null {
	return readEnv(`RAZORPAY_PLAN_ID_${planId.toUpperCase()}_${cycle.toUpperCase()}`);
}

function safeEquals(expected: string, received: string): boolean {
	const expectedBuffer = Buffer.from(expected, "utf8");
	const receivedBuffer = Buffer.from(received, "utf8");
	// timingSafeEqual throws on a length mismatch, and the length of an HMAC
	// hex digest is not a secret, so compare it up front.
	if (expectedBuffer.length !== receivedBuffer.length) return false;
	return timingSafeEqual(expectedBuffer, receivedBuffer);
}

function hmacSha256Hex(message: string, secret: string): string {
	return createHmac("sha256", secret).update(message).digest("hex");
}

/**
 * Verifies the signature Razorpay Checkout hands back to the browser.
 * The signed payload is `<order_id>|<payment_id>` for orders and
 * `<payment_id>|<subscription_id>` for subscriptions — note the reversed order.
 */
export function verifyCheckoutSignature(params: {
	paymentId: string;
	orderId?: string | null;
	subscriptionId?: string | null;
	signature: string;
}): boolean {
	const config = getRazorpayConfig();
	if (!config) return false;

	const payload = params.subscriptionId
		? `${params.paymentId}|${params.subscriptionId}`
		: params.orderId
			? `${params.orderId}|${params.paymentId}`
			: null;

	if (!payload) return false;

	return safeEquals(hmacSha256Hex(payload, config.keySecret), params.signature);
}

/**
 * Verifies a webhook delivery. The signed message is the exact raw request
 * body, so the caller must hand over the untouched bytes — re-serialising the
 * parsed JSON changes key order and whitespace and breaks the signature.
 */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
	const secrets = getRazorpayConfig()?.webhookSecrets ?? [];
	if (!secrets.length) return false;

	// Every secret is checked even after a match, so the work done does not
	// depend on which webhook the delivery came from.
	let matched = false;
	for (const secret of secrets) {
		if (safeEquals(hmacSha256Hex(rawBody, secret), signature)) matched = true;
	}
	return matched;
}

export function isRazorpayWebhookConfigured(): boolean {
	return (getRazorpayConfig()?.webhookSecrets.length ?? 0) > 0;
}

/** How many webhook secrets are accepted, for the startup banner. */
export function countRazorpayWebhookSecrets(): number {
	return getRazorpayConfig()?.webhookSecrets.length ?? 0;
}

/** True when Razorpay rejected our API key pair, rather than the request. */
export function isRazorpayAuthFailure(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;

	const statusCode = (error as { statusCode?: unknown }).statusCode;
	if (statusCode === 401) return true;

	const wrapped = (error as { error?: { code?: unknown; description?: unknown } }).error;
	return (
		wrapped?.code === "BAD_REQUEST_ERROR" &&
		typeof wrapped.description === "string" &&
		/authentication failed/i.test(wrapped.description)
	);
}

/** Razorpay SDK errors carry the useful detail under `error.description`. */
export function describeRazorpayError(error: unknown): string {
	if (error && typeof error === "object") {
		const wrapped = (error as { error?: { description?: unknown; reason?: unknown } }).error;
		if (wrapped && typeof wrapped.description === "string" && wrapped.description) {
			return wrapped.description;
		}
		const message = (error as { message?: unknown }).message;
		if (typeof message === "string" && message) return message;
	}

	return "Razorpay request failed.";
}
