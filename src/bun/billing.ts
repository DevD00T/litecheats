import type { Payments } from "razorpay/dist/types/payments";
import type {
	AdminBillingOrdersResponse,
	AdminCreateSubscriptionPayload,
	AdminUpdateOrderPayload,
	BillingCycle,
	BillingHistoryResponse,
	BillingOrdersResponse,
	BillingPlan,
	BillingPlanId,
	BillingPlanQuote,
	BillingPlansResponse,
	BillingSubscription,
	BillingSubscriptionStatus,
	CancelSubscriptionPayload,
	CreateCheckoutPayload,
	CreateCheckoutResponse,
	VerifyCheckoutPayload,
} from "../../shared/billing";
import {
	BILLING_CURRENCY,
	BILLING_CYCLES,
	BILLING_CYCLE_MONTHS,
	BILLING_PLANS,
	BILLING_SUBSCRIPTION_STATUSES,
	SUBSCRIPTION_NOTES_MAX_LENGTH,
	calculateBillingAmount,
	findBillingPlan,
	formatInr,
	isBillingCycle,
} from "../../shared/billing";
import {
	type BillingSubscriptionDocument,
	type UserDocument,
	type WithId,
	claimBillingWebhookEvent,
	claimOrderAdminNotification,
	deleteBillingSubscriptionById,
	findActiveBillingSubscriptionForUser,
	findBillingSubscriptionById,
	findBillingSubscriptionByOrderId,
	findBillingSubscriptionByRazorpayId,
	findLatestBillingSubscriptionForUser,
	findUserById,
	generateSubscriptionPrivateId,
	getBillingTotals,
	getDb,
	insertBillingPayment,
	insertBillingSubscription,
	listAllBillingSubscriptionsWithOwner,
	listBillingPaymentsForUser,
	listBillingSubscriptionsForUser,
	updateBillingSubscriptionFields,
} from "./db";
import {
	describeRazorpayError,
	getRazorpayClient,
	getRazorpayConfig,
	getRazorpayPlanId,
	getTaxPercent,
	isRazorpayAuthFailure,
	verifyCheckoutSignature,
	verifyWebhookSignature,
} from "./razorpay";

const PAYMENT_HISTORY_LIMIT = 25;
const RECEIPT_PREFIX = "lc";

/** Razorpay refuses orders below ₹1. Every catalogue plan is far above this,
 * but the guard keeps a future ₹0-ish tier from producing an opaque 400 from
 * the Razorpay API instead of a clear message here. */
const MIN_ORDER_AMOUNT_PAISE = 100;

const PAYMENT_EVENTS = new Set(["payment.authorized", "payment.captured", "payment.failed"]);

/** Billing cycles a Razorpay subscription mandate should run for before renewal is re-authorised. */
const DEFAULT_SUBSCRIPTION_TOTAL_COUNT: Record<BillingCycle, number> = {
	monthly: 12,
	annual: 5,
};

export class BillingError extends Error {
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

function requireRazorpayClient() {
	const client = getRazorpayClient();
	if (!client) {
		throw new BillingError(
			503,
			"Payments are not configured on this deployment. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.",
		);
	}
	return client;
}

function createUuidV7(): string {
	const maybeUuidV7 = (Bun as unknown as { randomUUIDv7?: () => string }).randomUUIDv7;
	return typeof maybeUuidV7 === "function" ? maybeUuidV7() : crypto.randomUUID();
}

/** Razorpay caps `receipt` at 40 characters. */
function buildReceipt(recordId: string): string {
	return `${RECEIPT_PREFIX}_${recordId.replace(/-/g, "")}`.slice(0, 40);
}

function addMonths(from: Date, months: number): Date {
	const result = new Date(from.getTime());
	const targetMonth = result.getMonth() + months;
	const dayOfMonth = result.getDate();
	result.setMonth(targetMonth);
	// setMonth rolls over when the target month is shorter (e.g. Jan 31 + 1
	// month lands on Mar 3); pull it back to the last day of the target month.
	if (result.getDate() !== dayOfMonth) {
		result.setDate(0);
	}
	return result;
}

function unixSecondsToDate(value: unknown): Date | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
	return new Date(value * 1000);
}

function toBillingSubscription(record: WithId<BillingSubscriptionDocument>): BillingSubscription {
	return {
		id: record._id,
		privateId: record.privateId,
		notes: record.notes,
		planId: record.planId,
		planName: record.planName,
		cycle: record.cycle,
		quantity: record.quantity,
		mode: record.mode,
		status: record.status,
		amount: record.amount,
		currency: record.currency,
		currentPeriodStart: record.currentPeriodStart?.toISOString() ?? null,
		currentPeriodEnd: record.currentPeriodEnd?.toISOString() ?? null,
		cancelAtPeriodEnd: record.cancelAtPeriodEnd,
		razorpayOrderId: record.razorpayOrderId,
		razorpaySubscriptionId: record.razorpaySubscriptionId,
		razorpayPaymentId: record.razorpayPaymentId,
		shortUrl: record.shortUrl,
		createdAt: record.createdAt.toISOString(),
		updatedAt: record.updatedAt.toISOString(),
	};
}

function quotePlan(plan: BillingPlan, taxPercent: number): BillingPlanQuote {
	const pricing = {} as BillingPlanQuote["pricing"];
	for (const cycle of BILLING_CYCLES) {
		pricing[cycle] = calculateBillingAmount(plan, cycle, plan.minQuantity, taxPercent);
	}
	return { ...plan, pricing };
}

export function getBillingPlansResponse(): BillingPlansResponse {
	const config = getRazorpayConfig();
	const taxPercent = getTaxPercent();

	return {
		configured: config !== null,
		keyId: config?.keyId ?? null,
		taxPercent,
		currency: BILLING_CURRENCY,
		plans: BILLING_PLANS.map((plan) => quotePlan(plan, taxPercent)),
	};
}

