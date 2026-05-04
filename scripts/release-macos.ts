#!/usr/bin/env bun

import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

interface ReleaseMacosOptions {
	version: string;
	notes: string;
	target: string;
	artifactPath: string | null;
	skipBuild: boolean;
}

function printUsage(): void {
	console.log(`Usage:
bun scripts/release-macos.ts --version <version> [options]

Options:
  --version <value>       Required release version (e.g. v0.1.0)
  --notes <value>         Release notes (default: "")
  --target <value>        Build target label (default: universal)
  --artifact <path>       DMG path override (default: auto-detect from build/dmg)
  --skip-build            Skip build:stable and DMG generation

Example:
  bun scripts/release-macos.ts --version v0.1.0 --notes "Initial macOS release"
`);
}

function getArgValue(args: string[], key: string): string | undefined {
	const index = args.indexOf(key);
	if (index < 0) return undefined;
	return args[index + 1];
}

function parseOptions(args: string[]): ReleaseMacosOptions {
	if (args.includes("--help") || args.includes("-h")) {
		printUsage();
		process.exit(0);
	}

	const version = getArgValue(args, "--version")?.trim();
	if (!version) {
		throw new Error("Missing --version");
	}

	const notes = getArgValue(args, "--notes")?.trim() ?? "";
	const target = getArgValue(args, "--target")?.trim() ?? "universal";
	const artifactInput = getArgValue(args, "--artifact")?.trim() ?? null;
	const artifactPath = artifactInput ? resolve(artifactInput) : null;
	const skipBuild = args.includes("--skip-build");

	return {
		version,
		notes,
		target,
		artifactPath,
		skipBuild,
	};
}

function runCommand(command: string[], label: string): void {
	console.log(`\n[release-macos] ${label}`);
	console.log(`[release-macos] $ ${command.join(" ")}`);

	const result = Bun.spawnSync({
		cmd: command,
		stdio: ["inherit", "inherit", "inherit"],
	});

	if (result.exitCode !== 0) {
		throw new Error(`Command failed (${result.exitCode}): ${command.join(" ")}`);
	}
}

async function findLatestDmg(rootDir: string): Promise<string | null> {
	let best: { path: string; mtimeMs: number } | null = null;
	await walk(rootDir);
	return best?.path ?? null;

	async function walk(currentDir: string): Promise<void> {
		let entries: Awaited<ReturnType<typeof readdir>>;
		try {
			entries = await readdir(currentDir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			const fullPath = join(currentDir, entry.name);
			if (entry.isDirectory()) {
				await walk(fullPath);
				continue;
			}

			if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".dmg")) {
				continue;
			}

			const stat = await Bun.file(fullPath).stat();
			if (!best || stat.mtimeMs > best.mtimeMs) {
				best = {
					path: fullPath,
					mtimeMs: stat.mtimeMs,
				};
			}
		}
	}
}

function runPublish(version: string, artifactPath: string, notes: string, target: string): void {
	const publishCmd = [
		"bun",
		"scripts/publish-release.ts",
		"--version",
		version,
		"--artifact",
		artifactPath,
		"--platform",
		"macos",
		"--format",
		"dmg",
		"--target",
		target,
		"--latest",
		"true",
	];

	if (notes) {
		publishCmd.push("--notes", notes);
	}

	runCommand(publishCmd, "Publishing macOS release to MongoDB");
}

async function main(): Promise<void> {
	const options = parseOptions(process.argv.slice(2));

	if (!options.skipBuild) {
		runCommand(["bun", "run", "build:stable"], "Building stable desktop app");
		runCommand(["bun", "litecheats/scripts/create-dmg.mjs"], "Creating Litecheats.dmg");
	}

	const artifactPath = options.artifactPath ?? (await findLatestDmg(resolve(process.cwd(), "build/dmg")));
	if (!artifactPath) {
		throw new Error("No .dmg file found under build/dmg. Pass --artifact to set DMG path manually.");
	}

	runPublish(options.version, artifactPath, options.notes, options.target);
	console.log("\n[release-macos] Complete.");
}

try {
	await main();
} catch (error) {
	console.error(error instanceof Error ? error.message : "release-macos failed");
	printUsage();
	process.exit(1);
}
