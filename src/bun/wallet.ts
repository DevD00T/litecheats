import type { Payments } from "razorpay/dist/types/payments";
import {
	BILLING_CURRENCY,
	BILLING_CYCLE_MONTHS,
	RENEWAL_WARNING_DAYS,
	type RenewalNotice,
	type UpdateWalletPreferencesPayload,
	type VerifyWalletTopupPayload,
	WALLET_MAX_TOPUP_PAISE,
	WALLET_MIN_TOPUP_PAISE,
	type WalletResponse,
	type WalletSummary,
	type WalletTopupPayload,
	type WalletTopupResponse,
	daysUntil,
	formatInr,
	isWalletPaymentMode,
} from "../../shared/billing";
import {
	BillingError,
	announceLowBalanceToAdmins,
	announceRenewalFailedToAdmins,
	announceRenewalToAdmins,
	announceTopupToAdmins,
} from "./billing";
import {
	type BillingSubscriptionDocument,
	type UserDocument,
	type WalletDocument,
	type WithId,
	applyWalletTransaction,
	ensureWallet,
	findActiveBillingSubscriptionForUser,
	findBillingSubscriptionById,
	findUserById,
	findWalletTopupById,
	findWalletTopupByOrderId,
	getDb,
	insertWalletTopup,
	listSubscriptionsDueForRenewal,
	listSubscriptionsNeedingRenewalWarning,
	listWalletTransactions,
	markRenewalWarningSent,
	markWalletTopupFailed,
	markWalletTopupPaid,
	updateBillingSubscriptionFields,
	updateWalletPreferences,
} from "./db";
import { sendRenewalWarningEmail } from "./email";
import {
	describeRazorpayError,
	getRazorpayClient,
	getRazorpayConfig,
	isRazorpayAuthFailure,
	verifyCheckoutSignature,
} from "./razorpay";

const WALLET_TRANSACTION_LIMIT = 50;
const TOPUP_RECEIPT_PREFIX = "wal";
/** How often the background sweep looks for renewals and warnings. */
const RENEWAL_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

function createUuidV7(): string {
	const maybeUuidV7 = (Bun as unknown as { randomUUIDv7?: () => string }).randomUUIDv7;
	return typeof maybeUuidV7 === "function" ? maybeUuidV7() : crypto.randomUUID();
}

function toWalletSummary(wallet: WalletDocument): WalletSummary {
	return {
		balance: wallet.balance,
		currency: wallet.currency,
		autoRenew: wallet.autoRenew,
		paymentMode: wallet.paymentMode,
		updatedAt: wallet.updatedAt.toISOString(),
	};
}

export async function getWalletForUser(userId: string): Promise<WalletResponse> {
	await getDb();
	const wallet = ensureWallet(userId);
	const transactions = listWalletTransactions(userId, WALLET_TRANSACTION_LIMIT);

	return {
		wallet: toWalletSummary(wallet),
		transactions: transactions.map((transaction) => ({
			id: transaction._id,
			type: transaction.type,
			amount: transaction.amount,
			balanceAfter: transaction.balanceAfter,
			reason: transaction.reason,
			referenceId: transaction.referenceId,
			createdAt: transaction.createdAt.toISOString(),
		})),
	};
}

export function parseWalletTopupPayload(payload: unknown): WalletTopupPayload {
	if (!payload || typeof payload !== "object") {
		throw new BillingError(400, "Invalid top-up payload.");
	}

	const amount = Number((payload as Record<string, unknown>).amount);
	if (!Number.isInteger(amount)) {
		throw new BillingError(400, "amount must be a whole number of paise.");
	}

	if (amount < WALLET_MIN_TOPUP_PAISE || amount > WALLET_MAX_TOPUP_PAISE) {
		throw new BillingError(
			400,
			`Top-up must be between ${formatInr(WALLET_MIN_TOPUP_PAISE)} and ${formatInr(WALLET_MAX_TOPUP_PAISE)}.`,
		);
	}

	return { amount };
}

export function parseWalletPreferencesPayload(payload: unknown): UpdateWalletPreferencesPayload {
	if (!payload || typeof payload !== "object") {
		throw new BillingError(400, "Invalid preferences payload.");
	}

	const body = payload as Record<string, unknown>;
	const patch: UpdateWalletPreferencesPayload = {};

	if (body.autoRenew !== undefined) patch.autoRenew = Boolean(body.autoRenew);

	if (body.paymentMode !== undefined) {
		if (!isWalletPaymentMode(body.paymentMode)) {
			throw new BillingError(400, "paymentMode must be either 'wallet' or 'checkout'.");
		}
		patch.paymentMode = body.paymentMode;
	}

	if (Object.keys(patch).length === 0) {
		throw new BillingError(400, "Nothing to update.");
	}

	return patch;
}

