import {
	DEVICE_PLATFORMS,
	type DevicePlatform,
	LOCATION_ACCESS_LEVELS,
	type LocationAccess,
	type UpsertDevicePayload,
	type UserDeviceSummary,
} from "../../shared/devices";
import {
	type UserDeviceDocument,
	type WithId,
	getDb,
	listUserDevices,
	upsertUserDevice,
} from "./db";

export class UserDeviceError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

/** App-generated device ids: a UUID, or at least a short opaque token. */
const DEVICE_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

function text(value: unknown, field: string, max: number): string {
	if (typeof value !== "string") throw new UserDeviceError(400, `${field} must be a string.`);
	return value.trim().slice(0, max);
}

function flag(value: unknown, field: string): boolean {
	if (typeof value !== "boolean") throw new UserDeviceError(400, `${field} must be true or false.`);
	return value;
}

function object(value: unknown, field: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new UserDeviceError(400, `${field} must be an object.`);
	}
	return value as Record<string, unknown>;
}

export function parseDeviceId(value: string): string {
	if (!DEVICE_ID_PATTERN.test(value)) throw new UserDeviceError(400, "Invalid device id.");
	return value;
}

/** Strict parser: every field must be present and of the right type. */
export function parseUpsertDevicePayload(raw: unknown): UpsertDevicePayload {
	const body = object(raw, "body");
	const permissions = object(body.permissions, "permissions");
	const preferences = object(body.preferences, "preferences");
	const consents = object(body.consents, "consents");

	const platform = body.platform as DevicePlatform;
	if (!(DEVICE_PLATFORMS as readonly string[]).includes(platform)) {
		throw new UserDeviceError(400, "Unsupported platform.");
	}
	const location = permissions.location as LocationAccess;
	if (!(LOCATION_ACCESS_LEVELS as readonly string[]).includes(location)) {
		throw new UserDeviceError(400, "permissions.location must be precise, approximate or denied.");
	}
	const appVersionCode = body.appVersionCode;
	if (
		typeof appVersionCode !== "number" ||
		!Number.isInteger(appVersionCode) ||
		appVersionCode < 0
	) {
		throw new UserDeviceError(400, "appVersionCode must be a whole number.");
	}

	return {
		platform,
		appVersionName: text(body.appVersionName, "appVersionName", 40),
		appVersionCode,
		deviceModel: text(body.deviceModel, "deviceModel", 120),
		osVersion: text(body.osVersion, "osVersion", 60),
		permissions: {
			notifications: flag(permissions.notifications, "permissions.notifications"),
			installUpdates: flag(permissions.installUpdates, "permissions.installUpdates"),
			storage: flag(permissions.storage, "permissions.storage"),
			location,
		},
		preferences: {
			autoUpdate: flag(preferences.autoUpdate, "preferences.autoUpdate"),
			updateWifiOnly: flag(preferences.updateWifiOnly, "preferences.updateWifiOnly"),
		},
		consents: {
			termsAccepted: flag(consents.termsAccepted, "consents.termsAccepted"),
			updateDisclaimerAccepted: flag(
				consents.updateDisclaimerAccepted,
				"consents.updateDisclaimerAccepted",
			),
		},
	};
}

export function toUserDeviceSummary(device: WithId<UserDeviceDocument>): UserDeviceSummary {
	return {
		deviceId: device.deviceId,
		platform: device.platform,
		appVersionName: device.appVersionName,
		appVersionCode: device.appVersionCode,
		deviceModel: device.deviceModel,
		osVersion: device.osVersion,
		permissions: device.permissions,
		preferences: device.preferences,
		consents: device.consents,
		updateDisclaimerAcceptedAt: device.updateDisclaimerAcceptedAt?.toISOString() ?? null,
		createdAt: device.createdAt.toISOString(),
		updatedAt: device.updatedAt.toISOString(),
	};
}

/** A signed-in user can keep at most this many device records; the oldest is replaced first. */
const MAX_DEVICES_PER_USER = 20;

export async function saveUserDevice(
	userId: string,
	deviceId: string,
	payload: UpsertDevicePayload,
): Promise<UserDeviceSummary> {
	await getDb();
	const existing = await listUserDevices(userId);
	if (
		!existing.some((device) => device.deviceId === deviceId) &&
		existing.length >= MAX_DEVICES_PER_USER
	) {
		throw new UserDeviceError(409, "Too many devices on this account. Remove an old one first.");
	}
	const saved = await upsertUserDevice({ userId, deviceId, ...payload }, new Date());
	return toUserDeviceSummary(saved);
}

export async function listUserDeviceSummaries(userId: string): Promise<UserDeviceSummary[]> {
	await getDb();
	return (await listUserDevices(userId)).map(toUserDeviceSummary);
}
