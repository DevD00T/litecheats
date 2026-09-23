import type { WhatsAppOtpPurpose } from "../../../shared/auth";
import { collection, retryOnDuplicateKey } from "./client";
import { COLLECTIONS } from "./schema";
import type { WhatsAppOtpChallengeRecord } from "./types";

// Keyed by the phone number, so "one live code per number" is structural and a
// resend for login cannot leave a stale signup challenge behind, or vice versa.
interface ChallengeStored {
	_id: string;
	purpose: WhatsAppOtpPurpose;
	userId?: string | null;
	attempts: number;
	lastSentAt: Date;
	expiresAt: Date;
	createdAt: Date;
}

const challenges = () => collection<ChallengeStored>(COLLECTIONS.whatsappOtpChallenges);

function toRecord(stored: ChallengeStored): WhatsAppOtpChallengeRecord {
	return {
		phone: stored._id,
		purpose: stored.purpose,
		userId: stored.userId ?? null,
		attempts: stored.attempts,
		lastSentAt: stored.lastSentAt,
		expiresAt: stored.expiresAt,
		createdAt: stored.createdAt,
	};
}

/** Records a fresh send, replacing any earlier challenge for this number. */
export async function upsertWhatsAppOtpChallenge(params: {
	phone: string;
	purpose: WhatsAppOtpPurpose;
	/** Binds a link code to the signed-in account that asked for it. */
	userId?: string | null;
	expiresAt: Date;
}): Promise<void> {
	const now = new Date();
	await retryOnDuplicateKey(async () => {
		await (await challenges()).updateOne(
			{ _id: params.phone },
			{
				$set: {
					purpose: params.purpose,
					userId: params.userId ?? null,
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

export async function findWhatsAppOtpChallenge(
	phone: string,
): Promise<WhatsAppOtpChallengeRecord | null> {
	const stored = await (await challenges()).findOne({ _id: phone });
	return stored ? toRecord(stored) : null;
}

/**
 * Spends one guess, but only while fewer than `maxAttempts` have been spent.
 * Returns the challenge after the increment, or null when there was no guess
 * left to spend. Claiming the guess before asking the provider, atomically,
 * means concurrent requests cannot fire more than `maxAttempts` checks.
 */
export async function claimWhatsAppOtpAttempt(
	phone: string,
	maxAttempts: number,
): Promise<WhatsAppOtpChallengeRecord | null> {
	const updated = await (await challenges()).findOneAndUpdate(
		{ _id: phone, attempts: { $lt: maxAttempts } },
		{ $inc: { attempts: 1 } },
		{ returnDocument: "after" },
	);
	return updated ? toRecord(updated) : null;
}

/** Gives a guess back, for when the provider could not be reached to judge it. */
export async function releaseWhatsAppOtpAttempt(phone: string): Promise<void> {
	await (await challenges()).updateOne(
		{ _id: phone, attempts: { $gt: 0 } },
		{ $inc: { attempts: -1 } },
	);
}

export async function deleteWhatsAppOtpChallenge(phone: string): Promise<void> {
	await (await challenges()).deleteOne({ _id: phone });
}
