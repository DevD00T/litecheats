import { collection, isUniqueConstraintError } from "./client";
import { COLLECTIONS } from "./schema";
import type { WhatsAppWebhookEventDocument } from "./types";

const events = () => collection<WhatsAppWebhookEventDocument>(COLLECTIONS.whatsappWebhookEvents);

/** Stores a delivery. Returns false when this exact delivery was already stored. */
export async function insertWhatsAppWebhookEvent(
	event: WhatsAppWebhookEventDocument,
): Promise<boolean> {
	try {
		await (await events()).insertOne(event);
		return true;
	} catch (error) {
		if (isUniqueConstraintError(error)) return false;
		throw error;
	}
}

/** Newest first. `before` pages backwards through older events. */
export async function listWhatsAppWebhookEvents(params: {
	event?: string;
	before?: Date;
	limit: number;
}): Promise<WhatsAppWebhookEventDocument[]> {
	const filter: Record<string, unknown> = {};
	if (params.event) filter.event = params.event;
	if (params.before) filter.receivedAt = { $lt: params.before };
	return (await events()).find(filter).sort({ receivedAt: -1 }).limit(params.limit).toArray();
}

export async function countWhatsAppWebhookEventsByName(): Promise<Record<string, number>> {
	const rows = await (await events())
		.aggregate<{ _id: string; count: number }>([{ $group: { _id: "$event", count: { $sum: 1 } } }])
		.toArray();
	return Object.fromEntries(rows.map((row) => [row._id, row.count]));
}

/** The most recent event of one kind, e.g. the current `connection.update`. */
export async function findLatestWhatsAppWebhookEvent(
	event: string,
): Promise<WhatsAppWebhookEventDocument | null> {
	return (await events()).findOne({ event }, { sort: { receivedAt: -1 } });
}
