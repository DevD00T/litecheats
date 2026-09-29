import { describe, expect, test } from "bun:test";
import { UserDeviceError, parseDeviceId, parseUpsertDevicePayload } from "./user-devices";

const valid = {
	platform: "android",
	appVersionName: "1.2.0",
	appVersionCode: 4,
	deviceModel: "OnePlus CPH2581",
	osVersion: "Android 15 (API 35)",
	permissions: {
		notifications: true,
		installUpdates: true,
		storage: false,
		location: "approximate",
	},
	preferences: { autoUpdate: true, updateWifiOnly: false },
	consents: { termsAccepted: true, updateDisclaimerAccepted: true },
};

describe("parseUpsertDevicePayload", () => {
	test("accepts what the app sends", () => {
		const parsed = parseUpsertDevicePayload(valid);
		expect(parsed.permissions.location).toBe("approximate");
		expect(parsed.consents.updateDisclaimerAccepted).toBe(true);
	});

	test("rejects an unknown location level", () => {
		expect(() =>
			parseUpsertDevicePayload({
				...valid,
				permissions: { ...valid.permissions, location: "always" },
			}),
		).toThrow(UserDeviceError);
	});

	test("rejects a missing permission flag", () => {
		const { storage: _storage, ...permissions } = valid.permissions;
		expect(() => parseUpsertDevicePayload({ ...valid, permissions })).toThrow(UserDeviceError);
	});

	test("rejects a non-integer versionCode", () => {
		expect(() => parseUpsertDevicePayload({ ...valid, appVersionCode: 1.5 })).toThrow(
			UserDeviceError,
		);
	});
});

describe("parseDeviceId", () => {
	test("accepts a UUID and rejects path tricks", () => {
		expect(parseDeviceId("3f2c9a8e-1b7d-4c6e-9f00-2a1b3c4d5e6f")).toBeTruthy();
		expect(() => parseDeviceId("../../etc")).toThrow(UserDeviceError);
		expect(() => parseDeviceId("x")).toThrow(UserDeviceError);
	});
});
