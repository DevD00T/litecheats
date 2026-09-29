#!/usr/bin/env bun

/**
 * Publishes a built Android APK to the in-app update channel.
 *
 *   bun run release:android --apk litecheats-sms-android/dist/Litecheats-1.0.1-release.apk --notes "Bug fixes"
 *
 * The APK's package, versionCode and versionName are read from the APK itself.
 * The binary goes into GridFS, older versions stay as admin-only history (set
 * ANDROID_KEEP_RELEASES to prune), and every installed copy of the app picks the update up on its next
 * check. Needs MONGODB_URI in .env, like the server.
 */
import { resolve } from "node:path";
import { AndroidReleaseError, publishAndroidApk } from "../src/bun/android-releases";
import { closeDb } from "../src/bun/db";

function argValue(args: string[], key: string): string | undefined {
	const index = args.indexOf(key);
	return index >= 0 ? args[index + 1] : undefined;
}

async function main(): Promise<void> {
	const args = Bun.argv.slice(2);
	const apkPath = argValue(args, "--apk");
	if (!apkPath || args.includes("--help")) {
		console.log(`Usage:
  bun scripts/publish-android.ts --apk <path-to.apk> [--notes "What changed"] [--mandatory] [--archive]

  --apk <path>     The signed release APK (e.g. litecheats-sms-android/dist/Litecheats-1.0.1-release.apk)
  --notes <text>   Shown to users in the update prompt
  --mandatory      Users must install this update before they can keep using the app
  --archive        File an older build in the version history (admins only; never offered to phones)`);
		process.exit(args.includes("--help") ? 0 : 1);
	}

	const file = Bun.file(resolve(apkPath));
	if (!(await file.exists())) throw new Error(`APK not found: ${apkPath}`);

	const result = await publishAndroidApk({
		apk: new Uint8Array(await file.arrayBuffer()),
		notes: argValue(args, "--notes") ?? "",
		mandatory: args.includes("--mandatory"),
		archive: args.includes("--archive"),
	});

	const { release } = result;
	console.log(`${release.live ? "Published" : "Archived"} ${release.packageName} ${release.versionName}`);
	console.log(`  versionCode  ${release.versionCode}`);
	console.log(`  sha256       ${release.sha256}`);
	console.log(`  size         ${release.sizeBytes} bytes`);
	console.log(`  mandatory    ${release.mandatory}`);
	console.log(`  download     ${release.downloadPath}`);
	if (result.removed.length) {
		console.log(
			`  removed      ${result.removed.map((item) => `${item.versionName} (${item.versionCode})`).join(", ")}`,
		);
	}
}

try {
	await main();
} catch (error) {
	console.error(error instanceof AndroidReleaseError || error instanceof Error ? error.message : error);
	process.exitCode = 1;
} finally {
	await closeDb();
}
