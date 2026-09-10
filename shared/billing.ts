import { AUTH_ADMIN_BASE_PATH, AUTH_BASE_PATH } from "./auth";

// Billing lives under AUTH_BASE_PATH on purpose: the session cookie is issued
// with `Path=/login`, so any endpoint that needs the signed-in user has to sit
// beneath that prefix or the browser will not attach the cookie.
export const BILLING_BASE_PATH = `${AUTH_BASE_PATH}/billing`;

// Admin billing sits under the existing admin prefix so it inherits the same
// privileged-session guard as user and release administration.
export const BILLING_ADMIN_BASE_PATH = `${AUTH_ADMIN_BASE_PATH}/billing`;

// Razorpay posts webhooks server-to-server with no cookie, so the webhook
// endpoint deliberately sits outside the authenticated prefix.
export const RAZORPAY_WEBHOOK_BASE_PATH = "/api/razorpay";
export const RAZORPAY_WEBHOOK_PATH = `${RAZORPAY_WEBHOOK_BASE_PATH}/webhook`;

export const BILLING_CURRENCY = "INR";

export const BILLING_CYCLES = ["monthly", "annual"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const BILLING_CYCLE_MONTHS: Record<BillingCycle, number> = {
	monthly: 1,
	annual: 12,
};

export const BILLING_PLAN_IDS = [
	"lab",
	"operator",
	"institution",
	"enterprise",
	"sovereign",
] as const;
export type BillingPlanId = (typeof BILLING_PLAN_IDS)[number];

/**
 * How a plan is acquired:
 * - `free`     no payment, the account simply has the entitlement.
 * - `checkout` self-serve Razorpay checkout.
 * - `contact`  quoted manually by sales, never charged through checkout.
 */
export type BillingPlanKind = "free" | "checkout" | "contact";

export interface BillingPlan {
	id: BillingPlanId;
	name: string;
	kind: BillingPlanKind;
	/** Price per vehicle per month, in paise. `0` for free and contact-only plans. */
	unitAmountPerMonth: number;
	minQuantity: number;
	maxQuantity: number;
	description: string;
}

export const BILLING_PLANS: readonly BillingPlan[] = [
	{
		id: "lab",
		name: "Lab",
		kind: "free",
		unitAmountPerMonth: 0,
		minQuantity: 1,
		maxQuantity: 2,
		description: "Single research group getting a first vehicle online.",
	},
	{
		id: "operator",
		name: "Operator",
		kind: "checkout",
		unitAmountPerMonth: 99_900,
		minQuantity: 1,
		maxQuantity: 10,
		description: "Solo pilots and small commercial crews running a handful of airframes.",
	},
	{
		id: "institution",
		name: "Institution",
		kind: "checkout",
		unitAmountPerMonth: 490_000,
		minQuantity: 1,
		maxQuantity: 100,
		description: "A department or university flying a mixed fleet weekly.",
	},
	{
		id: "enterprise",
		name: "Enterprise",
		kind: "checkout",
		unitAmountPerMonth: 940_000,
		minQuantity: 25,
		maxQuantity: 500,
		description: "Commercial operators and agencies with SLA obligations.",
	},
	{
		id: "sovereign",
		name: "Sovereign",
		kind: "contact",
		unitAmountPerMonth: 0,
		minQuantity: 1,
		maxQuantity: 1,
		description: "Defence and critical-infrastructure deployments.",
	},
];

export function findBillingPlan(planId: string): BillingPlan | null {
	return BILLING_PLANS.find((plan) => plan.id === planId) ?? null;
}

export function isBillingCycle(value: unknown): value is BillingCycle {
	return typeof value === "string" && (BILLING_CYCLES as readonly string[]).includes(value);
}

export interface BillingAmountBreakdown {
	/** Price per vehicle per month, in paise. */
	unitAmountPerMonth: number;
	quantity: number;
	months: number;
	/** quantity * unitAmountPerMonth * months, in paise. */
	subtotal: number;
	taxPercent: number;
	taxAmount: number;
	/** subtotal + taxAmount, in paise. This is what Razorpay is asked to collect. */
	total: number;
	currency: string;
}

/**
 * Single source of truth for what a plan costs. The server recomputes this for
 * every checkout so a tampered client payload can never change the amount —
 * the client only ever chooses a plan id, a cycle and a vehicle count.
 */
export function calculateBillingAmount(
	plan: BillingPlan,
	cycle: BillingCycle,
	quantity: number,
	taxPercent: number,
): BillingAmountBreakdown {
	const months = BILLING_CYCLE_MONTHS[cycle];
	const subtotal = plan.unitAmountPerMonth * quantity * months;
	// Round half-up on the paise, so the total is always a whole paise value.
	const taxAmount = Math.round((subtotal * taxPercent) / 100);

	return {
		unitAmountPerMonth: plan.unitAmountPerMonth,
		quantity,
		months,
		subtotal,
		taxPercent,
		taxAmount,
		total: subtotal + taxAmount,
		currency: BILLING_CURRENCY,
	};
}

export function formatInr(paise: number): string {
	return new Intl.NumberFormat("en-IN", {
		style: "currency",
		currency: BILLING_CURRENCY,
		maximumFractionDigits: paise % 100 === 0 ? 0 : 2,
	}).format(paise / 100);
}

export const BILLING_SUBSCRIPTION_STATUSES = [
	"created",
	"pending",
	"active",
	// `paused` is an admin action; `halted` is what a failed renewal produces.
	// Keeping them apart means an operator can tell a deliberate suspension from
	// a payment problem at a glance.
	"paused",
	"halted",
	"cancelled",
	"expired",
	"failed",
] as const;

export type BillingSubscriptionStatus = (typeof BILLING_SUBSCRIPTION_STATUSES)[number];

/** `order` is a prepaid term; `subscription` is a Razorpay auto-recurring mandate. */
export type BillingMode = "order" | "subscription";

export interface BillingSubscription {
	id: string;
	/**
	 * Short, human-quotable identifier for this subscription (e.g. LC-SUB-7QK3M2AD).
	 * Every subscription gets one at creation, whether it came from a customer
	 * checkout or an admin grant, so support can refer to it in conversation
	 * without exposing the internal UUID.
	 */
	privateId: string;
	/** Free-text operator notes, shown wherever the subscription is shown. */
	notes: string;
	planId: BillingPlanId;
	planName: string;
	cycle: BillingCycle;
	quantity: number;
	mode: BillingMode;
	status: BillingSubscriptionStatus;
	amount: number;
	currency: string;
	currentPeriodStart: string | null;
	currentPeriodEnd: string | null;
	cancelAtPeriodEnd: boolean;
	razorpayOrderId: string | null;
	razorpaySubscriptionId: string | null;
	razorpayPaymentId: string | null;
	shortUrl: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface BillingPlanQuote extends BillingPlan {
	/** Amount for one vehicle on each cycle, so the UI can render prices without maths. */
	pricing: Record<BillingCycle, BillingAmountBreakdown>;
}

export interface BillingPlansResponse {
	/** False when Razorpay keys are missing; the UI then hides checkout buttons. */
	configured: boolean;
	/** Publishable Razorpay key id, safe to expose to the browser. */
	keyId: string | null;
	taxPercent: number;
	currency: string;
	plans: BillingPlanQuote[];
}

export interface CreateCheckoutPayload {
	planId: BillingPlanId;
	cycle: BillingCycle;
	quantity: number;
}

export interface CreateCheckoutResponse {
	mode: BillingMode;
	keyId: string;
	/** Present when `mode === "order"`. */
	orderId: string | null;
	/** Present when `mode === "subscription"`. */
	subscriptionId: string | null;
	amount: number;
	currency: string;
	breakdown: BillingAmountBreakdown;
	planId: BillingPlanId;
	planName: string;
	cycle: BillingCycle;
	quantity: number;
	/** Local record id, echoed back on verify to tie the payment to this attempt. */
	subscriptionRecordId: string;
	prefill: {
		name: string;
		email: string;
	};
}

export interface VerifyCheckoutPayload {
	subscriptionRecordId: string;
	razorpayPaymentId: string;
	razorpayOrderId?: string;
	razorpaySubscriptionId?: string;
	razorpaySignature: string;
}

export interface BillingSubscriptionResponse {
	subscription: BillingSubscription | null;
}

export interface CancelSubscriptionPayload {
	subscriptionId: string;
	/** Default true; a false value cancels immediately and forfeits the paid term. */
	atPeriodEnd?: boolean;
}

export interface BillingPaymentSummary {
	id: string;
	razorpayPaymentId: string | null;
	razorpayOrderId: string | null;
	amount: number;
	currency: string;
	status: string;
	method: string | null;
	planId: string;
	createdAt: string;
}

export interface BillingHistoryResponse {
	payments: BillingPaymentSummary[];
}

/** Every checkout the signed-in user has started, newest first. */
export interface BillingOrdersResponse {
	orders: BillingSubscription[];
}

/** An order as an admin sees it — the same record plus who it belongs to. */
export interface AdminBillingOrder extends BillingSubscription {
	userId: string;
	userEmail: string;
	userFullName: string;
	paymentCount: number;
}

export interface AdminBillingStats {
	totalOrders: number;
	activeOrders: number;
	/** Sum of captured payments, in paise. */
	capturedRevenue: number;
	currency: string;
}

export interface AdminBillingOrdersResponse {
	orders: AdminBillingOrder[];
	stats: AdminBillingStats;
}

/**
 * Admin-side corrections. Deliberately narrow: an admin can move an order
 * between lifecycle states and adjust the term it entitles, but cannot rewrite
 * the amount — that is whatever Razorpay actually captured.
 */
export interface AdminUpdateOrderPayload {
	status?: BillingSubscriptionStatus;
	currentPeriodEnd?: string | null;
	cancelAtPeriodEnd?: boolean;
	quantity?: number;
	notes?: string;
}

export const SUBSCRIPTION_NOTES_MAX_LENGTH = 2000;

/**
 * An admin granting a plan to an existing account. No money changes hands —
 * this is the comped / manually-invoiced / support path — so the record is
 * created already active with a fresh private id and no Razorpay order behind
 * it. `amount` is still recorded from the catalogue so revenue reporting and
 * wallet renewals treat it like any other term.
 */
export interface AdminCreateSubscriptionPayload {
	userId: string;
	planId: BillingPlanId;
	cycle: BillingCycle;
	quantity: number;
	notes?: string;
	/** Months to grant; defaults to the cycle length. */
	months?: number;
}

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

/** Term length in days, used for customer-facing copy like "365-day term". */
export const BILLING_CYCLE_DAYS: Record<BillingCycle, number> = {
	monthly: 30,
	annual: 365,
};

/** How far ahead of a renewal the customer is told to top up or switch modes. */
export const RENEWAL_WARNING_DAYS = 10;

export const WALLET_MIN_TOPUP_PAISE = 10_000;
export const WALLET_MAX_TOPUP_PAISE = 100_000_000;

/**
 * How a renewal is paid for.
 * - `wallet`   debited automatically from the prepaid balance. The default.
 * - `checkout` the customer pays each term manually through Razorpay checkout.
 */
export const WALLET_PAYMENT_MODES = ["wallet", "checkout"] as const;
export type WalletPaymentMode = (typeof WALLET_PAYMENT_MODES)[number];

export const DEFAULT_WALLET_PAYMENT_MODE: WalletPaymentMode = "wallet";
export const DEFAULT_WALLET_AUTO_RENEW = true;

export type WalletTransactionType = "credit" | "debit";

export interface WalletSummary {
	balance: number;
	currency: string;
	autoRenew: boolean;
	paymentMode: WalletPaymentMode;
	updatedAt: string;
}

export interface WalletTransaction {
	id: string;
	type: WalletTransactionType;
	amount: number;
	balanceAfter: number;
	reason: string;
	referenceId: string | null;
	createdAt: string;
}

export interface WalletResponse {
	wallet: WalletSummary;
	transactions: WalletTransaction[];
}

export interface WalletTopupPayload {
	amount: number;
}

export interface WalletTopupResponse {
	topupId: string;
	orderId: string;
	amount: number;
	currency: string;
	keyId: string;
	prefill: { name: string; email: string };
}

export interface VerifyWalletTopupPayload {
	topupId: string;
	razorpayPaymentId: string;
	razorpayOrderId: string;
	razorpaySignature: string;
}

export interface UpdateWalletPreferencesPayload {
	autoRenew?: boolean;
	paymentMode?: WalletPaymentMode;
}

export function isWalletPaymentMode(value: unknown): value is WalletPaymentMode {
	return typeof value === "string" && (WALLET_PAYMENT_MODES as readonly string[]).includes(value);
}

/**
 * What the customer is told ahead of a renewal. `shortfall` is how much more
 * the wallet needs for the renewal to go through automatically; zero means the
 * balance already covers it.
 */
export interface RenewalNotice {
	subscriptionId: string;
	planName: string;
	renewsAt: string;
	daysRemaining: number;
	amountDue: number;
	walletBalance: number;
	shortfall: number;
	paymentMode: WalletPaymentMode;
	autoRenew: boolean;
	/** True when the renewal will succeed without the customer doing anything. */
	willAutoRenew: boolean;
	currency: string;
}

export function daysUntil(iso: string, now: Date = new Date()): number {
	const target = new Date(iso).getTime();
	if (Number.isNaN(target)) return Number.POSITIVE_INFINITY;
	return Math.ceil((target - now.getTime()) / (24 * 60 * 60 * 1000));
}
