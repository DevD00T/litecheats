import type { Db } from "mongodb";
import { DEFAULT_USER_ROLE } from "../../../shared/auth";
import { COLLECTIONS } from "./schema";
import type { UserDocument } from "./types";

const DEFAULT_OWNER_EMAIL = "owner@litecheats.com";
const DEFAULT_OWNER_FULL_NAME = "Owner";
const DEFAULT_OWNER_COMPANY = "Litecheats Technologies";

function createUuidV7(): string {
	const maybeUuidV7 = (Bun as unknown as { randomUUIDv7?: () => string }).randomUUIDv7;
	return typeof maybeUuidV7 === "function" ? maybeUuidV7() : crypto.randomUUID();
}

function generateRandomPassword(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(18));
	return `${Buffer.from(bytes).toString("base64url")}!9`;
}

/**
 * Makes sure at least one owner exists. Runs against the raw `Db` because it
 * executes during connection setup, before the repositories are usable.
 */
export async function seedOwnerAccount(db: Db): Promise<void> {
	const users = db.collection<UserDocument>(COLLECTIONS.users);
	if ((await users.countDocuments({ isOwner: true }, { limit: 1 })) > 0) return;

	const emailInput = Bun.env.OWNER_EMAIL?.trim() || DEFAULT_OWNER_EMAIL;
	const emailLower = emailInput.toLowerCase();
	const now = new Date();

	const existing = await users.findOne({ emailLower }, { projection: { _id: 1 } });
	if (existing) {
		await users.updateOne(
			{ _id: existing._id },
			{ $set: { isOwner: true, isAdmin: true, emailVerified: true, updatedAt: now } },
		);
		console.log(`[db] Promoted existing account "${emailInput}" to owner.`);
		return;
	}

	const explicitPassword = Bun.env.OWNER_PASSWORD?.trim();
	const password = explicitPassword || generateRandomPassword();

	try {
		await users.insertOne({
			_id: createUuidV7(),
			email: emailInput,
			emailLower,
			fullName: Bun.env.OWNER_FULL_NAME?.trim() || DEFAULT_OWNER_FULL_NAME,
			company: Bun.env.OWNER_COMPANY?.trim() || DEFAULT_OWNER_COMPANY,
			isAdmin: true,
			isOwner: true,
			emailVerified: true,
			roles: [DEFAULT_USER_ROLE],
			preferredOrigin: null,
			passwordHash: await Bun.password.hash(password),
			createdAt: now,
			updatedAt: now,
		});
	} catch (error) {
		// Another server process seeded the owner between our check and insert.
		if ((error as { code?: number }).code === 11000) return;
		throw error;
	}

	console.log("========================================");
	console.log(" Owner account created");
	console.log(` Email:    ${emailInput}`);
	if (!explicitPassword) {
		console.log(` Password: ${password}`);
		console.log(" Save this password now, it will not be shown again.");
		console.log(" Set OWNER_PASSWORD in your environment to control it explicitly next time.");
	} else {
		console.log(" Password: set from OWNER_PASSWORD.");
	}
	console.log("========================================");
}