export function parseCreateCheckoutPayload(payload: unknown): CreateCheckoutPayload {
	if (!payload || typeof payload !== "object") {
		throw new BillingError(400, "Invalid checkout payload.");
	}

	const body = payload as Record<string, unknown>;
	const planId = typeof body.planId === "string" ? body.planId.trim() : "";
	const plan = findBillingPlan(planId);
	if (!plan) {
		throw new BillingError(400, "Unknown plan.");
	}

	if (plan.kind === "free") {
		throw new BillingError(400, `The ${plan.name} plan is free and does not require a payment.`);
	}

	if (plan.kind === "contact") {
		throw new BillingError(
			400,
			`The ${plan.name} plan is quoted by sales and cannot be bought online.`,
		);
	}

	if (!isBillingCycle(body.cycle)) {
		throw new BillingError(400, "cycle must be either 'monthly' or 'annual'.");
	}

	const quantity = Number(body.quantity ?? plan.minQuantity);
	if (!Number.isInteger(quantity) || quantity < plan.minQuantity || quantity > plan.maxQuantity) {
		throw new BillingError(
			400,
			`quantity must be a whole number between ${plan.minQuantity} and ${plan.maxQuantity} for the ${plan.name} plan.`,
		);
	}

	return { planId: plan.id, cycle: body.cycle, quantity };
}

export function parseVerifyCheckoutPayload(payload: unknown): VerifyCheckoutPayload {
	if (!payload || typeof payload !== "object") {
		throw new BillingError(400, "Invalid verification payload.");
	}

	const body = payload as Record<string, unknown>;
	const readString = (key: string): string =>
		typeof body[key] === "string" ? (body[key] as string).trim() : "";

	const subscriptionRecordId = readString("subscriptionRecordId");
	const razorpayPaymentId = readString("razorpayPaymentId");
	const razorpaySignature = readString("razorpaySignature");
	const razorpayOrderId = readString("razorpayOrderId");
	const razorpaySubscriptionId = readString("razorpaySubscriptionId");

	if (!subscriptionRecordId || !razorpayPaymentId || !razorpaySignature) {
		throw new BillingError(
			400,
			"subscriptionRecordId, razorpayPaymentId and razorpaySignature are all required.",
		);
	}

	if (!razorpayOrderId && !razorpaySubscriptionId) {
		throw new BillingError(400, "Either razorpayOrderId or razorpaySubscriptionId is required.");
	}

	return {
		subscriptionRecordId,
		razorpayPaymentId,
		razorpaySignature,
		razorpayOrderId: razorpayOrderId || undefined,
		razorpaySubscriptionId: razorpaySubscriptionId || undefined,
	};
}

export function parseCancelSubscriptionPayload(payload: unknown): CancelSubscriptionPayload {
	if (!payload || typeof payload !== "object") {
		throw new BillingError(400, "Invalid cancellation payload.");
	}

	const body = payload as Record<string, unknown>;
	const subscriptionId = typeof body.subscriptionId === "string" ? body.subscriptionId.trim() : "";
	if (!subscriptionId) {
		throw new BillingError(400, "subscriptionId is required.");
	}

	return {
		subscriptionId,
		atPeriodEnd: body.atPeriodEnd === undefined ? true : Boolean(body.atPeriodEnd),
	};
}

function readSubscriptionTotalCount(cycle: BillingCycle): number {
	const raw = Bun.env.RAZORPAY_SUBSCRIPTION_TOTAL_COUNT?.trim();
	if (!raw) return DEFAULT_SUBSCRIPTION_TOTAL_COUNT[cycle];

	const parsed = Number(raw);
	if (!Number.isInteger(parsed) || parsed < 1) {
		console.warn(
			`[billing] Ignoring invalid RAZORPAY_SUBSCRIPTION_TOTAL_COUNT="${raw}", using ${DEFAULT_SUBSCRIPTION_TOTAL_COUNT[cycle]}.`,
		);
		return DEFAULT_SUBSCRIPTION_TOTAL_COUNT[cycle];
	}

	return parsed;
}

