import { collection } from "./client";
import { COLLECTIONS } from "./schema";
import type { SessionDocument, WithId } from "./types";

const sessions = () => collection<SessionDocument>(COLLECTIONS.sessions);

export async function insertSession(session: WithId<SessionDocument>): Promise<void> {
	await (await sessions()).insertOne(session);
}

export async function findSessionById(id: string): Promise<WithId<SessionDocument> | null> {
	return (await sessions()).findOne({ _id: id });
}

export async function deleteSessionById(id: string): Promise<void> {
	await (await sessions()).deleteOne({ _id: id });
}

export async function deleteSessionByIdForUser(id: string, userId: string): Promise<boolean> {
	const result = await (await sessions()).deleteOne({ _id: id, userId });
	return result.deletedCount > 0;
}

export async function deleteSessionsByUserId(userId: string): Promise<void> {
	await (await sessions()).deleteMany({ userId });
}

export async function deleteAllSessionsForUser(userId: string): Promise<number> {
	const result = await (await sessions()).deleteMany({ userId });
	return result.deletedCount;
}

export async function deleteExpiredSessionsForUser(userId: string, now: Date): Promise<void> {
	await (await sessions()).deleteMany({ userId, expiresAt: { $lte: now } });
}

export async function countActiveSessionsForDevice(
	userId: string,
	deviceKey: string,
	now: Date,
): Promise<number> {
	return (await sessions()).countDocuments({ userId, deviceKey, expiresAt: { $gt: now } });
}

export async function countActiveSessionsForUser(userId: string, now: Date): Promise<number> {
	return (await sessions()).countDocuments({ userId, expiresAt: { $gt: now } });
}

export async function listActiveSessionsForUser(
	userId: string,
	now: Date,
): Promise<WithId<SessionDocument>[]> {
	return (await sessions())
		.find({ userId, expiresAt: { $gt: now } })
		.sort({ updatedAt: -1 })
		.toArray();
}

export async function touchSession(
	id: string,
	patch: { updatedAt: Date; expiresAt: Date; ipAddress: string; userAgent: string },
): Promise<void> {
	await (await sessions()).updateOne(
		{ _id: id },
		{
			$set: {
				updatedAt: patch.updatedAt,
				expiresAt: patch.expiresAt,
				ipAddress: patch.ipAddress,
				userAgent: patch.userAgent,
			},
		},
	);
}
