# Electrobun Starter

An opinionated starter template for building desktop applications with [Electrobun](https://electrobun.dev/).

**Note:** Electrobun is NOT Electron. Do not use Electron APIs or patterns. See the [Electrobun docs](https://blackboard.sh/electrobun/docs/) for API reference.

## Create a New Project

**Option A — GitHub template** (requires the repo to be marked as a template in Settings):

```bash
gh repo create my-app --template mattgi/electrobun-starter --clone
cd my-app
bun run scripts/init.ts myapp
bun install
```

**Option B — degit** (no git history):

```bash
bunx degit mattgi/electrobun-starter my-app
cd my-app
bun run scripts/init.ts myapp
bun install
```

The init script renames `product` to your app name across all config files. Pass `--identifier` to customize the bundle ID:

```bash
bun run scripts/init.ts myapp --identifier com.mycompany.myapp
```

## What's Included

- **React 19** with TypeScript for the webview UI
- **Vite 6** for fast development builds with HMR support
- **Tailwind CSS 4** for styling
- **shadcn/ui** pre-configured (New York style, neutral base)
- **Biome** for linting and formatting
- **Type-safe RPC** between main process and webview via shared schema
- **Bun** as the runtime and package manager

## Project Structure

```
src/
  bun/            # Main process (Bun runtime)
    index.ts      # App entry point, window creation, RPC handlers, menu
  mainview/       # Webview UI (React + Vite)
    components/   # React components (including shadcn/ui)
    lib/          # Utilities (cn(), electrobun RPC client)
    index.html    # HTML entry point
    index.tsx     # React root
    index.css     # Tailwind + theme tokens
shared/           # Shared types between main and webview
  rpc.ts          # RPC schema definition (type-safe contract)
```

## Development

### Quick start

```bash
bun install
bun run start        # Start web app (Vite) + desktop app together
```

### Resend contact form setup

The contact page sends enquiries through the Bun main process via typed RPC and Resend.

1. Copy the example env file:

```bash
cp .env.example .env
```

2. Set `RESEND_API_KEY` in `.env`.
3. Optionally set:
   - `RESEND_FROM_EMAIL` (must be a verified sender in Resend for production)
   - `RESEND_TO_EMAIL` (defaults to `support@litecheats.com`)

Bun automatically loads `.env` files, so no extra dotenv setup is required.

### Auth + MongoDB setup

The app includes Bun-managed auth with:

- Signup/Login pages (`/signup`, `/login`)
- Session cookies issued by Bun auth server (`Path=/login`, `Max-Age=86400`)
- Password hashing and verification using `Bun.password`
- UUIDv7 IDs for users and sessions using `Bun.randomUUIDv7()` (fallback to `crypto.randomUUID`)
- MongoDB-backed user/session collections with validators, indexes, and session TTL

Set these in `.env`:

```ini
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB_NAME=litecheats
```

The Bun auth server runs on `http://localhost:8787` and exposes:

- `POST /login/signup`
- `POST /login`
- `POST /login/logout`
- `GET /login/session`
- `GET /login/me`
- `PATCH /login/me`
- `DELETE /login/me`

### Desktop release pipeline (MongoDB-backed downloads)

The app now includes a release feed and binary download API backed by MongoDB:

- `GET /downloads/releases` (latest + history)
- `GET /downloads/releases/latest`
- `GET /downloads/artifacts/:artifactId/file`

The web UI has a `/downloads` page that reads this feed and renders platform download buttons.

#### 1) Build installers

```bash
bun run release:build:mac
bun run release:build:win
bun run release:build:linux
```

`release:build:*` commands are host-validated:

- run `release:build:mac` on macOS
- run `release:build:win` on Windows
- run `release:build:linux` on Linux

If you call a non-host target, the script exits with a clear error instead of producing incorrect artifacts.

For local host-only build:

```bash
bun run release:build:host
```

#### 2) Publish installers to MongoDB

```bash
bun run release:publish --version 0.1.0 --notes "Stable rollout"
```

By default, publisher scans `artifacts/`. Override with `.env`:

```ini
RELEASE_ARTIFACT_DIRS=artifacts,./custom-artifacts
RELEASE_VERSION=0.1.0
RELEASE_NOTES="Stable release"
```

You can also do build+publish in one command per platform:

```bash
bun run release:mac:publish
bun run release:win:publish
bun run release:linux:publish
```

#### 3) Automated cross-platform publish (recommended)

Use the GitHub Actions matrix workflow:

- [`.github/workflows/release-desktop-matrix.yml`](/Users/debarghadas/Downloads/electrobun-starter-main/.github/workflows/release-desktop-matrix.yml)

It builds on `macos-latest`, `windows-latest`, and `ubuntu-latest`, then publishes each platform artifact set into MongoDB GridFS for the shared `/downloads` feed.

Required GitHub repository secrets:

- `MONGODB_URI`
- `MONGODB_DB_NAME`

### appbun wrapper generation

`appbun` is installed as a dev dependency and can scaffold a desktop wrapper project from a URL:

```bash
APPBUN_URL=http://localhost:5173 bun run appbun:create
```

This creates `./desktop/litecheats` as an inspectable Electrobun-based wrapper project.

### Development with file watching

```bash
bun run dev          # Same as start, with Electrobun --watch enabled
```

### Development with Hot Module Replacement

```bash
bun run dev:hmr      # Alias for bun run dev
```

The desktop app now waits for the Vite server and then loads `http://localhost:5173` in development, so webview and browser behavior stay aligned.

If you want to test bundled assets explicitly:

```bash
bun run start:bundled
```

### Linting

```bash
bun run lint         # Check with Biome
bun run lint:fix     # Auto-fix
```

## Adding UI Components

This project uses [shadcn/ui](https://ui.shadcn.com/) with the New York style. To add components:

```bash
bunx shadcn@latest add button
bunx shadcn@latest add dialog
```

Components are placed in `src/mainview/components/ui/`. The `cn()` utility is at `src/mainview/lib/utils.ts`.

## RPC (Main <-> Webview Communication)

The type-safe RPC contract lives in `shared/rpc.ts`. Both sides import from it:

- **Main process** (`src/bun/index.ts`): `BrowserView.defineRPC<MainRPC>()` — defines request handlers and message listeners
- **Webview** (`src/mainview/lib/electrobun.ts`): `Electroview.defineRPC<MainRPC>()` — calls requests and sends messages

To add a new RPC method:

1. Add the type to `shared/rpc.ts` under `bun.requests` or `bun.messages`
2. Implement the handler in `src/bun/index.ts`
3. Call it from the webview via `electrobun.rpc.request("methodName", params)`

## Building & Releasing

Electrobun uses `--env` to distinguish build channels:

| Channel | Command | Purpose |
|---|---|---|
| `dev` | `bun run start` | Runs Vite + Electrobun together for local development |
| `dev (bundled)` | `bun run start:bundled` | Launches desktop app from bundled `views://` assets |
| `release (mac)` | `bun run release:mac:publish` | Builds stable mac artifacts and publishes them to MongoDB |
| `release (win)` | `bun run release:win:publish` | Builds stable Windows artifacts and publishes them to MongoDB |
| `release (linux)` | `bun run release:linux:publish` | Builds stable Linux artifacts and publishes them to MongoDB |
| `canary` | `bun run build:canary` | Pre-release testing build |
| `stable` | `bun run build:stable` | Production release build |

All build scripts run `vite build` first, then `electrobun build`. The `copy` rules in `electrobun.config.ts` map Vite output into the app bundle:

```
dist/index.html   → views/mainview/index.html
dist/assets/      → views/mainview/assets/
```

### Release & updates

Electrobun has a built-in delta update system. Configure the release URL in `electrobun.config.ts`:

```ts
release: {
  baseUrl: "https://your-cdn.com/releases/",
}
```

Then build a stable release:

```bash
bun run build:stable
```

This generates the app bundle plus patch files for delta updates. Upload the build output to your `baseUrl` location. The app can check for and apply updates at runtime using the `Updater` API from `electrobun/bun`.

### macOS code signing and notarization

In `electrobun.config.ts`, set:

```ts
mac: {
  codesign: true,
  notarize: true,
  entitlements: { /* ... */ },
}
```

See the [Electrobun docs](https://blackboard.sh/electrobun/docs/) for details on certificates and notarization setup.

### Cross-platform

The config includes `mac`, `linux`, and `win` blocks. Set `bundleCEF: true` on each platform to include the Chromium Embedded Framework in the app bundle for distribution (set to `false` during development to save build time).

## Key Config Files

| File | Purpose |
|---|---|
| `electrobun.config.ts` | App metadata, build settings, platform config, copy rules, release URL |
| `vite.config.ts` | Vite build config, dev server port, path aliases |
| `tsconfig.json` | TypeScript config covering both `src/` and `shared/` |
| `components.json` | shadcn/ui CLI configuration |
| `biome.json` | Linting and formatting rules |
| `postcss.config.mjs` | PostCSS with Tailwind CSS 4 plugin |