export function parseVerifyWalletTopupPayload(payload: unknown): VerifyWalletTopupPayload {
	if (!payload || typeof payload !== "object") {
		throw new BillingError(400, "Invalid verification payload.");
	}

	const body = payload as Record<string, unknown>;
	const read = (key: string) => (typeof body[key] === "string" ? (body[key] as string).trim() : "");

	const topupId = read("topupId");
	const razorpayPaymentId = read("razorpayPaymentId");
	const razorpayOrderId = read("razorpayOrderId");
	const razorpaySignature = read("razorpaySignature");

	if (!topupId || !razorpayPaymentId || !razorpayOrderId || !razorpaySignature) {
		throw new BillingError(
			400,
			"topupId, razorpayPaymentId, razorpayOrderId and razorpaySignature are all required.",
		);
	}

	return { topupId, razorpayPaymentId, razorpayOrderId, razorpaySignature };
}

export async function setWalletPreferences(
	userId: string,
	patch: UpdateWalletPreferencesPayload,
): Promise<WalletResponse> {
	await getDb();
	ensureWallet(userId);
	updateWalletPreferences(userId, patch);
	return getWalletForUser(userId);
}

export async function createWalletTopup(
	user: WithId<UserDocument>,
	payload: WalletTopupPayload,
): Promise<WalletTopupResponse> {
	await getDb();
	const config = getRazorpayConfig();
	const client = getRazorpayClient();
	if (!config || !client) {
		throw new BillingError(
			503,
			"Payments are not configured on this deployment. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.",
		);
	}

	ensureWallet(user._id);
	const topupId = createUuidV7();
	const now = new Date();

	let orderId: string;
	try {
		const order = await client.orders.create({
			amount: payload.amount,
			currency: BILLING_CURRENCY,
			receipt: `${TOPUP_RECEIPT_PREFIX}_${topupId.replace(/-/g, "")}`.slice(0, 40),
			notes: {
				kind: "wallet_topup",
				litecheatsUserId: user._id,
				litecheatsTopupId: topupId,
			},
		});
		orderId = order.id;
	} catch (error) {
		console.error("[wallet] Razorpay top-up order creation failed:", error);
		if (isRazorpayAuthFailure(error)) {
			throw new BillingError(
				500,
				"Razorpay rejected these API credentials. Check RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.",
			);
		}
		throw new BillingError(502, describeRazorpayError(error));
	}

	insertWalletTopup({
		_id: topupId,
		userId: user._id,
		amount: payload.amount,
		razorpayOrderId: orderId,
		razorpayPaymentId: null,
		status: "created",
		createdAt: now,
		updatedAt: now,
	});

	return {
		topupId,
		orderId,
		amount: payload.amount,
		currency: BILLING_CURRENCY,
		keyId: config.keyId,
		prefill: { name: user.fullName, email: user.email },
	};
}

/**
 * Confirms a top-up and credits the wallet. As with plan checkout, the handler
 * signature only proves the callback came from Razorpay — the payment is
 * re-fetched from the API before any money is credited.
 */
export async function verifyWalletTopup(
	user: WithId<UserDocument>,
	payload: VerifyWalletTopupPayload,
): Promise<WalletResponse> {
	await getDb();
	const client = getRazorpayClient();
	if (!client) {
		throw new BillingError(503, "Payments are not configured on this deployment.");
	}

	const topup = findWalletTopupById(payload.topupId);
	if (!topup || topup.userId !== user._id) {
		throw new BillingError(404, "Top-up not found.");
	}

	if (topup.razorpayOrderId !== payload.razorpayOrderId) {
		throw new BillingError(400, "Order does not match this top-up.");
	}

	if (topup.status === "paid") {
		// The webhook got here first; the balance already reflects this top-up.
		return getWalletForUser(user._id);
	}

	const signatureValid = verifyCheckoutSignature({
		paymentId: payload.razorpayPaymentId,
		orderId: payload.razorpayOrderId,
		signature: payload.razorpaySignature,
	});

	if (!signatureValid) {
		markWalletTopupFailed(topup._id);
		throw new BillingError(400, "Payment signature verification failed.");
	}

	let payment: Payments.RazorpayPayment;
	try {
		payment = await client.payments.fetch(payload.razorpayPaymentId);
	} catch (error) {
		console.error("[wallet] Failed to fetch top-up payment:", error);
		throw new BillingError(502, describeRazorpayError(error));
	}

	if (payment.status === "authorized") {
		try {
			payment = await client.payments.capture(
				payload.razorpayPaymentId,
				payment.amount,
				String(payment.currency),
			);
		} catch (error) {
			console.error("[wallet] Top-up capture failed:", error);
			throw new BillingError(502, describeRazorpayError(error));
		}
	}

	if (payment.status !== "captured") {
		throw new BillingError(402, `Payment is ${payment.status}, not captured.`);
	}

	if (Number(payment.amount) !== topup.amount) {
		throw new BillingError(400, "Paid amount does not match the requested top-up.");
	}

	creditTopup(topup._id, user._id, topup.amount, payload.razorpayPaymentId);
	return getWalletForUser(user._id);
}

