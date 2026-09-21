import type { ClientSession } from "mongodb";
import {
	BILLING_CURRENCY,
	DEFAULT_WALLET_AUTO_RENEW,
	DEFAULT_WALLET_PAYMENT_MODE,
	type WalletPaymentMode,
	type WalletTransactionType,
} from "../../../shared/billing";
import { collection, retryOnDuplicateKey, withTransaction } from "./client";
import { COLLECTIONS } from "./schema";
import type { WalletDocument, WalletTopupDocument, WalletTransactionDocument } from "./types";

// A wallet is stored under `_id` = the user id, so an account can never own two.
type WalletStored = Omit<WalletDocument, "userId"> & { _id: string };

const wallets = () => collection<WalletStored>(COLLECTIONS.walletAccounts);
const transactions = () => collection<WalletTransactionDocument>(COLLECTIONS.walletTransactions);
const topups = () => collection<WalletTopupDocument>(COLLECTIONS.walletTopups);

function toWallet({ _id, ...rest }: WalletStored): WalletDocument {
	return { userId: _id, ...rest };
}

/**
 * Returns the user's wallet, creating it on first touch. Every account has a
 * wallet, defaulting to auto-renew from balance — that is the product default,
 * and a user changes it from their own billing page.
 */
export async function ensureWallet(userId: string): Promise<WalletDocument> {
	const collectionHandle = await wallets();
	const existing = await collectionHandle.findOne({ _id: userId });
	if (existing) return toWallet(existing);

	const now = new Date();
	await retryOnDuplicateKey(() =>
		collectionHandle.updateOne(
			{ _id: userId },
			{
				$setOnInsert: {
					balance: 0,
					currency: BILLING_CURRENCY,
					autoRenew: DEFAULT_WALLET_AUTO_RENEW,
					paymentMode: DEFAULT_WALLET_PAYMENT_MODE,
					createdAt: now,
					updatedAt: now,
				},
			},
			{ upsert: true },
		),
	);

	const created = await collectionHandle.findOne({ _id: userId });
	if (!created) throw new Error("Wallet could not be created.");
	return toWallet(created);
}

export async function updateWalletPreferences(
	userId: string,
	patch: { autoRenew?: boolean; paymentMode?: WalletPaymentMode },
): Promise<void> {
	const set: Partial<WalletStored> = { updatedAt: new Date() };
	if (patch.autoRenew !== undefined) set.autoRenew = patch.autoRenew;
	if (patch.paymentMode !== undefined) set.paymentMode = patch.paymentMode;
	await (await wallets()).updateOne({ _id: userId }, { $set: set });
}

interface WalletMovement {
	userId: string;
	type: WalletTransactionType;
	amount: number;
	reason: string;
	referenceId: string | null;
	transactionId: string;
}

async function applyWithinSession(
	session: ClientSession,
	params: WalletMovement,
): Promise<WalletTransactionDocument | null> {
	const isCredit = params.type === "credit";
	const now = new Date();
	// The balance condition and the increment are one atomic document update, so
	// two concurrent debits cannot both pass the check and overdraw the wallet.
	const updated = await (await wallets()).findOneAndUpdate(
		isCredit ? { _id: params.userId } : { _id: params.userId, balance: { $gte: params.amount } },
		{ $inc: { balance: isCredit ? params.amount : -params.amount }, $set: { updatedAt: now } },
		{ returnDocument: "after", session },
	);
	if (!updated) return null;

	const entry: WalletTransactionDocument = {
		_id: params.transactionId,
		userId: params.userId,
		type: params.type,
		amount: params.amount,
		balanceAfter: updated.balance,
		reason: params.reason,
		referenceId: params.referenceId,
		createdAt: now,
	};
	await (await transactions()).insertOne(entry, { session });
	return entry;
}

/**
 * Moves money in or out of a wallet and writes the ledger entry in one
 * transaction, so a balance can never drift from its transaction history.
 * Returns null when a debit would overdraw the wallet.
 *
 * Pass `session` to make the movement part of a larger transaction, e.g. so a
 * renewal debit and the subscription extension it pays for commit together.
 */
export async function applyWalletTransaction(
	params: WalletMovement,
	session?: ClientSession,
): Promise<WalletTransactionDocument | null> {
	if (!Number.isFinite(params.amount) || params.amount < 0) {
		throw new Error("Wallet transaction amount must be a non-negative number.");
	}

	// Created outside the transaction: it is idempotent, and keeping an upsert
	// out of the transaction avoids write conflicts between concurrent first touches.
	await ensureWallet(params.userId);

	if (session) return applyWithinSession(session, params);
	return withTransaction((own) => applyWithinSession(own, params));
}

export async function listWalletTransactions(
	userId: string,
	limit: number,
): Promise<WalletTransactionDocument[]> {
	return (await transactions()).find({ userId }).sort({ createdAt: -1 }).limit(limit).toArray();
}

export async function insertWalletTopup(topup: WalletTopupDocument): Promise<void> {
	await (await topups()).insertOne(topup);
}

export async function findWalletTopupById(id: string): Promise<WalletTopupDocument | null> {
	return (await topups()).findOne({ _id: id });
}

export async function findWalletTopupByOrderId(
	orderId: string,
): Promise<WalletTopupDocument | null> {
	return (await topups()).findOne({ razorpayOrderId: orderId });
}

/**
 * Flips a top-up to paid, but only from the `created` state. The return value
 * is the caller's guard against crediting the same top-up twice when the
 * browser callback and the webhook both arrive.
 */
export async function markWalletTopupPaid(id: string, razorpayPaymentId: string): Promise<boolean> {
	const result = await (await topups()).updateOne(
		{ _id: id, status: "created" },
		{ $set: { status: "paid", razorpayPaymentId, updatedAt: new Date() } },
	);
	return result.modifiedCount > 0;
}

/**
 * Marks a top-up paid and credits the wallet in one transaction. Either both
 * happen or neither does, so a top-up can never be recorded as paid without the
 * money arriving. Returns null when the top-up was already settled, which is the
 * signal that the browser callback and the webhook raced and the loser must do nothing.
 */
export async function creditWalletTopup(params: {
	topupId: string;
	userId: string;
	amount: number;
	razorpayPaymentId: string;
	transactionId: string;
}): Promise<WalletTransactionDocument | null> {
	await ensureWallet(params.userId);

	return withTransaction(async (session) => {
		const marked = await (await topups()).updateOne(
			{ _id: params.topupId, status: "created" },
			{
				$set: {
					status: "paid",
					razorpayPaymentId: params.razorpayPaymentId,
					updatedAt: new Date(),
				},
			},
			{ session },
		);
		if (marked.modifiedCount === 0) return null;

		return applyWithinSession(session, {
			userId: params.userId,
			type: "credit",
			amount: params.amount,
			reason: "Wallet top-up",
			referenceId: params.razorpayPaymentId,
			transactionId: params.transactionId,
		});
	});
}

export async function markWalletTopupFailed(id: string): Promise<void> {
	await (await topups()).updateOne(
		{ _id: id, status: "created" },
		{ $set: { status: "failed", updatedAt: new Date() } },
	);
}

export async function deleteWalletDataForUser(userId: string): Promise<void> {
	await (await transactions()).deleteMany({ userId });
	await (await topups()).deleteMany({ userId });
	await (await wallets()).deleteOne({ _id: userId });
}
