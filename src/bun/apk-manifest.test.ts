import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { ApkParseError, readApkManifest } from "./apk-manifest";

const DIST = new URL("../../litecheats-sms-android/dist/", import.meta.url);
const builtApkName = existsSync(DIST)
	? readdirSync(DIST).find((name) => name.endsWith("-release.apk"))
	: undefined;
const BUILT_APK = builtApkName ? new URL(builtApkName, DIST) : null;

describe("readApkManifest", () => {
	test.skipIf(!BUILT_APK)("reads the Litecheats APK's identity", () => {
		const info = readApkManifest(new Uint8Array(readFileSync(BUILT_APK as URL)));
		expect(info.packageName).toBe("com.litecheats.app");
		expect(info.versionCode).toBeGreaterThanOrEqual(1);
		expect(info.versionName.length).toBeGreaterThan(0);
		expect(info.minSdkVersion).toBe(28);
	});

	test("rejects a file that is not a zip", () => {
		expect(() => readApkManifest(new TextEncoder().encode("definitely not an apk"))).toThrow(
			ApkParseError,
		);
	});
});