export async function createCheckout(
	user: WithId<UserDocument>,
	payload: CreateCheckoutPayload,
): Promise<CreateCheckoutResponse> {
	await getDb();
	const client = requireRazorpayClient();
	const config = getRazorpayConfig();
	if (!config) {
		throw new BillingError(503, "Payments are not configured on this deployment.");
	}

	const plan = findBillingPlan(payload.planId);
	if (!plan) {
		throw new BillingError(400, "Unknown plan.");
	}

	// The amount is always recomputed here from the server-side catalogue, so a
	// tampered request body can only ever change the plan, cycle and quantity —
	// never the price attached to them.
	const breakdown = calculateBillingAmount(
		plan,
		payload.cycle,
		payload.quantity,
		config.taxPercent,
	);
	const recordId = createUuidV7();
	const now = new Date();
	const razorpayPlanId = getRazorpayPlanId(plan.id, payload.cycle);

	const notes: Record<string, string> = {
		litecheatsUserId: user._id,
		litecheatsRecordId: recordId,
		planId: plan.id,
		cycle: payload.cycle,
		quantity: String(payload.quantity),
	};

	if (breakdown.total < MIN_ORDER_AMOUNT_PAISE) {
		throw new BillingError(
			400,
			`A charge must be at least ${MIN_ORDER_AMOUNT_PAISE} paise; this selection comes to ${breakdown.total}.`,
		);
	}

	let razorpayOrderId: string | null = null;
	let razorpaySubscriptionId: string | null = null;
	let shortUrl: string | null = null;
	let amount = breakdown.total;

	try {
		if (razorpayPlanId) {
			// Auto-recurring: Razorpay's plan holds the price, so the catalogue
			// total is only used for display until the first invoice lands.
			const subscription = await client.subscriptions.create({
				plan_id: razorpayPlanId,
				total_count: readSubscriptionTotalCount(payload.cycle),
				quantity: payload.quantity,
				customer_notify: 1,
				notes,
			});
			razorpaySubscriptionId = subscription.id;
			shortUrl = typeof subscription.short_url === "string" ? subscription.short_url : null;
		} else {
			const order = await client.orders.create({
				amount: breakdown.total,
				currency: breakdown.currency,
				receipt: buildReceipt(recordId),
				notes,
			});
			razorpayOrderId = order.id;
			amount = Number(order.amount);
		}
	} catch (error) {
		console.error("[billing] Razorpay checkout creation failed:", error);
		// A 401 from Razorpay means our own keys were rejected — a server
		// misconfiguration, not an unauthenticated caller. Answering 401 here
		// would tell the browser the user's session had expired and send them
		// into a pointless re-login, so it surfaces as a 500 instead.
		if (isRazorpayAuthFailure(error)) {
			throw new BillingError(
				500,
				"Razorpay rejected these API credentials. Check RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.",
			);
		}
		throw new BillingError(502, describeRazorpayError(error));
	}

	const record: BillingSubscriptionDocument = {
		_id: recordId,
		userId: user._id,
		planId: plan.id,
		planName: plan.name,
		cycle: payload.cycle,
		quantity: payload.quantity,
		mode: razorpaySubscriptionId ? "subscription" : "order",
		status: "created",
		amount,
		currency: breakdown.currency,
		razorpayOrderId,
		razorpaySubscriptionId,
		razorpayPaymentId: null,
		shortUrl,
		currentPeriodStart: null,
		currentPeriodEnd: null,
		cancelAtPeriodEnd: false,
		privateId: generateSubscriptionPrivateId(),
		notes: "",
		renewalWarningSentFor: null,
		createdAt: now,
		updatedAt: now,
	};

	await insertBillingSubscription(record);

	return {
		mode: record.mode,
		keyId: config.keyId,
		orderId: razorpayOrderId,
		subscriptionId: razorpaySubscriptionId,
		amount,
		currency: breakdown.currency,
		breakdown,
		planId: plan.id,
		planName: plan.name,
		cycle: payload.cycle,
		quantity: payload.quantity,
		subscriptionRecordId: recordId,
		prefill: {
			name: user.fullName,
			email: user.email,
		},
	};
}

function periodForRecord(record: WithId<BillingSubscriptionDocument>, start: Date) {
	return {
		currentPeriodStart: start,
		currentPeriodEnd: addMonths(start, BILLING_CYCLE_MONTHS[record.cycle]),
	};
}

async function recordPayment(params: {
	userId: string;
	subscriptionId: string | null;
	razorpayPaymentId: string | null;
	razorpayOrderId: string | null;
	planId: string;
	amount: number;
	currency: string;
	status: string;
	method: string | null;
}): Promise<void> {
	const now = new Date();
	await insertBillingPayment({
		_id: createUuidV7(),
		userId: params.userId,
		subscriptionId: params.subscriptionId,
		razorpayPaymentId: params.razorpayPaymentId,
		razorpayOrderId: params.razorpayOrderId,
		planId: params.planId,
		amount: params.amount,
		currency: params.currency,
		status: params.status,
		method: params.method,
		createdAt: now,
		updatedAt: now,
	});
}

/**
 * Confirms a checkout that has just completed in the browser. The handler
 * signature proves the payment came from Razorpay, and the payment is then
 * re-fetched from the API so the recorded status and amount come from Razorpay
 * rather than from the client.
 */
export async function verifyCheckout(
	user: WithId<UserDocument>,
	payload: VerifyCheckoutPayload,
): Promise<BillingSubscription> {
	await getDb();
	const client = requireRazorpayClient();

	const record = await findBillingSubscriptionById(payload.subscriptionRecordId);
	if (!record || record.userId !== user._id) {
		throw new BillingError(404, "Checkout attempt not found.");
	}

	if (record.mode === "order" && payload.razorpayOrderId !== record.razorpayOrderId) {
		throw new BillingError(400, "Order does not match this checkout attempt.");
	}

	if (
		record.mode === "subscription" &&
		payload.razorpaySubscriptionId !== record.razorpaySubscriptionId
	) {
		throw new BillingError(400, "Subscription does not match this checkout attempt.");
	}

	const signatureValid = verifyCheckoutSignature({
		paymentId: payload.razorpayPaymentId,
		orderId: payload.razorpayOrderId ?? null,
		subscriptionId: payload.razorpaySubscriptionId ?? null,
		signature: payload.razorpaySignature,
	});

	if (!signatureValid) {
		await updateBillingSubscriptionFields(record._id, { status: "failed", updatedAt: new Date() });
		throw new BillingError(400, "Payment signature verification failed.");
	}

	let payment: Payments.RazorpayPayment;
	try {
		payment = await client.payments.fetch(payload.razorpayPaymentId);
	} catch (error) {
		console.error("[billing] Failed to fetch payment during verification:", error);
		throw new BillingError(502, describeRazorpayError(error));
	}

	// Orders created without dashboard auto-capture land as `authorized`; capture
	// them here so the money is actually collected rather than auto-refunded.
	if (payment.status === "authorized" && record.mode === "order") {
		try {
			payment = await client.payments.capture(
				payload.razorpayPaymentId,
				payment.amount,
				String(payment.currency),
			);
		} catch (error) {
			console.error("[billing] Payment capture failed:", error);
			throw new BillingError(502, describeRazorpayError(error));
		}
	}

	if (payment.status !== "captured") {
		await recordPayment({
			userId: user._id,
			subscriptionId: record._id,
			razorpayPaymentId: payload.razorpayPaymentId,
			razorpayOrderId: record.razorpayOrderId,
			planId: record.planId,
			amount: Number(payment.amount),
			currency: String(payment.currency),
			status: String(payment.status),
			method: typeof payment.method === "string" ? payment.method : null,
		});
		await updateBillingSubscriptionFields(record._id, { status: "pending", updatedAt: new Date() });
		throw new BillingError(402, `Payment is ${payment.status}, not captured. Please try again.`);
	}

	if (record.mode === "order" && Number(payment.amount) !== record.amount) {
		throw new BillingError(
			400,
			"Paid amount does not match the amount this order was created for.",
		);
	}

	const now = new Date();
	const period = periodForRecord(record, now);

	await updateBillingSubscriptionFields(record._id, {
		status: "active",
		razorpayPaymentId: payload.razorpayPaymentId,
		currentPeriodStart: period.currentPeriodStart,
		currentPeriodEnd: period.currentPeriodEnd,
		updatedAt: now,
	});

	await recordPayment({
		userId: user._id,
		subscriptionId: record._id,
		razorpayPaymentId: payload.razorpayPaymentId,
		razorpayOrderId: record.razorpayOrderId,
		planId: record.planId,
		amount: Number(payment.amount),
		currency: String(payment.currency),
		status: "captured",
		method: typeof payment.method === "string" ? payment.method : null,
	});

	const updated = await findBillingSubscriptionById(record._id);
	if (!updated) {
		throw new BillingError(500, "Subscription record disappeared after activation.");
	}

	// Fire-and-forget: the customer's payment is already confirmed, so a slow or
	// failing Telegram call must not delay or fail their response.
	void announceOrderToAdmins(updated._id);

	return toBillingSubscription(updated);
}