/**
 * Credits a top-up exactly once. `markWalletTopupPaid` only succeeds from the
 * `created` state, so whichever of the browser callback and the webhook arrives
 * second is a no-op rather than a double credit.
 */
export function creditTopup(
	topupId: string,
	userId: string,
	amount: number,
	razorpayPaymentId: string,
): boolean {
	if (!markWalletTopupPaid(topupId, razorpayPaymentId)) return false;

	const transaction = applyWalletTransaction({
		userId,
		type: "credit",
		amount,
		reason: "Wallet top-up",
		referenceId: razorpayPaymentId,
		transactionId: createUuidV7(),
	});

	void announceTopupToAdmins({
		userId,
		amount,
		razorpayPaymentId,
		balanceAfter: transaction?.balanceAfter ?? amount,
	});

	return true;
}

/** Called by the webhook handler when a wallet top-up order is paid. */
export async function creditTopupFromWebhook(
	orderId: string,
	razorpayPaymentId: string,
	amount: number,
): Promise<boolean> {
	await getDb();
	const topup = findWalletTopupByOrderId(orderId);
	if (!topup) return false;
	if (amount !== topup.amount) {
		console.warn(
			`[wallet] Webhook amount ${amount} does not match top-up ${topup._id} amount ${topup.amount}; ignoring.`,
		);
		return false;
	}
	return creditTopup(topup._id, topup.userId, topup.amount, razorpayPaymentId);
}

function addMonths(from: Date, months: number): Date {
	const result = new Date(from.getTime());
	const dayOfMonth = result.getDate();
	result.setMonth(result.getMonth() + months);
	if (result.getDate() !== dayOfMonth) result.setDate(0);
	return result;
}

/**
 * The renewal notice for a user's current subscription, or null when nothing is
 * renewing inside the warning window. Computed on read so it always reflects
 * the live wallet balance rather than a stale snapshot.
 */
export async function getRenewalNoticeForUser(userId: string): Promise<RenewalNotice | null> {
	await getDb();
	const subscription = findActiveBillingSubscriptionForUser(userId, new Date());
	if (!subscription?.currentPeriodEnd || subscription.cancelAtPeriodEnd) return null;

	const renewsAt = subscription.currentPeriodEnd.toISOString();
	const daysRemaining = daysUntil(renewsAt);
	if (daysRemaining > RENEWAL_WARNING_DAYS) return null;

	const wallet = ensureWallet(userId);
	const amountDue = subscription.amount;
	const shortfall = Math.max(0, amountDue - wallet.balance);

	return {
		subscriptionId: subscription._id,
		planName: subscription.planName,
		renewsAt,
		daysRemaining,
		amountDue,
		walletBalance: wallet.balance,
		shortfall,
		paymentMode: wallet.paymentMode,
		autoRenew: wallet.autoRenew,
		willAutoRenew: wallet.autoRenew && wallet.paymentMode === "wallet" && shortfall === 0,
		currency: wallet.currency,
	};
}

export interface RenewalSweepResult {
	renewed: number;
	halted: number;
	warned: number;
}

/**
 * Renews terms that have run out by debiting the wallet, and sends the
 * ten-day warning for terms approaching their end. Safe to run repeatedly:
 * renewals only fire once a period has actually elapsed, and each warning is
 * recorded against the exact period end it was sent for.
 */
export async function runRenewalSweep(now: Date = new Date()): Promise<RenewalSweepResult> {
	await getDb();
	const result: RenewalSweepResult = { renewed: 0, halted: 0, warned: 0 };

	for (const subscription of listSubscriptionsDueForRenewal(now)) {
		if (await renewSubscriptionFromWallet(subscription, now)) {
			result.renewed += 1;
		} else {
			result.halted += 1;
		}
	}

	const windowEnd = new Date(now.getTime() + RENEWAL_WARNING_DAYS * 24 * 60 * 60 * 1000);
	for (const subscription of listSubscriptionsNeedingRenewalWarning(now, windowEnd)) {
		if (await sendRenewalWarning(subscription)) {
			result.warned += 1;
		}
	}

	return result;
}

