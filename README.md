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
- A MongoDB database (`src/bun/db/`) for users, sessions, releases, release
  artifacts, Telegram admins, billing and wallets

Set these in `.env`. `MONGODB_URI` is required; the rest are optional and shown
with their defaults:

```ini
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?appName=litecheats
MONGODB_DB_NAME=litecheats_pwa
OWNER_EMAIL=owner@litecheats.com
OWNER_PASSWORD=
OWNER_FULL_NAME=Owner
OWNER_COMPANY=Litecheats Technologies
```

On first boot, if no owner account exists yet, one is created automatically. Set
`OWNER_PASSWORD` to choose it yourself; leave it blank and a random password is
generated and printed once to the server console (grab it from there — it is
never shown again). If an account already exists with `OWNER_EMAIL`, it is
promoted to owner/admin instead of creating a duplicate.

#### Database layout

The database is `MONGODB_DB_NAME` (default `litecheats_pwa`). The schema lives in
one place, `src/bun/db/schema.ts`, and is applied automatically on every boot, so
a fresh database needs no manual setup (`bun run db:setup` does it on demand).
Each collection has a `$jsonSchema` validator and named indexes:

| Collection                                                       | Holds                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| `users`                                                          | Accounts. Unique on `emailLower`.                                  |
| `sessions`                                                       | Login sessions. Expired ones are purged by a TTL index.            |
| `email_verifications`, `email_verification_codes`                | Signup verification. `_id` is the token / the user id.             |
| `release_versions`, `release_artifacts`                          | Release feed and artifact metadata.                                |
| `release_files.files` / `.chunks`                                | The artifact binaries, in GridFS under the artifact's own `_id`.   |
| `telegram_admins`                                                | Telegram admins. Unique on `usernameLower`.                        |
| `billing_subscriptions`, `billing_payments`                      | Orders and payments. Razorpay ids are unique when present.         |
| `billing_webhook_events`                                         | Webhook idempotency. `_id` is the event id; a TTL index expires it. |
| `wallet_accounts`, `wallet_transactions`, `wallet_topups`        | Prepaid wallet. `_id` of an account is the user id; balance is never negative. |

Things worth knowing:

- Timestamps are BSON `Date`s, flags are real booleans, roles are a real array.
- Wallet movements, top-up settlement and wallet-paid renewals use multi-document
  transactions, so the cluster must be a **replica set** (every Atlas cluster is).
- The database validates writes. A document that breaks the schema is rejected
  with error 121 rather than stored.
- Release binaries are in GridFS because a MongoDB document is capped at 16 MB.

#### Migrating from the old SQLite database

Earlier versions stored everything in a SQLite file. To carry that data over, run
this once, on the machine that has the file, with `MONGODB_URI` set:

```bash
bun scripts/migrate-sqlite-to-mongo.ts --dry-run                       # preview, writes nothing
bun scripts/migrate-sqlite-to-mongo.ts --sqlite=./data/litecheats.sqlite
```

It is safe to re-run: documents already in MongoDB are never overwritten. Run it
**before** the first start of the new version, so the owner account comes across
from SQLite instead of a fresh one being seeded. The SQLite file is opened
read-only and is left in place.

#### Tests

`bun test src/bun/db` runs the data-layer integration tests against your cluster
in a throwaway database that is dropped afterwards. They are skipped when
`MONGODB_URI` is not set.

The Bun auth server runs on `http://localhost:8787` and exposes:

- `POST /login/signup`
- `POST /login`
- `POST /login/logout`
- `GET /login/session`
- `GET /login/me`
- `PATCH /login/me`
- `DELETE /login/me`

### Telegram bot setup (GramIO)