export async function getSubscriptionForUser(userId: string): Promise<BillingSubscription | null> {
	await getDb();
	const active = await findActiveBillingSubscriptionForUser(userId, new Date());
	const record = active ?? (await findLatestBillingSubscriptionForUser(userId));
	return record ? toBillingSubscription(record) : null;
}

export async function getPaymentHistoryForUser(userId: string): Promise<BillingHistoryResponse> {
	await getDb();
	const payments = await listBillingPaymentsForUser(userId, PAYMENT_HISTORY_LIMIT);

	return {
		payments: payments.map((payment) => ({
			id: payment._id,
			razorpayPaymentId: payment.razorpayPaymentId,
			razorpayOrderId: payment.razorpayOrderId,
			amount: payment.amount,
			currency: payment.currency,
			status: payment.status,
			method: payment.method,
			planId: payment.planId,
			createdAt: payment.createdAt.toISOString(),
		})),
	};
}

export async function cancelSubscription(
	userId: string,
	payload: CancelSubscriptionPayload,
): Promise<BillingSubscription> {
	await getDb();
	const record = await findBillingSubscriptionById(payload.subscriptionId);
	if (!record || record.userId !== userId) {
		throw new BillingError(404, "Subscription not found.");
	}

	if (record.status === "cancelled" || record.status === "expired") {
		return toBillingSubscription(record);
	}

	const atPeriodEnd = payload.atPeriodEnd !== false;

	if (record.mode === "subscription" && record.razorpaySubscriptionId) {
		const client = requireRazorpayClient();
		try {
			await client.subscriptions.cancel(record.razorpaySubscriptionId, atPeriodEnd);
		} catch (error) {
			console.error("[billing] Razorpay subscription cancellation failed:", error);
			throw new BillingError(502, describeRazorpayError(error));
		}
	}

	const now = new Date();
	await updateBillingSubscriptionFields(record._id, {
		// A prepaid order-mode term is honoured to its end date; only an immediate
		// cancellation revokes access right away.
		status: atPeriodEnd ? record.status : "cancelled",
		cancelAtPeriodEnd: atPeriodEnd,
		currentPeriodEnd: atPeriodEnd ? record.currentPeriodEnd : now,
		updatedAt: now,
	});

	const updated = await findBillingSubscriptionById(record._id);
	if (!updated) {
		throw new BillingError(500, "Subscription record disappeared after cancellation.");
	}

	return toBillingSubscription(updated);
}

interface RazorpayWebhookEnvelope {
	event?: unknown;
	payload?: {
		payment?: { entity?: Record<string, unknown> };
		order?: { entity?: Record<string, unknown> };
		subscription?: { entity?: Record<string, unknown> };
		refund?: { entity?: Record<string, unknown> };
	};
}

function readString(entity: Record<string, unknown> | undefined, key: string): string | null {
	const value = entity?.[key];
	return typeof value === "string" && value ? value : null;
}

