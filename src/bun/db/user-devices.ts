import { collection } from "./client";
import { COLLECTIONS } from "./schema";
import type { UserDeviceDocument, WithId } from "./types";

const userDevices = () => collection<UserDeviceDocument>(COLLECTIONS.userDevices);

export function userDeviceId(userId: string, deviceId: string): string {
	return `${userId}:${deviceId}`;
}

/**
 * Creates or replaces one device's record. createdAt and the first time the
 * update disclaimer was accepted are kept from the existing record.
 */
export async function upsertUserDevice(
	device: Omit<
		UserDeviceDocument,
		"_id" | "createdAt" | "updatedAt" | "updateDisclaimerAcceptedAt"
	>,
	now: Date,
): Promise<WithId<UserDeviceDocument>> {
	const handle = await userDevices();
	const _id = userDeviceId(device.userId, device.deviceId);
	const existing = await handle.findOne({ _id });
	const updateDisclaimerAcceptedAt = device.consents.updateDisclaimerAccepted
		? (existing?.updateDisclaimerAcceptedAt ?? now)
		: null;
	const record: WithId<UserDeviceDocument> = {
		...device,
		_id,
		updateDisclaimerAcceptedAt,
		// Saving from the app means it's open right now.
		lastSeenAt: now,
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
	};
	await handle.replaceOne({ _id }, record, { upsert: true });
	return record;
}

export async function listUserDevices(userId: string): Promise<WithId<UserDeviceDocument>[]> {
	return (await userDevices()).find({ userId }).sort({ updatedAt: -1 }).toArray();
}

/** The app checked in (it polls for notifications): marks the device as seen now. */
export async function touchUserDevice(userId: string, deviceId: string, now: Date): Promise<void> {
	await (await userDevices()).updateOne(
		{ _id: userDeviceId(userId, deviceId) },
		{ $set: { lastSeenAt: now } },
	);
}

/** Accounts with at least one app install, optionally only those seen since [since]. */
export async function listUserIdsWithDevices(since?: Date): Promise<string[]> {
	const filter = since ? { lastSeenAt: { $gte: since } } : {};
	return (await (await userDevices()).distinct("userId", filter)) as string[];
}

export async function deleteUserDevice(userId: string, deviceId: string): Promise<boolean> {
	const result = await (await userDevices()).deleteOne({ _id: userDeviceId(userId, deviceId) });
	return result.deletedCount > 0;
}

export async function deleteUserDevicesForUser(userId: string): Promise<void> {
	await (await userDevices()).deleteMany({ userId });
}
