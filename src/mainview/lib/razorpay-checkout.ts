import type {
	BillingSubscription,
	CreateCheckoutResponse,
	WalletResponse,
	WalletTopupResponse,
} from "shared/billing";
import { billingApi } from "./billing-api";

const RAZORPAY_CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";
const BRAND_NAME = "Litecheats";
const BRAND_THEME_COLOR = "#7c5cff";

interface RazorpayHandlerResponse {
	razorpay_payment_id: string;
	razorpay_order_id?: string;
	razorpay_subscription_id?: string;
	razorpay_signature: string;
}

interface RazorpayCheckoutOptions {
	key: string;
	name: string;
	description: string;
	order_id?: string;
	subscription_id?: string;
	amount?: number;
	currency?: string;
	theme?: { color: string };
	prefill?: { name?: string; email?: string };
	notes?: Record<string, string>;
	handler: (response: RazorpayHandlerResponse) => void;
	modal?: { ondismiss?: () => void };
}

interface RazorpayInstance {
	open: () => void;
	on: (event: string, handler: (payload: unknown) => void) => void;
}

declare global {
	interface Window {
		Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayInstance;
	}
}

let scriptPromise: Promise<void> | null = null;

/** Loads Razorpay's hosted checkout script once and reuses it for later opens. */
export function loadRazorpayCheckout(): Promise<void> {
	if (typeof window === "undefined") {
		return Promise.reject(new Error("Razorpay checkout needs a browser environment."));
	}

	if (window.Razorpay) return Promise.resolve();

	if (!scriptPromise) {
		scriptPromise = new Promise<void>((resolve, reject) => {
			const existing = document.querySelector<HTMLScriptElement>(
				`script[src="${RAZORPAY_CHECKOUT_SRC}"]`,
			);
			const script = existing ?? document.createElement("script");

			script.addEventListener("load", () => resolve());
			script.addEventListener("error", () => {
				// Let a later attempt retry rather than caching the failure forever.
				scriptPromise = null;
				reject(new Error("Could not load Razorpay checkout. Check your network and try again."));
			});

			if (!existing) {
				script.src = RAZORPAY_CHECKOUT_SRC;
				script.async = true;
				document.head.appendChild(script);
			}
		});
	}

	return scriptPromise;
}

export class CheckoutDismissedError extends Error {
	constructor() {
		super("Payment was cancelled.");
		this.name = "CheckoutDismissedError";
	}
}

/**
 * Opens Razorpay checkout for an already-created order or subscription and
 * resolves once the server has verified the resulting payment signature.
 * Verification is server-side on purpose: the browser's success callback alone
 * proves nothing.
 */
export async function openRazorpayCheckout(
	checkout: CreateCheckoutResponse,
): Promise<BillingSubscription> {
	await loadRazorpayCheckout();

	const RazorpayConstructor = window.Razorpay;
	if (!RazorpayConstructor) {
		throw new Error("Razorpay checkout is unavailable.");
	}

	return new Promise<BillingSubscription>((resolve, reject) => {
		let settled = false;

		const finish = (action: () => void) => {
			if (settled) return;
			settled = true;
			action();
		};

		const razorpay = new RazorpayConstructor({
			key: checkout.keyId,
			name: BRAND_NAME,
			description: `${checkout.planName} — ${checkout.quantity} vehicle${
				checkout.quantity === 1 ? "" : "s"
			}, billed ${checkout.cycle}`,
			...(checkout.orderId ? { order_id: checkout.orderId } : {}),
			...(checkout.subscriptionId ? { subscription_id: checkout.subscriptionId } : {}),
			amount: checkout.amount,
			currency: checkout.currency,
			theme: { color: BRAND_THEME_COLOR },
			prefill: {
				name: checkout.prefill.name,
				email: checkout.prefill.email,
			},
			handler: (response) => {
				void billingApi
					.verifyCheckout({
						subscriptionRecordId: checkout.subscriptionRecordId,
						razorpayPaymentId: response.razorpay_payment_id,
						razorpayOrderId: response.razorpay_order_id,
						razorpaySubscriptionId: response.razorpay_subscription_id,
						razorpaySignature: response.razorpay_signature,
					})
					.then((result) => {
						finish(() => {
							if (result.subscription) {
								resolve(result.subscription);
							} else {
								reject(new Error("Payment succeeded but no subscription was returned."));
							}
						});
					})
					.catch((error: unknown) => {
						finish(() => reject(error));
					});
			},
			modal: {
				ondismiss: () => {
					finish(() => reject(new CheckoutDismissedError()));
				},
			},
		});

		razorpay.on("payment.failed", (payload) => {
			const description =
				payload &&
				typeof payload === "object" &&
				"error" in payload &&
				payload.error &&
				typeof payload.error === "object" &&
				"description" in payload.error
					? String((payload.error as { description: unknown }).description)
					: "Payment failed. Please try another method.";

			finish(() => reject(new Error(description)));
		});

		razorpay.open();
	});
}

/**
 * Opens Razorpay checkout for a wallet top-up and resolves with the wallet as
 * it stands after the server has verified the payment. Same contract as plan
 * checkout: the browser callback is evidence, the server decides.
 */
export async function openWalletTopupCheckout(topup: WalletTopupResponse): Promise<WalletResponse> {
	await loadRazorpayCheckout();

	const RazorpayConstructor = window.Razorpay;
	if (!RazorpayConstructor) {
		throw new Error("Razorpay checkout is unavailable.");
	}

	return new Promise<WalletResponse>((resolve, reject) => {
		let settled = false;
		const finish = (action: () => void) => {
			if (settled) return;
			settled = true;
			action();
		};

		const razorpay = new RazorpayConstructor({
			key: topup.keyId,
			name: BRAND_NAME,
			description: "Wallet top-up",
			order_id: topup.orderId,
			amount: topup.amount,
			currency: topup.currency,
			theme: { color: BRAND_THEME_COLOR },
			prefill: { name: topup.prefill.name, email: topup.prefill.email },
			handler: (response) => {
				void billingApi
					.verifyWalletTopup({
						topupId: topup.topupId,
						razorpayPaymentId: response.razorpay_payment_id,
						razorpayOrderId: response.razorpay_order_id ?? "",
						razorpaySignature: response.razorpay_signature,
					})
					.then((wallet) => finish(() => resolve(wallet)))
					.catch((error: unknown) => finish(() => reject(error)));
			},
			modal: {
				ondismiss: () => finish(() => reject(new CheckoutDismissedError())),
			},
		});

		razorpay.on("payment.failed", (payload) => {
			const description =
				payload &&
				typeof payload === "object" &&
				"error" in payload &&
				payload.error &&
				typeof payload.error === "object" &&
				"description" in payload.error
					? String((payload.error as { description: unknown }).description)
					: "Top-up failed. Please try another method.";
			finish(() => reject(new Error(description)));
		});

		razorpay.open();
	});
}