function readNumber(entity: Record<string, unknown> | undefined, key: string): number | null {
	const value = entity?.[key];
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Resolves the local record a webhook entity belongs to. Razorpay notes are the
 * most reliable link because this app sets them at creation time; the order and
 * subscription ids are the fallback for events that carry no notes.
 */
async function resolveRecordFromEntity(
	entity: Record<string, unknown> | undefined,
): Promise<WithId<BillingSubscriptionDocument> | null> {
	const notes = entity?.notes;
	if (notes && typeof notes === "object") {
		const recordId = (notes as Record<string, unknown>).litecheatsRecordId;
		if (typeof recordId === "string" && recordId) {
			const byNotes = await findBillingSubscriptionById(recordId);
			if (byNotes) return byNotes;
		}
	}

	const orderId = readString(entity, "order_id") ?? readString(entity, "id");
	if (orderId?.startsWith("order_")) {
		const byOrder = await findBillingSubscriptionByOrderId(orderId);
		if (byOrder) return byOrder;
	}

	const subscriptionId =
		readString(entity, "subscription_id") ??
		(readString(entity, "id")?.startsWith("sub_") ? readString(entity, "id") : null);
	if (subscriptionId) {
		const bySubscription = await findBillingSubscriptionByRazorpayId(subscriptionId);
		if (bySubscription) return bySubscription;
	}

	return null;
}

async function activateRecord(
	record: WithId<BillingSubscriptionDocument>,
	options: {
		paymentId?: string | null;
		periodStart?: Date | null;
		periodEnd?: Date | null;
	} = {},
): Promise<void> {
	const now = new Date();
	const start = options.periodStart ?? record.currentPeriodStart ?? now;
	const end = options.periodEnd ?? addMonths(start, BILLING_CYCLE_MONTHS[record.cycle]);

	await updateBillingSubscriptionFields(record._id, {
		status: "active",
		razorpayPaymentId: options.paymentId ?? record.razorpayPaymentId,
		currentPeriodStart: start,
		currentPeriodEnd: end,
		updatedAt: now,
	});
}

const SUBSCRIPTION_EVENT_STATUS: Record<string, BillingSubscriptionStatus> = {
	"subscription.authenticated": "pending",
	"subscription.pending": "pending",
	"subscription.activated": "active",
	"subscription.charged": "active",
	"subscription.halted": "halted",
	"subscription.cancelled": "cancelled",
	"subscription.completed": "expired",
	"subscription.expired": "expired",
};

function isWalletTopupEntity(entity: Record<string, unknown> | undefined): boolean {
	const notes = entity?.notes;
	if (!notes || typeof notes !== "object") return false;
	return (notes as Record<string, unknown>).kind === "wallet_topup";
}

async function applyPaymentEvent(
	event: string,
	entity: Record<string, unknown> | undefined,
): Promise<void> {
	// A wallet top-up is a payment against an order that has no subscription
	// behind it, so it is settled here and never reaches the plan logic below.
	if (isWalletTopupEntity(entity)) {
		if (event !== "payment.captured") return;
		const orderId = readString(entity, "order_id");
		const paymentId = readString(entity, "id");
		const amount = readNumber(entity, "amount");
		if (!orderId || !paymentId || amount === null) return;

		const { creditTopupFromWebhook } = await import("./wallet");
		const credited = await creditTopupFromWebhook(orderId, paymentId, amount);
		console.log(
			credited
				? `[billing] Wallet top-up credited from webhook for order ${orderId}.`
				: `[billing] Wallet top-up for order ${orderId} was already credited.`,
		);
		return;
	}

	const record = await resolveRecordFromEntity(entity);
	const paymentId = readString(entity, "id");
	const orderId = readString(entity, "order_id");
	const amount = readNumber(entity, "amount") ?? record?.amount ?? 0;
	const currency = readString(entity, "currency") ?? BILLING_CURRENCY;
	const status =
		event === "payment.failed" ? "failed" : (readString(entity, "status") ?? "captured");

	if (record) {
		await recordPayment({
			userId: record.userId,
			subscriptionId: record._id,
			razorpayPaymentId: paymentId,
			razorpayOrderId: orderId ?? record.razorpayOrderId,
			planId: record.planId,
			amount,
			currency,
			status,
			method: readString(entity, "method"),
		});
	}

	if (!record) {
		console.warn(`[billing] Webhook ${event} did not match a local checkout record.`);
		return;
	}

	if (event === "payment.captured") {
		await activateRecord(record, { paymentId });
		void announceOrderToAdmins(record._id);
		return;
	}

	if (event === "payment.failed" && record.status !== "active") {
		await updateBillingSubscriptionFields(record._id, { status: "failed", updatedAt: new Date() });
	}
}

async function applyOrderEvent(entity: Record<string, unknown> | undefined): Promise<void> {
	const record = await resolveRecordFromEntity(entity);
	if (!record) return;
	await activateRecord(record);
	void announceOrderToAdmins(record._id);
}

async function applySubscriptionEvent(
	event: string,
	entity: Record<string, unknown> | undefined,
): Promise<void> {
	const record = await resolveRecordFromEntity(entity);
	if (!record) {
		console.warn(`[billing] Webhook ${event} did not match a local subscription record.`);
		return;
	}

	const status = SUBSCRIPTION_EVENT_STATUS[event];
	if (!status) return;

	const periodStart = unixSecondsToDate(entity?.current_start);
	const periodEnd = unixSecondsToDate(entity?.current_end);
	const now = new Date();

	if (status === "active") {
		await activateRecord(record, { periodStart, periodEnd });
		return;
	}

	await updateBillingSubscriptionFields(record._id, {
		status,
		currentPeriodStart: periodStart ?? record.currentPeriodStart,
		currentPeriodEnd: periodEnd ?? record.currentPeriodEnd,
		cancelAtPeriodEnd: status === "cancelled" ? true : record.cancelAtPeriodEnd,
		updatedAt: now,
	});
}

async function applyRefundEvent(entity: Record<string, unknown> | undefined): Promise<void> {
	const paymentId = readString(entity, "payment_id");
	if (!paymentId) return;

	const record = await resolveRecordFromEntity(entity);
	if (!record) return;

	await recordPayment({
		userId: record.userId,
		subscriptionId: record._id,
		razorpayPaymentId: paymentId,
		razorpayOrderId: record.razorpayOrderId,
		planId: record.planId,
		amount: readNumber(entity, "amount") ?? record.amount,
		currency: readString(entity, "currency") ?? BILLING_CURRENCY,
		status: "refunded",
		method: null,
	});

	await updateBillingSubscriptionFields(record._id, {
		status: "cancelled",
		currentPeriodEnd: new Date(),
		updatedAt: new Date(),
	});
}

export interface WebhookResult {
	event: string;
	handled: boolean;
	duplicate: boolean;
}

/**
 * Processes one webhook delivery. `rawBody` must be the exact bytes Razorpay
 * sent — the signature is an HMAC over them, so re-serialising the parsed JSON
 * would invalidate it.
 */
export async function handleRazorpayWebhook(
	rawBody: string,
	signature: string | null,
	eventId: string | null,
): Promise<WebhookResult> {
	if (!signature) {
		throw new BillingError(400, "Missing X-Razorpay-Signature header.");
	}

	if (!verifyWebhookSignature(rawBody, signature)) {
		throw new BillingError(401, "Invalid webhook signature.");
	}

	let envelope: RazorpayWebhookEnvelope;
	try {
		envelope = JSON.parse(rawBody) as RazorpayWebhookEnvelope;
	} catch {
		throw new BillingError(400, "Webhook body is not valid JSON.");
	}

	const event = typeof envelope.event === "string" ? envelope.event : "";
	if (!event) {
		throw new BillingError(400, "Webhook body has no event name.");
	}

	await getDb();

	// Razorpay retries until it receives a 2xx and can redeliver after success,
	// so every event id is processed at most once.
	const claimKey = eventId ?? `${event}:${Bun.hash(rawBody).toString(16)}`;
	if (!(await claimBillingWebhookEvent(claimKey, event))) {
		return { event, handled: false, duplicate: true };
	}

	// Matched by name rather than by the "payment." prefix: dispute events share
	// that prefix but carry a dispute entity, not a payment one.
	if (PAYMENT_EVENTS.has(event)) {
		await applyPaymentEvent(event, envelope.payload?.payment?.entity);
		return { event, handled: true, duplicate: false };
	}

	if (event === "order.paid") {
		await applyOrderEvent(envelope.payload?.order?.entity ?? envelope.payload?.payment?.entity);
		return { event, handled: true, duplicate: false };
	}

	if (event.startsWith("subscription.")) {
		await applySubscriptionEvent(event, envelope.payload?.subscription?.entity);
		return { event, handled: true, duplicate: false };
	}

	if (event.startsWith("refund.")) {
		await applyRefundEvent(envelope.payload?.refund?.entity);
		return { event, handled: true, duplicate: false };
	}

	// Anything else is acknowledged so Razorpay stops retrying it.
	return { event, handled: false, duplicate: false };
}

/** Exposed for the admin surface: resolves a user's plan without an HTTP round trip. */
export async function getEntitlementPlanId(userId: string): Promise<BillingPlanId> {
	await getDb();
	if (!(await findUserById(userId))) return "lab";
	const active = await findActiveBillingSubscriptionForUser(userId, new Date());
	return active?.planId ?? "lab";
}

const ORDER_LIST_LIMIT = 50;
const ADMIN_ORDER_LIST_LIMIT = 500;

export async function getOrdersForUser(userId: string): Promise<BillingOrdersResponse> {
	await getDb();
	const records = await listBillingSubscriptionsForUser(userId, ORDER_LIST_LIMIT);
	return { orders: records.map(toBillingSubscription) };
}

export async function getAdminOrders(): Promise<AdminBillingOrdersResponse> {
	await getDb();
	const rows = await listAllBillingSubscriptionsWithOwner(ADMIN_ORDER_LIST_LIMIT);
	const totals = await getBillingTotals(new Date());

	return {
		orders: rows.map((row) => ({
			...toBillingSubscription(row.subscription),
			userId: row.subscription.userId,
			userEmail: row.userEmail,
			userFullName: row.userFullName,
			paymentCount: row.paymentCount,
		})),
		stats: {
			totalOrders: totals.totalOrders,
			activeOrders: totals.activeOrders,
			capturedRevenue: totals.capturedRevenue,
			currency: BILLING_CURRENCY,
		},
	};
}

export function parseAdminUpdateOrderPayload(payload: unknown): AdminUpdateOrderPayload {
	if (!payload || typeof payload !== "object") {
		throw new BillingError(400, "Invalid order update payload.");
	}

	const body = payload as Record<string, unknown>;
	const patch: AdminUpdateOrderPayload = {};

	if (body.status !== undefined) {
		if (
			typeof body.status !== "string" ||
			!(BILLING_SUBSCRIPTION_STATUSES as readonly string[]).includes(body.status)
		) {
			throw new BillingError(
				400,
				`status must be one of: ${BILLING_SUBSCRIPTION_STATUSES.join(", ")}.`,
			);
		}
		patch.status = body.status as BillingSubscriptionStatus;
	}

	if (body.currentPeriodEnd !== undefined) {
		if (body.currentPeriodEnd === null) {
			patch.currentPeriodEnd = null;
		} else {
			const parsed = new Date(String(body.currentPeriodEnd));
			if (Number.isNaN(parsed.getTime())) {
				throw new BillingError(400, "currentPeriodEnd is not a valid date.");
			}
			patch.currentPeriodEnd = parsed.toISOString();
		}
	}

	if (body.cancelAtPeriodEnd !== undefined) {
		patch.cancelAtPeriodEnd = Boolean(body.cancelAtPeriodEnd);
	}

	if (body.quantity !== undefined) {
		const quantity = Number(body.quantity);
		if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
			throw new BillingError(400, "quantity must be a whole number between 1 and 1000.");
		}
		patch.quantity = quantity;
	}

	if (body.notes !== undefined) {
		const notes = String(body.notes);
		if (notes.length > SUBSCRIPTION_NOTES_MAX_LENGTH) {
			throw new BillingError(
				400,
				`notes must be ${SUBSCRIPTION_NOTES_MAX_LENGTH} characters or fewer.`,
			);
		}
		patch.notes = notes;
	}

	if (Object.keys(patch).length === 0) {
		throw new BillingError(400, "No supported fields to update.");
	}

	return patch;
}

