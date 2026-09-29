import { afterEach, describe, expect, test } from "bun:test";
import { isAndroidPublishTokenValid, toAndroidReleaseSummary } from "./android-releases";

const TOKEN = "test-token-0123456789abcdefghijklmnopqrstuvwxyz";

describe("isAndroidPublishTokenValid", () => {
	afterEach(() => {
		Bun.env.ANDROID_PUBLISH_TOKEN = "";
	});

	test("accepts the configured bearer token", () => {
		Bun.env.ANDROID_PUBLISH_TOKEN = TOKEN;
		expect(isAndroidPublishTokenValid(`Bearer ${TOKEN}`)).toBe(true);
	});

	test("rejects a wrong or missing token", () => {
		Bun.env.ANDROID_PUBLISH_TOKEN = TOKEN;
		expect(isAndroidPublishTokenValid(`Bearer ${TOKEN}x`)).toBe(false);
		expect(isAndroidPublishTokenValid(TOKEN)).toBe(false);
		expect(isAndroidPublishTokenValid(null)).toBe(false);
	});

	test("is disabled when the server has no token, or a short one", () => {
		expect(isAndroidPublishTokenValid(`Bearer ${TOKEN}`)).toBe(false);
		Bun.env.ANDROID_PUBLISH_TOKEN = "short";
		expect(isAndroidPublishTokenValid("Bearer short")).toBe(false);
	});
});

describe("toAndroidReleaseSummary", () => {
	const base = {
		packageName: "com.litecheats.app",
		minSdkVersion: 28,
		sha256: "a".repeat(64),
		sizeBytes: 1,
		notes: "",
		mandatory: false,
		publishedAt: new Date(0),
		createdAt: new Date(0),
		updatedAt: new Date(0),
	};

	test("marks only the live version as live", () => {
		const live = { ...base, _id: "new", versionCode: 8, versionName: "1.7.0", filename: "b.apk" };
		const old = { ...base, _id: "old", versionCode: 7, versionName: "1.6.0", filename: "a.apk" };
		expect(toAndroidReleaseSummary(live, "new").live).toBe(true);
		expect(toAndroidReleaseSummary(old, "new").live).toBe(false);
		expect(toAndroidReleaseSummary(old, "new").downloadPath).toBe("/downloads/android/old/file");
		expect(toAndroidReleaseSummary(old, "new").adminDownloadPath).toBe(
			"/login/admin/android/releases/old/file",
		);
	});
});