The backend can run a Telegram bot using [GramIO](https://gramio.dev).

1. Set these in `.env`:

```ini
BOT_TOKEN=1234567890:your_telegram_bot_token
TELEGRAM_BOT_ENABLED=true
TELEGRAM_ADMIN_USERNAMES=your_telegram_username
LITECHEATS_STATUS_BASE_URL=https://litecheats.com
TELEGRAM_WEBHOOK_PATH=/telegram-webhook
TELEGRAM_WEBHOOK_BASE_URL=https://litecheats.com
TELEGRAM_WEBHOOK_SECRET_TOKEN=replace_with_random_secret
```

2. Start only the bot (manual mode):

```bash
bun run bot:start
```

Bot commands included:

- `/start`
- `/help`
- `/admins`
- `/admins add @username`
- `/status`

`TELEGRAM_ADMIN_USERNAMES` is a comma-separated bootstrap list. Those usernames are
seeded into the database as Telegram owners, and Telegram admins can then
add more Telegram admins with `/admins add @username`.

`/status` is admin-only and checks Telegram bot connectivity, Telegram webhook
registration, the configured webhook path, and Litecheats HTTP/API reachability.
Set `LITECHEATS_STATUS_BASE_URL` if the status checks should target a different
public base URL.

The app exposes `GET ${TELEGRAM_WEBHOOK_PATH}` as a lightweight health check for
`/status`. Telegram update delivery still uses `POST ${TELEGRAM_WEBHOOK_PATH}`.

Webhook behavior:

- In production (`NODE_ENV=production` or `node_env=production`), bot starts in webhook mode and registers:
  - `${TELEGRAM_WEBHOOK_BASE_URL}${TELEGRAM_WEBHOOK_PATH}`
- In development (`NODE_ENV=development` or `node_env=development`), bot uses long polling by default.

Optional dev webhook tunnel (instead of polling):

```ini
TELEGRAM_DEV_WEBHOOK_TUNNEL=true
TELEGRAM_DEV_WEBHOOK_TUNNEL_PORT=8080
```

This uses `untun` to expose local webhook URL automatically.

When `BOT_TOKEN` is present and `TELEGRAM_BOT_ENABLED=true`, the bot starts with Bun runtimes (`bun run start`, `bun run web:fullstack`, and desktop Bun main process).

### Downloads API (MongoDB-backed)

The app exposes a release feed and artifact download API backed by MongoDB (binaries in GridFS),
with artifact bytes stored directly as BLOBs in the `release_artifacts` table:

- `GET /downloads/releases`
- `GET /downloads/releases/latest`
- `GET /downloads/artifacts/:artifactId/file`

### appbun wrapper generation

`appbun` is installed as a dev dependency and can scaffold a desktop wrapper project from a URL:

```bash
bun run appbun:create
```

This creates `./litecheats` as an inspectable Electrobun-based wrapper project.

Generate a DMG directly (same shape as your command):

```bash
bun run appbun:dmg
```

HMR wrapper target (local fullstack gateway URL):

```bash
APPBUN_URL=http://localhost:8080 bun run appbun:hmr:create
```

Then run wrapper + Vite together with hot reload:

```bash
bun run appbun:hmr:run
```

`appbun:hmr:run` refreshes `./litecheats` against `http://localhost:8080` before starting,
uses the fullstack dev gateway (`web:fullstack`) so `/downloads` and auth routes work in
desktop HMR, and reuses an existing server if one is already running on that URL.

### Development with file watching

```bash
bun run dev          # Same as start, with Electrobun --watch enabled
```

### Development with Hot Module Replacement

```bash
bun run dev:hmr      # Alias for bun run dev
```

### Web full-stack dev server (Elysia + HMR)

```bash
bun run web:fullstack
```

This starts an Elysia gateway on `http://localhost:8080`, proxies frontend requests to Vite (`:5173`) with HMR, and routes `/login`, `/downloads`, and `/contact/inquiry` to the Bun backend APIs.

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

This generates the app bundle plus patch files for delta updates. Upload the build output to your `baseUrl` location only if you intentionally enable updater-based distribution.

### macOS DMG release publishing (MongoDB-backed downloads)

The app includes a release publisher flow for macOS DMG artifacts:

1. Build stable desktop app + create DMG + publish version metadata/artifact:

```bash
bun run release:macos --version v0.1.0 --notes "Initial macOS release"
```

2. Skip build and publish an existing DMG file:

```bash
bun run release:macos --version v0.1.1 --artifact ./build/dmg/Litecheats.dmg --skip-build
```

3. Low-level publisher command (any supported platform/format):

```bash
bun run publish:release --version v0.1.0 --artifact ./build/dmg/Litecheats.dmg --platform macos --format dmg --target universal --latest true
```

This stores the binary as a BLOB in the `release_artifacts` table, updates
`release_versions`, and makes the file available through:

- `GET /downloads/releases`
- `GET /downloads/artifacts/:artifactId/file`

Current rollout starts with macOS DMG. Windows/Linux artifacts can be published using the
same publisher script once those build outputs are available.

Admins/owners can add, update, and delete versions and artifacts directly from the site
admin panel. CLI publish scripts remain available for operational workflows.

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

## Key Config Files

| File | Purpose |
|---|---|
| `electrobun.config.ts` | App metadata, build settings, platform config, copy rules, release URL |
| `vite.config.ts` | Vite build config, dev server port, path aliases |
| `tsconfig.json` | TypeScript config covering both `src/` and `shared/` |
| `components.json` | shadcn/ui CLI configuration |
| `biome.json` | Linting and formatting rules |
| `postcss.config.mjs` | PostCSS with Tailwind CSS 4 plugin |