/**
 * Applies an admin correction to one order. The amount is intentionally not
 * editable — it records what Razorpay actually captured, so letting it be
 * rewritten would desync the local ledger from the payment provider.
 */
export async function adminUpdateOrder(
	orderId: string,
	patch: AdminUpdateOrderPayload,
): Promise<AdminBillingOrdersResponse> {
	await getDb();
	const record = await findBillingSubscriptionById(orderId);
	if (!record) {
		throw new BillingError(404, "Order not found.");
	}

	await updateBillingSubscriptionFields(record._id, {
		status: patch.status,
		quantity: patch.quantity,
		notes: patch.notes,
		cancelAtPeriodEnd: patch.cancelAtPeriodEnd,
		currentPeriodEnd:
			patch.currentPeriodEnd === undefined
				? undefined
				: patch.currentPeriodEnd === null
					? null
					: new Date(patch.currentPeriodEnd),
		updatedAt: new Date(),
	});

	return getAdminOrders();
}

function escapeTelegramHtml(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * Announces a paid order to the Telegram admins. Guarded by a one-shot claim on
 * the record, because the browser verify call and the Razorpay webhook both
 * activate the same order and would otherwise each send a message.
 */
export async function announceOrderToAdmins(subscriptionId: string): Promise<void> {
	await getDb();
	const record = await findBillingSubscriptionById(subscriptionId);
	if (!record) return;

	if (!(await claimOrderAdminNotification(record._id))) return;

	const user = await findUserById(record.userId);
	const lines = [
		"<b>New order paid</b>",
		"",
		`<b>Plan:</b> ${escapeTelegramHtml(record.planName)} × ${record.quantity} (${record.cycle})`,
		`<b>Amount:</b> ${escapeTelegramHtml(formatInr(record.amount))}`,
		`<b>Customer:</b> ${escapeTelegramHtml(user?.fullName ?? "Unknown")} &lt;${escapeTelegramHtml(user?.email ?? "unknown")}&gt;`,
		...(user?.company ? [`<b>Company:</b> ${escapeTelegramHtml(user.company)}`] : []),
		...(record.razorpayOrderId
			? [`<b>Order:</b> <code>${escapeTelegramHtml(record.razorpayOrderId)}</code>`]
			: []),
		...(record.razorpayPaymentId
			? [`<b>Payment:</b> <code>${escapeTelegramHtml(record.razorpayPaymentId)}</code>`]
			: []),
		...(record.currentPeriodEnd
			? [`<b>Term ends:</b> ${escapeTelegramHtml(record.currentPeriodEnd.toDateString())}`]
			: []),
	];

	try {
		const { notifyTelegramAdmins } = await import("./telegram-bot");
		const delivered = await notifyTelegramAdmins(lines.join("\n"));
		console.log(`[billing] Order ${record._id} announced to ${delivered} Telegram admin(s).`);
	} catch (error) {
		// A notification failure must never roll back a payment that succeeded.
		console.error("[billing] Failed to announce order to Telegram admins:", error);
	}
}

/** Announces a credited wallet top-up to the Telegram admins. */
export async function announceTopupToAdmins(params: {
	userId: string;
	amount: number;
	razorpayPaymentId: string;
	balanceAfter: number;
}): Promise<void> {
	await getDb();
	const user = await findUserById(params.userId);
	const lines = [
		"<b>Wallet topped up</b>",
		"",
		`<b>Amount:</b> ${escapeTelegramHtml(formatInr(params.amount))}`,
		`<b>New balance:</b> ${escapeTelegramHtml(formatInr(params.balanceAfter))}`,
		`<b>Customer:</b> ${escapeTelegramHtml(user?.fullName ?? "Unknown")} &lt;${escapeTelegramHtml(user?.email ?? "unknown")}&gt;`,
		`<b>Payment:</b> <code>${escapeTelegramHtml(params.razorpayPaymentId)}</code>`,
	];

	try {
		const { notifyTelegramAdmins } = await import("./telegram-bot");
		await notifyTelegramAdmins(lines.join("\n"));
	} catch (error) {
		console.error("[billing] Failed to announce top-up to Telegram admins:", error);
	}
}

interface AdminRenewalAlertParams {
	userId: string;
	planName: string;
	quantity: number;
	cycle: string;
	amount: number;
	balanceAfter: number;
	periodEnd: Date | null;
}

async function describeCustomer(userId: string): Promise<string> {
	const user = await findUserById(userId);
	return `${escapeTelegramHtml(user?.fullName ?? "Unknown")} &lt;${escapeTelegramHtml(
		user?.email ?? "unknown",
	)}&gt;`;
}

async function sendAdminAlert(lines: string[]): Promise<void> {
	try {
		const { notifyTelegramAdmins } = await import("./telegram-bot");
		await notifyTelegramAdmins(lines.join("\n"));
	} catch (error) {
		console.error("[billing] Failed to send Telegram admin alert:", error);
	}
}

/** A renewal that was successfully debited from the customer's wallet. */
export async function announceRenewalToAdmins(params: AdminRenewalAlertParams): Promise<void> {
	await getDb();
	await sendAdminAlert([
		"<b>Renewal charged to wallet</b>",
		"",
		`<b>Plan:</b> ${escapeTelegramHtml(params.planName)} × ${params.quantity} (${escapeTelegramHtml(params.cycle)})`,
		`<b>Charged:</b> ${escapeTelegramHtml(formatInr(params.amount))}`,
		`<b>Wallet left:</b> ${escapeTelegramHtml(formatInr(params.balanceAfter))}`,
		`<b>Customer:</b> ${await describeCustomer(params.userId)}`,
		...(params.periodEnd
			? [`<b>Next renewal:</b> ${escapeTelegramHtml(params.periodEnd.toDateString())}`]
			: []),
	]);
}

/** A renewal that could not be taken, so the subscription was halted. */
export async function announceRenewalFailedToAdmins(params: {
	userId: string;
	planName: string;
	amount: number;
	balance: number;
	reason: string;
}): Promise<void> {
	await getDb();
	await sendAdminAlert([
		"<b>⚠️ Renewal failed - plan halted</b>",
		"",
		`<b>Plan:</b> ${escapeTelegramHtml(params.planName)}`,
		`<b>Needed:</b> ${escapeTelegramHtml(formatInr(params.amount))}`,
		`<b>Wallet balance:</b> ${escapeTelegramHtml(formatInr(params.balance))}`,
		`<b>Reason:</b> ${escapeTelegramHtml(params.reason)}`,
		`<b>Customer:</b> ${await describeCustomer(params.userId)}`,
	]);
}

/**
 * A customer inside the renewal window whose wallet will not cover the charge.
 * Fired from the same once-per-period path as the customer's own warning, so
 * admins get one heads-up per term rather than one per sweep.
 */
export async function announceLowBalanceToAdmins(params: {
	userId: string;
	planName: string;
	amount: number;
	balance: number;
	shortfall: number;
	daysRemaining: number;
	paymentMode: string;
	autoRenew: boolean;
}): Promise<void> {
	await getDb();
	const cause =
		params.paymentMode !== "wallet" || !params.autoRenew
			? "on manual checkout, so nothing will be taken automatically"
			: `short by ${formatInr(params.shortfall)}`;

	await sendAdminAlert([
		"<b>⚠️ Low wallet before renewal</b>",
		"",
		`<b>Plan:</b> ${escapeTelegramHtml(params.planName)}`,
		`<b>Renews in:</b> ${params.daysRemaining} day${params.daysRemaining === 1 ? "" : "s"}`,
		`<b>Needed:</b> ${escapeTelegramHtml(formatInr(params.amount))}`,
		`<b>Wallet balance:</b> ${escapeTelegramHtml(formatInr(params.balance))}`,
		`<b>Status:</b> ${escapeTelegramHtml(cause)}`,
		`<b>Customer:</b> ${await describeCustomer(params.userId)}`,
	]);
}

const MAX_GRANT_MONTHS = 60;

export function parseAdminCreateSubscriptionPayload(
	payload: unknown,
): AdminCreateSubscriptionPayload {
	if (!payload || typeof payload !== "object") {
		throw new BillingError(400, "Invalid subscription payload.");
	}

	const body = payload as Record<string, unknown>;
	const userId = typeof body.userId === "string" ? body.userId.trim() : "";
	if (!userId) throw new BillingError(400, "userId is required.");

	const plan = findBillingPlan(typeof body.planId === "string" ? body.planId.trim() : "");
	if (!plan) throw new BillingError(400, "Unknown plan.");

	if (!isBillingCycle(body.cycle)) {
		throw new BillingError(400, "cycle must be either 'monthly' or 'annual'.");
	}

	const quantity = Number(body.quantity ?? plan.minQuantity);
	if (!Number.isInteger(quantity) || quantity < 1 || quantity > plan.maxQuantity) {
		throw new BillingError(
			400,
			`quantity must be a whole number between 1 and ${plan.maxQuantity} for the ${plan.name} plan.`,
		);
	}

	const notes = typeof body.notes === "string" ? body.notes.trim() : "";
	if (notes.length > SUBSCRIPTION_NOTES_MAX_LENGTH) {
		throw new BillingError(
			400,
			`notes must be ${SUBSCRIPTION_NOTES_MAX_LENGTH} characters or fewer.`,
		);
	}

	let months = BILLING_CYCLE_MONTHS[body.cycle];
	if (body.months !== undefined) {
		const requested = Number(body.months);
		if (!Number.isInteger(requested) || requested < 1 || requested > MAX_GRANT_MONTHS) {
			throw new BillingError(
				400,
				`months must be a whole number between 1 and ${MAX_GRANT_MONTHS}.`,
			);
		}
		months = requested;
	}

	return { userId, planId: plan.id, cycle: body.cycle, quantity, notes, months };
}

/**
 * Grants a plan to an existing account without taking a payment — the comped,
 * manually-invoiced or support path. The record is created already active with
 * its own private id and no Razorpay order behind it, so wallet renewals and
 * revenue reporting treat it like any other term.
 */
export async function adminCreateSubscription(
	payload: AdminCreateSubscriptionPayload,
	grantedBy: string,
): Promise<AdminBillingOrdersResponse> {
	await getDb();

	const user = await findUserById(payload.userId);
	if (!user) throw new BillingError(404, "That account no longer exists.");

	const plan = findBillingPlan(payload.planId);
	if (!plan) throw new BillingError(400, "Unknown plan.");

	const months = payload.months ?? BILLING_CYCLE_MONTHS[payload.cycle];
	const breakdown = calculateBillingAmount(plan, payload.cycle, payload.quantity, getTaxPercent());
	const now = new Date();
	const periodEnd = new Date(now.getTime());
	periodEnd.setMonth(periodEnd.getMonth() + months);

	const record: BillingSubscriptionDocument = {
		_id: createUuidV7(),
		userId: payload.userId,
		planId: plan.id,
		planName: plan.name,
		cycle: payload.cycle,
		quantity: payload.quantity,
		mode: "order",
		status: "active",
		amount: breakdown.total,
		currency: breakdown.currency,
		razorpayOrderId: null,
		razorpaySubscriptionId: null,
		razorpayPaymentId: null,
		shortUrl: null,
		currentPeriodStart: now,
		currentPeriodEnd: periodEnd,
		cancelAtPeriodEnd: false,
		privateId: generateSubscriptionPrivateId(),
		notes:
			payload.notes ||
			`Granted by ${grantedBy} on ${now.toISOString().slice(0, 10)} (${months} month${months === 1 ? "" : "s"}, no payment taken).`,
		renewalWarningSentFor: null,
		createdAt: now,
		updatedAt: now,
	};

	await insertBillingSubscription(record);
	console.log(
		`[billing] ${grantedBy} granted ${plan.name} (${record.privateId}) to ${user.email}.`,
	);

	return getAdminOrders();
}

/** Removes a subscription entirely. Payment rows are kept and detached. */
export async function adminDeleteSubscription(
	subscriptionId: string,
	deletedBy: string,
): Promise<AdminBillingOrdersResponse> {
	await getDb();
	const record = await findBillingSubscriptionById(subscriptionId);
	if (!record) throw new BillingError(404, "Subscription not found.");

	if (!(await deleteBillingSubscriptionById(subscriptionId))) {
		throw new BillingError(500, "Subscription could not be deleted.");
	}

	console.log(`[billing] ${deletedBy} deleted subscription ${record.privateId}.`);
	return getAdminOrders();
}
