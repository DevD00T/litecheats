import { AUTH_ADMIN_BASE_PATH, AUTH_BASE_PATH } from "./auth";

/**
 * Per-user, per-device record of what the user allowed in the Android app:
 * permission grants, update preferences and the consents they ticked. Only the
 * *status* of a permission is stored, never data read through it (no locations,
 * no files).
 */
export const DEVICES_PATH = `${AUTH_BASE_PATH}/me/devices`;
export const ADMIN_USER_DEVICES_PATH = (userId: string) =>
	`${AUTH_ADMIN_BASE_PATH}/users/${encodeURIComponent(userId)}/devices`;

export const DEVICE_PLATFORMS = ["android"] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

/** Android lets the user pick precise or approximate location, or refuse. */
export const LOCATION_ACCESS_LEVELS = ["precise", "approximate", "denied"] as const;
export type LocationAccess = (typeof LOCATION_ACCESS_LEVELS)[number];

export interface DevicePermissions {
	notifications: boolean;
	installUpdates: boolean;
	/** Photos & files (media on Android 13+, external storage before). */
	storage: boolean;
	location: LocationAccess;
}

export interface DevicePreferences {
	autoUpdate: boolean;
	updateWifiOnly: boolean;
}

export interface DeviceConsents {
	termsAccepted: boolean;
	updateDisclaimerAccepted: boolean;
}

/** What the app sends. deviceId is a random id the app generated on first launch. */
export interface UpsertDevicePayload {
	platform: DevicePlatform;
	appVersionName: string;
	appVersionCode: number;
	deviceModel: string;
	osVersion: string;
	permissions: DevicePermissions;
	preferences: DevicePreferences;
	consents: DeviceConsents;
}

export interface UserDeviceSummary extends UpsertDevicePayload {
	deviceId: string;
	/** When the update disclaimer was first ticked on this device, or null. */
	updateDisclaimerAcceptedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface UserDevicesResponse {
	devices: UserDeviceSummary[];
}

export interface UserDeviceResponse {
	device: UserDeviceSummary;
}
