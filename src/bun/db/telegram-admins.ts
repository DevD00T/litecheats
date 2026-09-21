import { collection, retryOnDuplicateKey } from "./client";
import { COLLECTIONS } from "./schema";
import type { TelegramAdminDocument, WithId } from "./types";

const admins = () => collection<TelegramAdminDocument>(COLLECTIONS.telegramAdmins);

export async function findTelegramAdminByUsernameLower(
	usernameLower: string,
): Promise<WithId<TelegramAdminDocument> | null> {
	return (await admins()).findOne({ usernameLower });
}

/** Owners first, then alphabetical. */
export async function listTelegramAdminsSorted(): Promise<WithId<TelegramAdminDocument>[]> {
	return (await admins()).find().sort({ role: -1, usernameLower: 1 }).toArray();
}

/** Usernames from the environment are always owners; re-running only refreshes `updatedAt`. */
export async function seedTelegramAdminsFromEnv(usernames: string[]): Promise<void> {
	const collectionHandle = await admins();

	for (const username of usernames) {
		const usernameLower = username.toLowerCase();
		const now = new Date();
		await retryOnDuplicateKey(() =>
			collectionHandle.updateOne(
				{ usernameLower },
				{
					$set: { updatedAt: now },
					$setOnInsert: {
						_id: crypto.randomUUID(),
						username,
						role: "owner",
						chatId: null,
						addedByTelegramId: null,
						addedByUsername: "env",
						createdAt: now,
					},
				},
				{ upsert: true },
			),
		);
	}
}

export async function upsertTelegramAdmin(
	username: string,
	addedByTelegramId: number | null,
	addedByUsername: string | null,
): Promise<{ admin: WithId<TelegramAdminDocument>; created: boolean }> {
	const collectionHandle = await admins();
	const usernameLower = username.toLowerCase();
	const now = new Date();

	const result = await retryOnDuplicateKey(() =>
		collectionHandle.findOneAndUpdate(
			{ usernameLower },
			{
				$set: { updatedAt: now },
				$setOnInsert: {
					_id: crypto.randomUUID(),
					username,
					role: "admin",
					chatId: null,
					addedByTelegramId,
					addedByUsername,
					createdAt: now,
				},
			},
			{ upsert: true, returnDocument: "after", includeResultMetadata: true },
		),
	);

	if (!result.value) {
		throw new Error("Telegram admin was not saved. Please try again.");
	}
	return { admin: result.value, created: result.lastErrorObject?.updatedExisting === false };
}

/**
 * Records the private-chat id for an admin so the bot can DM them. Telegram
 * only reveals this when the person messages the bot, so it stays null until
 * an admin has actually opened a chat.
 */
export async function linkTelegramAdminChat(
	usernameLower: string,
	chatId: number,
): Promise<boolean> {
	const result = await (await admins()).updateOne(
		{ usernameLower },
		{ $set: { chatId, updatedAt: new Date() } },
	);
	return result.matchedCount > 0;
}

/** Admins the bot can actually message, i.e. those with a known chat id. */
export async function listTelegramAdminChatIds(): Promise<{ username: string; chatId: number }[]> {
	const rows = await (await admins())
		.find({ chatId: { $ne: null } }, { projection: { _id: 0, username: 1, chatId: 1 } })
		.sort({ createdAt: 1 })
		.toArray();
	return rows.map((row) => ({ username: row.username, chatId: row.chatId as number }));
}
