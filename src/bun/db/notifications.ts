import { collection } from "./client";
import { COLLECTIONS } from "./schema";
import type {
	NotificationCampaignDocument,
	NotificationDocument,
	NotificationTemplateDocument,
	SessionDocument,
	UserDocument,
	WithId,
} from "./types";

const notifications = () => collection<NotificationDocument>(COLLECTIONS.notifications);
const campaigns = () => collection<NotificationCampaignDocument>(COLLECTIONS.notificationCampaigns);
const templates = () => collection<NotificationTemplateDocument>(COLLECTIONS.notificationTemplates);

// ─── Per-recipient notifications ────────────────────────────────────────────

export async function insertNotifications(docs: WithId<NotificationDocument>[]): Promise<void> {
	if (!docs.length) return;
	await (await notifications()).insertMany(docs, { ordered: false });
}

export async function listNotificationsForUser(
	userId: string,
	limit: number,
): Promise<WithId<NotificationDocument>[]> {
	return (await notifications()).find({ userId }).sort({ createdAt: -1 }).limit(limit).toArray();
}

export async function countUnreadNotifications(userId: string): Promise<number> {
	return (await notifications()).countDocuments({ userId, readAt: null });
}

export async function markNotificationsDelivered(
	userId: string,
	ids: string[],
	now: Date,
): Promise<void> {
	if (!ids.length) return;
	await (await notifications()).updateMany(
		{ userId, _id: { $in: ids }, deliveredAt: null },
		{ $set: { deliveredAt: now } },
	);
}

export async function markNotificationRead(
	userId: string,
	id: string,
	now: Date,
): Promise<boolean> {
	const result = await (await notifications()).updateOne(
		{ userId, _id: id },
		{ $set: { readAt: now }, $min: { deliveredAt: now } },
	);
	return result.matchedCount > 0;
}

export async function markAllNotificationsRead(userId: string, now: Date): Promise<number> {
	const result = await (await notifications()).updateMany(
		{ userId, readAt: null },
		{ $set: { readAt: now } },
	);
	return result.modifiedCount;
}

export async function deleteNotificationsForUser(userId: string): Promise<void> {
	await (await notifications()).deleteMany({ userId });
}

// ─── Campaigns (one per send) ───────────────────────────────────────────────

export async function insertNotificationCampaign(
	campaign: WithId<NotificationCampaignDocument>,
): Promise<void> {
	await (await campaigns()).insertOne(campaign);
}

export async function listNotificationCampaigns(
	limit: number,
): Promise<WithId<NotificationCampaignDocument>[]> {
	return (await campaigns()).find().sort({ createdAt: -1 }).limit(limit).toArray();
}

/** Delivered and read counts per campaign. */
export async function campaignStats(
	campaignIds: string[],
): Promise<Map<string, { delivered: number; read: number }>> {
	const stats = new Map<string, { delivered: number; read: number }>();
	if (!campaignIds.length) return stats;
	const rows = await (await notifications())
		.aggregate<{ _id: string; delivered: number; read: number }>([
			{ $match: { campaignId: { $in: campaignIds } } },
			{
				$group: {
					_id: "$campaignId",
					delivered: { $sum: { $cond: [{ $ne: ["$deliveredAt", null] }, 1, 0] } },
					read: { $sum: { $cond: [{ $ne: ["$readAt", null] }, 1, 0] } },
				},
			},
		])
		.toArray();
	for (const row of rows) stats.set(row._id, { delivered: row.delivered, read: row.read });
	return stats;
}

// ─── Templates ──────────────────────────────────────────────────────────────

export async function listNotificationTemplates(): Promise<WithId<NotificationTemplateDocument>[]> {
	return (await templates()).find().sort({ updatedAt: -1 }).toArray();
}

export async function countNotificationTemplates(): Promise<number> {
	return (await templates()).countDocuments();
}

export async function findNotificationTemplate(
	id: string,
): Promise<WithId<NotificationTemplateDocument> | null> {
	return (await templates()).findOne({ _id: id });
}

export async function insertNotificationTemplates(
	docs: WithId<NotificationTemplateDocument>[],
): Promise<void> {
	if (docs.length) await (await templates()).insertMany(docs);
}

export async function replaceNotificationTemplate(
	doc: WithId<NotificationTemplateDocument>,
): Promise<boolean> {
	const result = await (await templates()).replaceOne({ _id: doc._id }, doc);
	return result.matchedCount > 0;
}

export async function deleteNotificationTemplate(id: string): Promise<boolean> {
	const result = await (await templates()).deleteOne({ _id: id });
	return result.deletedCount > 0;
}

// ─── Audience lookups ───────────────────────────────────────────────────────

export async function listAllUserIds(): Promise<string[]> {
	const users = await collection<UserDocument>(COLLECTIONS.users);
	return (await users.find({}, { projection: { _id: 1 } }).toArray()).map((user) => user._id);
}

/** Accounts whose website session was refreshed since [since] (sessions refresh every few minutes). */
export async function listUserIdsWithSessionActivitySince(since: Date): Promise<string[]> {
	const sessions = await collection<SessionDocument>(COLLECTIONS.sessions);
	return (await sessions.distinct("userId", { updatedAt: { $gte: since } })) as string[];
}
