#!/usr/bin/env bun
/**
 * Initialize a new project from this template.
 *
 * Usage:
 *   bun run scripts/init.ts myapp
 *   bun run scripts/init.ts myapp --identifier com.mycompany.myapp
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const name = args[0];
const identifierFlag = args.indexOf("--identifier");
const identifier =
	identifierFlag !== -1 && args[identifierFlag + 1]
		? args[identifierFlag + 1]
		: `dev.${name}.app`;

if (!name) {
	console.error("Usage: bun run scripts/init.ts <app-name> [--identifier <id>]");
	console.error("Example: bun run scripts/init.ts myapp --identifier com.mycompany.myapp");
	process.exit(1);
}

if (!/^[a-z][a-z0-9-]*$/.test(name)) {
	console.error(`Invalid app name "${name}". Use lowercase letters, numbers, and hyphens.`);
	process.exit(1);
}

const root = join(import.meta.dir, "..");

const files = [
	"package.json",
	"electrobun.config.ts",
	"src/bun/index.ts",
	"src/mainview/index.html",
];

for (const file of files) {
	const filePath = join(root, file);
	let content = readFileSync(filePath, "utf-8");
	content = content.replaceAll("@product/app", `@${name}/app`);
	content = content.replaceAll("dev.product.app", identifier);
	content = content.replaceAll("product", name);
	writeFileSync(filePath, content);
	console.log(`  updated ${file}`);
}

console.log(`\nInitialized "${name}" (${identifier})`);
console.log("Next steps:");
console.log("  bun install");
console.log("  bun run start");
