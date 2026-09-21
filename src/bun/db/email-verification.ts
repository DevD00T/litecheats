import { collection, retryOnDuplicateKey } from "./client";
import { COLLECTIONS } from "./schema";
import type { EmailVerificationCodeRecord, EmailVerificationRecord } from "./types";

// Both collections are keyed by what they are looked up by (`_id` = token, or
// `_id` = user id), so the "one live code per account" rule is structural.
interface TokenStored {
	_id: string;
	userId: string;
	expiresAt: Date;
	createdAt: Date;
}

interface CodeStored {
	_id: string;
	codeHash: string;
	expiresAt: Date;
	attempts: number;
	lastSentAt: Date;
	createdAt: Date;
}

const tokens = () => collection<TokenStored>(COLLECTIONS.emailVerifications);
const codes = () => collection<CodeStored>(COLLECTIONS.emailVerificationCodes);

export async function insertEmailVerificationToken(
	token: string,
	userId: string,
	expiresAt: Date,
): Promise<void> {
	await (await tokens()).insertOne({ _id: token, userId, expiresAt, createdAt: new Date() });
}

export async function findEmailVerificationToken(
	token: string,
): Promise<EmailVerificationRecord | null> {
	const stored = await (await tokens()).findOne({ _id: token });
	if (!stored) return null;
	return {
		token: stored._id,
		userId: stored.userId,
		expiresAt: stored.expiresAt,
		createdAt: stored.createdAt,
	};
}

export async function deleteEmailVerificationToken(token: string): Promise<void> {
	await (await tokens()).deleteOne({ _id: token });
}

export async function deleteEmailVerificationTokensForUser(userId: string): Promise<void> {
	await (await tokens()).deleteMany({ userId });
}

/** Replaces any live code for this account, so only the newest one works. */
export async function upsertEmailVerificationCode(params: {
	userId: string;
	codeHash: string;
	expiresAt: Date;
}): Promise<void> {
	const now = new Date();
	await retryOnDuplicateKey(async () => {
		await (await codes()).updateOne(
			{ _id: params.userId },
			{
				$set: {
					codeHash: params.codeHash,
					expiresAt: params.expiresAt,
					attempts: 0,
					lastSentAt: now,
				},
				$setOnInsert: { createdAt: now },
			},
			{ upsert: true },
		);
	});
}

export async function findEmailVerificationCode(
	userId: string,
): Promise<EmailVerificationCodeRecord | null> {
	const stored = await (await codes()).findOne({ _id: userId });
	if (!stored) return null;
	return {
		userId: stored._id,
		codeHash: stored.codeHash,
		expiresAt: stored.expiresAt,
		attempts: stored.attempts,
		lastSentAt: stored.lastSentAt,
		createdAt: stored.createdAt,
	};
}

/**
 * Returns the attempt count after incrementing, for lock-out decisions. The
 * increment is atomic, so concurrent guesses cannot slip past the limit.
 */
export async function incrementEmailVerificationAttempts(userId: string): Promise<number> {
	const updated = await (await codes()).findOneAndUpdate(
		{ _id: userId },
		{ $inc: { attempts: 1 } },
		{ returnDocument: "after", projection: { attempts: 1 } },
	);
	return updated?.attempts ?? 0;
}

export async function deleteEmailVerificationCode(userId: string): Promise<void> {
	await (await codes()).deleteOne({ _id: userId });
}
