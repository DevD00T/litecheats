import { AUTH_API_PORT } from "shared/auth";
import {
	type AdminBillingOrdersResponse,
	type AdminCreateSubscriptionPayload,
	type AdminUpdateOrderPayload,
	BILLING_ADMIN_BASE_PATH,
	BILLING_BASE_PATH,
	type BillingHistoryResponse,
	type BillingOrdersResponse,
	type BillingPlansResponse,
	type BillingSubscriptionResponse,
	type CancelSubscriptionPayload,
	type CreateCheckoutPayload,
	type CreateCheckoutResponse,
	type RenewalNotice,
	type UpdateWalletPreferencesPayload,
	type VerifyCheckoutPayload,
	type VerifyWalletTopupPayload,
	type WalletResponse,
	type WalletTopupPayload,
	type WalletTopupResponse,
} from "shared/billing";

function resolveApiOrigin(): string {
	if (typeof window !== "undefined") {
		const protocol = window.location.protocol;
		if (protocol === "http:" || protocol === "https:") {
			return window.location.origin;
		}
	}

	// The desktop shell loads the app over a custom protocol, so fall back to
	// the API port directly rather than to an unusable origin.
	return `http://localhost:${AUTH_API_PORT}`;
}

const API_ORIGIN = resolveApiOrigin();
const BILLING_API_URL = `${API_ORIGIN}${BILLING_BASE_PATH}`;
// Admin billing hangs off the admin prefix, not the billing one, so it needs
// its own base rather than a path suffix.
const BILLING_ADMIN_API_URL = `${API_ORIGIN}${BILLING_ADMIN_BASE_PATH}`;

export class BillingApiError extends Error {
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

async function billingRequest<T>(path: string, init?: RequestInit): Promise<T> {
	return apiRequest<T>(`${BILLING_API_URL}${path}`, init);
}

async function adminBillingRequest<T>(path: string, init?: RequestInit): Promise<T> {
	return apiRequest<T>(`${BILLING_ADMIN_API_URL}${path}`, init);
}

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
	const headers = new Headers(init?.headers);
	if (!headers.has("Content-Type")) {
		headers.set("Content-Type", "application/json");
	}
	headers.set("Cache-Control", "no-cache");

	const response = await fetch(url, {
		...init,
		cache: "no-store",
		credentials: "include",
		headers,
	});

	if (response.status === 204) {
		return null as T;
	}

	let payload: unknown = null;
	try {
		payload = await response.json();
	} catch {
		payload = null;
	}

	if (!response.ok) {
		const message =
			payload && typeof payload === "object" && "error" in payload
				? String((payload as { error: unknown }).error)
				: `Billing request failed with status ${response.status}`;
		throw new BillingApiError(response.status, message);
	}

	return payload as T;
}

export const billingApi = {
	getPlans: () => billingRequest<BillingPlansResponse>("/plans"),
	createCheckout: (payload: CreateCheckoutPayload) =>
		billingRequest<CreateCheckoutResponse>("/checkout", {
			method: "POST",
			body: JSON.stringify(payload),
		}),
	verifyCheckout: (payload: VerifyCheckoutPayload) =>
		billingRequest<BillingSubscriptionResponse>("/verify", {
			method: "POST",
			body: JSON.stringify(payload),
		}),
	getSubscription: () => billingRequest<BillingSubscriptionResponse>("/subscription"),
	cancelSubscription: (payload: CancelSubscriptionPayload) =>
		billingRequest<BillingSubscriptionResponse>("/subscription/cancel", {
			method: "POST",
			body: JSON.stringify(payload),
		}),
	getPayments: () => billingRequest<BillingHistoryResponse>("/payments"),
	getOrders: () => billingRequest<BillingOrdersResponse>("/orders"),
	getWallet: () => billingRequest<WalletResponse>("/wallet"),
	updateWalletPreferences: (payload: UpdateWalletPreferencesPayload) =>
		billingRequest<WalletResponse>("/wallet", {
			method: "PATCH",
			body: JSON.stringify(payload),
		}),
	createWalletTopup: (payload: WalletTopupPayload) =>
		billingRequest<WalletTopupResponse>("/wallet/topup", {
			method: "POST",
			body: JSON.stringify(payload),
		}),
	verifyWalletTopup: (payload: VerifyWalletTopupPayload) =>
		billingRequest<WalletResponse>("/wallet/topup/verify", {
			method: "POST",
			body: JSON.stringify(payload),
		}),
	getRenewalNotice: () => billingRequest<{ renewal: RenewalNotice | null }>("/renewal"),
	getAdminOrders: () => adminBillingRequest<AdminBillingOrdersResponse>("/orders"),
	createAdminSubscription: (payload: AdminCreateSubscriptionPayload) =>
		adminBillingRequest<AdminBillingOrdersResponse>("/orders", {
			method: "POST",
			body: JSON.stringify(payload),
		}),
	deleteAdminSubscription: (orderId: string) =>
		adminBillingRequest<AdminBillingOrdersResponse>(`/orders/${encodeURIComponent(orderId)}`, {
			method: "DELETE",
		}),
	updateAdminOrder: (orderId: string, payload: AdminUpdateOrderPayload) =>
		adminBillingRequest<AdminBillingOrdersResponse>(`/orders/${encodeURIComponent(orderId)}`, {
			method: "PATCH",
			body: JSON.stringify(payload),
		}),
};
