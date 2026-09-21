import type { ClientSession } from "mongodb";
import {
	collection,
	isUniqueConstraintError,
	retryOnDuplicateKey,
	withTransaction,
} from "./client";
import { COLLECTIONS } from "./schema";
import type {
	BillingPaymentDocument,
	BillingSubscriptionDocument,
	BillingSubscriptionWithOwner,
	BillingTotals,
	UserDocument,
	WithId,
} from "./types";

const subscriptions = () =>
	collection<BillingSubscriptionDocument>(COLLECTIONS.billingSubscriptions);
const payments = () => collection<BillingPaymentDocument>(COLLECTIONS.billingPayments);
const webhookEvents = () =>
	collection<{ _id: string; event: string; receivedAt: Date }>(COLLECTIONS.billingWebhookEvents);

const PRIVATE_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Short, unambiguous identifier a human can read aloud. The alphabet omits
 * O/0 and I/1 so a support agent and a customer cannot transcribe it wrongly.
 */
export function generateSubscriptionPrivateId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(8));
	let suffix = "";
	for (const byte of bytes) {
		suffix += PRIVATE_ID_ALPHABET[byte % PRIVATE_ID_ALPHABET.length];
	}
	return `LC-SUB-${suffix}`;
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export async function insertBillingSubscription(
	subscription: WithId<BillingSubscriptionDocument>,
): Promise<void> {
	await (await subscriptions()).insertOne({
		...subscription,
		adminNotifiedAt: subscription.adminNotifiedAt ?? null,
	});
}

export async function findBillingSubscriptionById(
	id: string,
): Promise<WithId<BillingSubscriptionDocument> | null> {
	return (await subscriptions()).findOne({ _id: id });
}

export async function findBillingSubscriptionByOrderId(
	orderId: string,
): Promise<WithId<BillingSubscriptionDocument> | null> {
	return (await subscriptions()).findOne({ razorpayOrderId: orderId });
}

export async function findBillingSubscriptionByRazorpayId(
	razorpaySubscriptionId: string,
): Promise<WithId<BillingSubscriptionDocument> | null> {
	return (await subscriptions()).findOne({ razorpaySubscriptionId });
}

export async function findBillingSubscriptionByPrivateId(
	privateId: string,
): Promise<WithId<BillingSubscriptionDocument> | null> {
	return (await subscriptions()).findOne({ privateId });
}

/**
 * The subscription a user is entitled to right now: an active term that has not
 * lapsed, most recently created first. Null when the user has never paid or
 * every term has expired.
 */
export async function findActiveBillingSubscriptionForUser(
	userId: string,
	now: Date,
): Promise<WithId<BillingSubscriptionDocument> | null> {
	return (await subscriptions()).findOne(
		{
			userId,
			status: { $in: ["active", "halted"] },
			$or: [{ currentPeriodEnd: null }, { currentPeriodEnd: { $gt: now } }],
		},
		{ sort: { createdAt: -1 } },
	);
}

export async function findLatestBillingSubscriptionForUser(
	userId: string,
): Promise<WithId<BillingSubscriptionDocument> | null> {
	return (await subscriptions()).findOne({ userId }, { sort: { createdAt: -1 } });
}

export async function listBillingSubscriptionsForUser(
	userId: string,
	limit: number,
): Promise<WithId<BillingSubscriptionDocument>[]> {
	return (await subscriptions()).find({ userId }).sort({ createdAt: -1 }).limit(limit).toArray();
}

export async function updateBillingSubscriptionFields(
	id: string,
	patch: Partial<BillingSubscriptionDocument>,
	session?: ClientSession,
): Promise<void> {
	const set: Partial<BillingSubscriptionDocument> = {};
	if (patch.status !== undefined) set.status = patch.status;
	if (patch.quantity !== undefined) set.quantity = patch.quantity;
	if (patch.amount !== undefined) set.amount = patch.amount;
	if (patch.razorpayOrderId !== undefined) set.razorpayOrderId = patch.razorpayOrderId;
	if (patch.razorpaySubscriptionId !== undefined) {
		set.razorpaySubscriptionId = patch.razorpaySubscriptionId;
	}
	if (patch.razorpayPaymentId !== undefined) set.razorpayPaymentId = patch.razorpayPaymentId;
	if (patch.shortUrl !== undefined) set.shortUrl = patch.shortUrl;
	if (patch.currentPeriodStart !== undefined) set.currentPeriodStart = patch.currentPeriodStart;
	if (patch.currentPeriodEnd !== undefined) set.currentPeriodEnd = patch.currentPeriodEnd;
	if (patch.cancelAtPeriodEnd !== undefined) set.cancelAtPeriodEnd = patch.cancelAtPeriodEnd;
	if (patch.notes !== undefined) set.notes = patch.notes;
	set.updatedAt = patch.updatedAt ?? new Date();

	await (await subscriptions()).updateOne({ _id: id }, { $set: set }, { session });
}

