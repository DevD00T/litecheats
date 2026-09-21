import { DEFAULT_USER_ROLE } from "../../../shared/auth";
import { collection } from "./client";
import { COLLECTIONS } from "./schema";
import type { UserDocument, WithId } from "./types";

const users = () => collection<UserDocument>(COLLECTIONS.users);

export async function insertUser(user: WithId<UserDocument>): Promise<void> {
	await (await users()).insertOne({
		...user,
		isAdmin: Boolean(user.isAdmin),
		isOwner: Boolean(user.isOwner),
		emailVerified: Boolean(user.emailVerified),
		roles: user.roles ?? [DEFAULT_USER_ROLE],
		preferredOrigin: user.preferredOrigin ?? null,
	});
}

export async function findUserByEmailLower(
	emailLower: string,
): Promise<WithId<UserDocument> | null> {
	return (await users()).findOne({ emailLower });
}

export async function findUserById(id: string): Promise<WithId<UserDocument> | null> {
	return (await users()).findOne({ _id: id });
}

export async function listAllUsersSortedByCreatedDesc(): Promise<WithId<UserDocument>[]> {
	return (await users()).find().sort({ createdAt: -1 }).toArray();
}

export async function updateUserFields(id: string, patch: Partial<UserDocument>): Promise<void> {
	const set: Partial<UserDocument> = {};
	if (patch.fullName !== undefined) set.fullName = patch.fullName;
	if (patch.company !== undefined) set.company = patch.company;
	if (patch.email !== undefined) set.email = patch.email;
	if (patch.emailLower !== undefined) set.emailLower = patch.emailLower;
	if (patch.isAdmin !== undefined) set.isAdmin = Boolean(patch.isAdmin);
	if (patch.isOwner !== undefined) set.isOwner = Boolean(patch.isOwner);
	if (patch.emailVerified !== undefined) set.emailVerified = Boolean(patch.emailVerified);
	if (patch.preferredOrigin !== undefined) set.preferredOrigin = patch.preferredOrigin ?? null;
	if (patch.passwordHash !== undefined) set.passwordHash = patch.passwordHash;
	if (patch.roles !== undefined) set.roles = patch.roles;
	if (patch.updatedAt !== undefined) set.updatedAt = patch.updatedAt;

	if (!Object.keys(set).length) return;
	await (await users()).updateOne({ _id: id }, { $set: set });
}

export async function deleteUserById(id: string): Promise<void> {
	await (await users()).deleteOne({ _id: id });
}