async function renewSubscriptionFromWallet(
	subscription: WithId<BillingSubscriptionDocument>,
	now: Date,
): Promise<boolean> {
	const wallet = ensureWallet(subscription.userId);

	if (!wallet.autoRenew || wallet.paymentMode !== "wallet") {
		haltSubscription(subscription, "auto-renew is off or the payment mode is manual checkout");
		return false;
	}

	const debited = applyWalletTransaction({
		userId: subscription.userId,
		type: "debit",
		amount: subscription.amount,
		reason: `${subscription.planName} renewal (${subscription.quantity} × ${subscription.cycle})`,
		referenceId: subscription._id,
		transactionId: createUuidV7(),
	});

	if (!debited) {
		haltSubscription(subscription, "wallet balance did not cover the renewal");
		return false;
	}

	// Extend from the old period end, not from now, so a late sweep does not
	// silently shorten the term the customer paid for.
	const periodStart = subscription.currentPeriodEnd ?? now;
	updateBillingSubscriptionFields(subscription._id, {
		status: "active",
		currentPeriodStart: periodStart,
		currentPeriodEnd: addMonths(periodStart, BILLING_CYCLE_MONTHS[subscription.cycle]),
		updatedAt: now,
	});

	console.log(
		`[wallet] Renewed ${subscription.planName} for user ${subscription.userId} from wallet (${formatInr(subscription.amount)}).`,
	);

	void announceRenewalToAdmins({
		userId: subscription.userId,
		planName: subscription.planName,
		quantity: subscription.quantity,
		cycle: subscription.cycle,
		amount: subscription.amount,
		balanceAfter: debited.balanceAfter,
		periodEnd: findBillingSubscriptionById(subscription._id)?.currentPeriodEnd ?? null,
	});

	return true;
}

function haltSubscription(subscription: WithId<BillingSubscriptionDocument>, reason: string): void {
	updateBillingSubscriptionFields(subscription._id, {
		status: "halted",
		updatedAt: new Date(),
	});
	console.warn(
		`[wallet] Halted ${subscription.planName} for user ${subscription.userId}: ${reason}.`,
	);

	void announceRenewalFailedToAdmins({
		userId: subscription.userId,
		planName: subscription.planName,
		amount: subscription.amount,
		balance: ensureWallet(subscription.userId).balance,
		reason,
	});
}

async function sendRenewalWarning(
	subscription: WithId<BillingSubscriptionDocument>,
): Promise<boolean> {
	if (!subscription.currentPeriodEnd) return false;

	const user = findUserById(subscription.userId);
	if (!user) return false;

	const wallet = ensureWallet(subscription.userId);
	const shortfall = Math.max(0, subscription.amount - wallet.balance);

	await sendRenewalWarningEmail({
		to: user.email,
		fullName: user.fullName,
		planName: subscription.planName,
		renewsAt: subscription.currentPeriodEnd,
		daysRemaining: daysUntil(subscription.currentPeriodEnd.toISOString()),
		amountDue: subscription.amount,
		walletBalance: wallet.balance,
		shortfall,
		paymentMode: wallet.paymentMode,
		autoRenew: wallet.autoRenew,
	});

	if (shortfall > 0 || wallet.paymentMode !== "wallet" || !wallet.autoRenew) {
		void announceLowBalanceToAdmins({
			userId: subscription.userId,
			planName: subscription.planName,
			amount: subscription.amount,
			balance: wallet.balance,
			shortfall,
			daysRemaining: daysUntil(subscription.currentPeriodEnd.toISOString()),
			paymentMode: wallet.paymentMode,
			autoRenew: wallet.autoRenew,
		});
	}

	markRenewalWarningSent(subscription._id, subscription.currentPeriodEnd);
	return true;
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;

/** Starts the hourly renewal sweep. Idempotent. */
export function startRenewalSweep(): void {
	if (sweepTimer) return;

	const tick = () => {
		runRenewalSweep().catch((error) => {
			console.error("[wallet] Renewal sweep failed:", error);
		});
	};

	sweepTimer = setInterval(tick, RENEWAL_SWEEP_INTERVAL_MS);
	// Don't hold the process open just for the sweep.
	sweepTimer.unref?.();
	tick();
}

export function stopRenewalSweep(): void {
	if (!sweepTimer) return;
	clearInterval(sweepTimer);
	sweepTimer = null;
}

export function deductWalletForUser(params: {
	userId: string;
	amount: number;
	reason: string;
	referenceId: string | null;
}): boolean {
	return (
		applyWalletTransaction({
			...params,
			type: "debit",
			transactionId: createUuidV7(),
		}) !== null
	);
}