/**
 * Deletes a subscription and detaches the payment rows that reference it.
 * Payments are the record of money that actually moved, so they stay in the
 * ledger even when the subscription is gone. Both steps commit together.
 */
export async function deleteBillingSubscriptionById(id: string): Promise<boolean> {
	return withTransaction(async (session) => {
		await (await payments()).updateMany(
			{ subscriptionId: id },
			{ $set: { subscriptionId: null } },
			{ session },
		);
		const result = await (await subscriptions()).deleteOne({ _id: id }, { session });
		return result.deletedCount > 0;
	});
}

export async function deleteBillingRecordsForUser(userId: string): Promise<void> {
	await (await payments()).deleteMany({ userId });
	await (await subscriptions()).deleteMany({ userId });
}

/** Subscriptions whose paid term has run out and that are due a renewal attempt. */
export async function listSubscriptionsDueForRenewal(
	now: Date,
): Promise<WithId<BillingSubscriptionDocument>[]> {
	return (await subscriptions())
		.find({ status: "active", cancelAtPeriodEnd: false, currentPeriodEnd: { $lte: now } })
		.sort({ currentPeriodEnd: 1 })
		.toArray();
}

/**
 * Active subscriptions renewing inside the warning window that have not been
 * warned for this particular period end yet.
 */
export async function listSubscriptionsNeedingRenewalWarning(
	now: Date,
	windowEnd: Date,
): Promise<WithId<BillingSubscriptionDocument>[]> {
	return (await subscriptions())
		.find({
			status: "active",
			cancelAtPeriodEnd: false,
			currentPeriodEnd: { $gt: now, $lte: windowEnd },
			$expr: { $ne: ["$renewalWarningSentFor", "$currentPeriodEnd"] },
		})
		.sort({ currentPeriodEnd: 1 })
		.toArray();
}

/** Records that the warning for this exact period end has gone out. */
export async function markRenewalWarningSent(
	subscriptionId: string,
	periodEnd: Date,
): Promise<void> {
	await (await subscriptions()).updateOne(
		{ _id: subscriptionId },
		{ $set: { renewalWarningSentFor: periodEnd } },
	);
}

/**
 * Claims the "announced to admins" flag for an order. Returns false when the
 * announcement already went out, so the browser verify call and the webhook
 * cannot both notify for the same order.
 */
