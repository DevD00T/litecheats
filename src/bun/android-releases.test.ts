import { afterEach, describe, expect, test } from "bun:test";
import { isAndroidPublishTokenValid } from "./android-releases";

const TOKEN = "test-token-0123456789abcdefghijklmnopqrstuvwxyz";

describe("isAndroidPublishTokenValid", () => {
	afterEach(() => {
		delete Bun.env.ANDROID_PUBLISH_TOKEN;
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
