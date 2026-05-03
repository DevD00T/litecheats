#!/usr/bin/env bun

import { spawn } from "node:child_process";

type TargetPlatform = "macos" | "windows" | "linux";

const targetArg = (process.argv[2] ?? "").trim().toLowerCase();

const targetPlatformMap: Record<string, TargetPlatform> = {
	macos: "macos",
	mac: "macos",
	windows: "windows",
	win: "windows",
	linux: "linux",
};

const hostPlatform: TargetPlatform | null =
	process.platform === "darwin"
		? "macos"
		: process.platform === "win32"
			? "windows"
			: process.platform === "linux"
				? "linux"
				: null;

function runCommand(command: string, args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			stdio: "inherit",
			shell: process.platform === "win32",
		});

		child.on("close", (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? 1}`));
		});

		child.on("error", (error) => {
			reject(error);
		});
	});
}

function printUsageAndExit(): never {
	console.error("Usage: bun scripts/build-release.ts <macos|windows|linux>");
	process.exit(1);
}

if (!targetArg) {
	printUsageAndExit();
}

const requestedTarget = targetPlatformMap[targetArg];
if (!requestedTarget) {
	printUsageAndExit();
}

if (!hostPlatform) {
	console.error(`Unsupported host platform: ${process.platform}`);
	process.exit(1);
}

if (requestedTarget !== hostPlatform) {
	console.error(
		`Cannot build ${requestedTarget} on ${hostPlatform} host with current Electrobun CLI. ` +
			`Run this command on a ${requestedTarget} runner (or use the GitHub Actions matrix workflow).`,
	);
	process.exit(1);
}

console.log(`Building stable desktop release for ${requestedTarget}...`);
await runCommand("bunx", ["vite", "build"]);
await runCommand("bunx", ["--bun", "electrobun", "build", "--env=stable"]);
console.log(`Stable build completed for ${requestedTarget}.`);