export async function claimOrderAdminNotification(subscriptionId: string): Promise<boolean> {
	const result = await (await subscriptions()).updateOne(
		{ _id: subscriptionId, adminNotifiedAt: null },
		{ $set: { adminNotifiedAt: new Date() } },
	);
	return result.modifiedCount > 0;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

/**
 * Records a payment. A Razorpay payment id is the natural key: seeing the same
 * id again (browser callback and webhook both fire) updates the existing row's
 * status and method instead of creating a second one.
 */
export async function insertBillingPayment(payment: WithId<BillingPaymentDocument>): Promise<void> {
	const collectionHandle = await payments();

	if (!payment.razorpayPaymentId) {
		await collectionHandle.insertOne(payment);
		return;
	}

	const set: Partial<BillingPaymentDocument> = {
		status: payment.status,
		method: payment.method,
		updatedAt: payment.updatedAt,
	};
	// An update that does not know the subscription must not erase one we do.
	const setOnInsert: Partial<BillingPaymentDocument> = {
		_id: payment._id,
		userId: payment.userId,
		razorpayOrderId: payment.razorpayOrderId,
		planId: payment.planId,
		amount: payment.amount,
		currency: payment.currency,
		createdAt: payment.createdAt,
	};
	if (payment.subscriptionId) {
		set.subscriptionId = payment.subscriptionId;
	} else {
		setOnInsert.subscriptionId = null;
	}

	await retryOnDuplicateKey(() =>
		collectionHandle.updateOne(
			{ razorpayPaymentId: payment.razorpayPaymentId },
			{ $set: set, $setOnInsert: setOnInsert },
			{ upsert: true },
		),
	);
}

export async function listBillingPaymentsForUser(
	userId: string,
	limit: number,
): Promise<WithId<BillingPaymentDocument>[]> {
	return (await payments()).find({ userId }).sort({ createdAt: -1 }).limit(limit).toArray();
}

export async function countBillingPaymentsForSubscription(subscriptionId: string): Promise<number> {
	return (await payments()).countDocuments({ subscriptionId });
}

// ---------------------------------------------------------------------------
// Webhook idempotency
// ---------------------------------------------------------------------------

/**
 * Claims a webhook event id. Returns false when the event was already
 * processed, which is the signal for the caller to ack and do nothing —
 * Razorpay retries until it gets a 2xx and can redeliver even after success.
 */
export async function claimBillingWebhookEvent(eventId: string, event: string): Promise<boolean> {
	try {
		await (await webhookEvents()).insertOne({ _id: eventId, event, receivedAt: new Date() });
		return true;
	} catch (error) {
		if (isUniqueConstraintError(error)) return false;
		throw error;
	}
}

/** Expiry is handled by a TTL index; this is for an explicit, earlier purge. */
export async function deleteBillingWebhookEventsOlderThan(cutoff: Date): Promise<number> {
	const result = await (await webhookEvents()).deleteMany({ receivedAt: { $lte: cutoff } });
	return result.deletedCount;
}

// ---------------------------------------------------------------------------
// Admin reporting
// ---------------------------------------------------------------------------

/**
 * Every order across all accounts, for the admin console. The owning user is
 * joined in so the console does not have to fetch the user list separately.
 * Orders stay visible even if the account was deleted.
 */
export async function listAllBillingSubscriptionsWithOwner(
	limit: number,
): Promise<BillingSubscriptionWithOwner[]> {
	const rows = await (await subscriptions()).find().sort({ createdAt: -1 }).limit(limit).toArray();
	if (!rows.length) return [];

	const userIds = [...new Set(rows.map((row) => row.userId))];
	const owners = await (await collection<UserDocument>(COLLECTIONS.users))
		.find({ _id: { $in: userIds } }, { projection: { email: 1, fullName: 1 } })
		.toArray();
	const ownerById = new Map(owners.map((owner) => [owner._id, owner]));

	const counts = await (await payments())
		.aggregate<{ _id: string; count: number }>([
			{ $match: { subscriptionId: { $in: rows.map((row) => row._id) } } },
			{ $group: { _id: "$subscriptionId", count: { $sum: 1 } } },
		])
		.toArray();
	const countBySubscription = new Map(counts.map((entry) => [entry._id, entry.count]));

	return rows.map((subscription) => ({
		subscription,
		userEmail: ownerById.get(subscription.userId)?.email ?? "",
		userFullName: ownerById.get(subscription.userId)?.fullName ?? "",
		paymentCount: countBySubscription.get(subscription._id) ?? 0,
	}));
}

export async function getBillingTotals(now: Date): Promise<BillingTotals> {
	const [totalOrders, activeOrders, revenue] = await Promise.all([
		(await subscriptions()).countDocuments({}),
		(await subscriptions()).countDocuments({
			status: "active",
			$or: [{ currentPeriodEnd: null }, { currentPeriodEnd: { $gt: now } }],
		}),
		// Revenue counts captured payments only — authorised, failed and refunded
		// rows are recorded for the audit trail but are not money in the bank.
		(await payments())
			.aggregate<{ _id: null; total: number }>([
				{ $match: { status: "captured" } },
				{ $group: { _id: null, total: { $sum: "$amount" } } },
			])
			.toArray(),
	]);

	return { totalOrders, activeOrders, capturedRevenue: revenue[0]?.total ?? 0 };
}
