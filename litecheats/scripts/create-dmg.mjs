import { mkdir, readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

if (process.platform !== "darwin") {
  console.error("build:dmg is only available on macOS.");
  process.exit(1);
}

const root = process.cwd();
const buildDir = resolve(root, "build");
const appPath = await findLatestAppBundle(buildDir);

if (!appPath) {
  console.error("No macOS .app bundle found under build/. Run bun run build first.");
  process.exit(1);
}

const destinationDir = resolve(buildDir, "dmg");
await mkdir(destinationDir, { recursive: true });
const result = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  [
    "create-dmg",
    appPath,
    destinationDir,
    "--overwrite",
    "--no-version-in-filename",
    "--no-code-sign",
    "--dmg-title",
    "Litecheats"
  ],
  {
    stdio: "inherit",
    cwd: root,
  },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`DMG created from ${basename(appPath)} in ${destinationDir}`);

async function findLatestAppBundle(dir) {
  let best = undefined;
  await walk(dir);
  return best?.path;

  async function walk(currentDir) {
    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory() && entry.name.endsWith(".app")) {
        const score = scoreAppPath(fullPath);
        if (!best || score > best.score) {
          best = { path: fullPath, score };
        }
        continue;
      }

      if (entry.isDirectory()) {
        await walk(fullPath);
      }
    }
  }
}

function scoreAppPath(pathname) {
  let score = 0;
  if (pathname.includes("stable")) score += 40;
  if (pathname.includes("canary")) score += 20;
  if (pathname.includes("dev")) score += 10;
  if (pathname.includes("macos")) score += 100;
  return score;
}
