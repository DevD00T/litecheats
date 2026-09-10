# Razorpay payments

Checkout for the `/pricing` plans runs on Razorpay. This document covers the
dashboard setup, the webhook configuration, and how the pieces fit together.

## 0. Plans and access

Five tiers live in `shared/billing.ts`, which is the single source of truth for
what anything costs:

| Plan | Price | How you get it |
| --- | --- | --- |
| Lab | free | sign up |
| Operator | ₹999 / vehicle / month | self-serve checkout, 1–10 vehicles |
| Institution | ₹4,900 / vehicle / month | self-serve checkout |
| Enterprise | ₹9,400 / vehicle / month | self-serve checkout, from 25 vehicles |
| Sovereign | quoted | contact sales |

Checkout requires an account. Signed-out visitors get a "Sign in to continue"
button that carries `?redirect=/pricing`, so they land back on pricing after
signing in or signing up; the API independently returns `401` on every billing
endpoint without a session, so the gate is not just a UI convention.

New signups always get the plain `user` role with `isAdmin` and `isOwner` false.
Admins and owners additionally see the admin console at `/admin`, where the
**Orders & subscriptions** card lists every order across all accounts with
revenue totals, a filter, and per-order controls for status, vehicle count,
period end and the do-not-renew flag. Signed-in users see their own orders and
payments on `/account`.

## 1. Keys

Dashboard → **Account & Settings → API Keys → Generate Test Key**. Copy both
halves into `.env`:

```
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
```

`RAZORPAY_KEY_ID` is publishable and is sent to the browser. `RAZORPAY_KEY_SECRET`
never leaves the server — it signs orders and verifies payment signatures.

Without these two values the app still boots; the pricing page renders normally
but every checkout button is refused with a clear message and the API returns
`503` from `/login/billing/checkout`.

## 2. Webhook

Dashboard → **Settings → Webhooks → Add New Webhook**.

**Webhook URL**

```
https://<your-domain>/api/razorpay/webhook
```

For example `https://litecheats.com/api/razorpay/webhook`. It must be publicly
reachable over HTTPS — `localhost` will not work, so for local testing expose
port 8080 with a tunnel (ngrok, cloudflared, or the `untun` dependency already
in this project) and register the tunnel URL.

**Secret**

Type any random string and put the same value in `.env`:

```
RAZORPAY_WEBHOOK_SECRET=replace_with_random_secret
```

Every delivery is authenticated by an HMAC-SHA256 of the raw request body under
this secret. If the variable is unset, deliveries are rejected with `401` —
the server logs a warning at startup when this is the case.

**Active events** — tick these:

| Event | Why it is needed |
| --- | --- |
| `payment.captured` | Primary activation signal. Marks the term active and records the payment. |
| `payment.failed` | Marks the attempt failed so a stale "pending" row does not linger. |
| `payment.authorized` | Records money that is authorised but not yet captured. |
| `order.paid` | Backstop activation if `payment.captured` is missed. |
| `refund.created` | Records the refund. |
| `refund.processed` | Records the refund and ends the term. |

Add these **only if you also configure Razorpay Plans** (see step 4):

| Event | Why it is needed |
| --- | --- |
| `subscription.activated` | Mandate approved — starts the term. |
| `subscription.charged` | A renewal succeeded — extends the term. |
| `subscription.pending` | A renewal charge failed and is being retried. |
| `subscription.halted` | Retries exhausted; access should be reviewed. |
| `subscription.cancelled` | Customer or merchant cancelled. |
| `subscription.completed` | All billing cycles ran; the mandate is finished. |

Any other event is acknowledged with `200` and ignored, so Razorpay stops
retrying it rather than piling up failed deliveries.

## 3. Tax

GST is added on top of the catalogue price and is shown as a separate line on
the pricing card:

```
RAZORPAY_TAX_PERCENT=18
```

## 4. Optional: auto-recurring subscriptions

Out of the box a checkout creates a **one-time Razorpay Order** that prepays the
whole term (1 month or 12 months). The customer is not charged again
automatically; they re-purchase when the term ends.

To switch a tier to a true auto-recurring mandate, create a plan in
Dashboard → **Subscriptions → Plans** and set its id:

```
RAZORPAY_PLAN_ID_INSTITUTION_MONTHLY=plan_xxxxxxxxxxxxxx
RAZORPAY_PLAN_ID_INSTITUTION_ANNUAL=plan_xxxxxxxxxxxxxx
RAZORPAY_PLAN_ID_ENTERPRISE_MONTHLY=plan_xxxxxxxxxxxxxx
RAZORPAY_PLAN_ID_ENTERPRISE_ANNUAL=plan_xxxxxxxxxxxxxx
```

The amount then comes from the Razorpay plan rather than from
`shared/billing.ts`, so keep the two in sync. `RAZORPAY_SUBSCRIPTION_TOTAL_COUNT`
controls how many cycles the mandate runs before re-authorisation (default 12
for monthly, 5 for annual).

## 5. How it fits together

```
shared/billing.ts        Plan catalogue and price maths, shared by client and server.
src/bun/razorpay.ts      SDK client, config, constant-time signature verification.
src/bun/billing.ts       Checkout creation, verification, webhook application.
src/bun/auth-server.ts   Routes, session guards, rate limits.
src/mainview/lib/        billing-api.ts (fetch client) + razorpay-checkout.ts (Checkout.js).
```

### Endpoints

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/login/billing/plans` | public |
| `POST` | `/login/billing/checkout` | session |
| `POST` | `/login/billing/verify` | session |
| `GET` | `/login/billing/subscription` | session |
| `POST` | `/login/billing/subscription/cancel` | session |
| `GET` | `/login/billing/orders` | session |
| `GET` | `/login/billing/payments` | session |
| `GET` | `/login/admin/billing/orders` | admin or owner |
| `PATCH` | `/login/admin/billing/orders/:id` | admin or owner |
| `POST` | `/api/razorpay/webhook` | HMAC signature |

Billing sits under `/login` on purpose: the session cookie is issued with
`Path=/login`, so an endpoint outside that prefix would never receive it. The
webhook is deliberately outside it — Razorpay posts server-to-server with no
cookie, and the body HMAC is its authentication.

### Payment flow

1. Browser calls `POST /login/billing/checkout` with a plan id, cycle and
   vehicle count. **The price is never sent by the client** — the server
   recomputes it from `shared/billing.ts`, so a tampered request can only
   change which plan is bought, never what it costs.
2. Server creates the Razorpay order (or subscription), writes a local row with
   status `created`, and returns the checkout parameters.
3. Razorpay Checkout opens and the customer pays.
4. The browser hands the signature back to `POST /login/billing/verify`. The
   server verifies the HMAC, **re-fetches the payment from Razorpay's API**, and
   only then marks the term active. The browser's success callback is never
   trusted on its own.
5. The webhook independently confirms the same thing. Whichever arrives first
   activates the term; the other is a no-op.

### Idempotency

Razorpay retries a webhook until it gets a `2xx` and may redeliver even after
success. Every `X-Razorpay-Event-Id` is claimed in `billing_webhook_events`
before the event is applied, so a redelivery is recognised and skipped.


## 7. Wallet and auto-renew

Every account has a prepaid wallet. **Wallet auto-renew is the default** for new
accounts; each user changes it themselves at `/billing`.

- **Load up** — a top-up creates its own Razorpay order (`notes.kind = "wallet_topup"`),
  verified the same way as a plan payment, then credited to the balance.
- **Renewal** — an hourly sweep finds terms whose `currentPeriodEnd` has passed and
  debits the wallet. The new term is measured from the *old* period end, so a late
  sweep never shortens a term the customer paid for.
- **Not enough balance** — the subscription moves to `halted` rather than going
  negative. The wallet ledger and balance are written in one SQLite transaction,
  so they cannot drift apart.
- **Manual checkout mode** — nothing is ever auto-debited; the customer pays each
  term from the pricing page.

### The ten-day warning

Ten days before a renewal, users are warned in two places:

- a banner on `/account` and `/billing`
- one email per period (deduplicated by `renewalWarningSentFor`)

When the wallet cannot cover the renewal, or the account is on manual checkout,
the message is: *"Load up your wallet or change your payment mode to continue
using RDOS and its services."* When the balance does cover it, the notice simply
says the debit will happen automatically.

Wallet endpoints (all session-gated):

| Method | Path |
| --- | --- |
| `GET` | `/login/billing/wallet` |
| `PATCH` | `/login/billing/wallet` |
| `POST` | `/login/billing/wallet/topup` |
| `POST` | `/login/billing/wallet/topup/verify` |
| `GET` | `/login/billing/renewal` |

## 8. Roles and verification

`emailVerified` is **presentational only** — it drives a banner on `/account` and a
badge in the admin console, and nothing else. It does not gate sign-in, checkout,
or any API route. Access control uses the `isAdmin` / `isOwner` flags via
`hasPrivilegedAccess()`; the `roles` array is a display projection derived from
those flags, not a permission source. If email verification should actually gate
anything, that check has to be added deliberately.


## 9. Telegram order alerts

Paid orders and wallet top-ups are pushed to the Telegram admins' personal
chats through the existing bot.

**Important Telegram constraint:** the Bot API cannot DM a user from their
@username alone — it needs a numeric chat id, and Telegram only reveals that
once the person has messaged the bot. So adding `@someone` as an admin is not
enough on its own; they must also open a chat with the bot and send `/start`.

Setup:

1. Seed the first admin with `TELEGRAM_ADMIN_USERNAMES` in `.env`.
2. That admin opens the bot and sends `/start` — their chat id is recorded and
   they begin receiving alerts.
3. They add colleagues with `/admins add @username`.
4. Each new admin sends `/start` to the bot themselves to start receiving alerts.

`/admins` lists everyone and marks anyone still missing a chat id as
*"(not linked - open a chat with me and send /start)"*, so it is obvious who
still needs to do step 4.

Admins are alerted on five events:

| Alert | Fires when |
| --- | --- |
| **New order paid** | A plan checkout is captured. Names plan, quantity, cycle, amount, customer, company, and the Razorpay order and payment ids. |
| **Wallet topped up** | A top-up is credited. Amount and the new balance. |
| **Renewal charged to wallet** | A term renews from balance. Amount taken, wallet left, next renewal date. |
| **⚠️ Low wallet before renewal** | Inside the 10-day window and the wallet will not cover the charge (or the account is on manual checkout). Once per term. |
| **⚠️ Renewal failed - plan halted** | A renewal could not be taken and the plan was halted. | Each order is announced exactly once — the flag
is claimed on the record, so the browser verification call and the webhook
cannot both fire a message. An admin who has blocked the bot is logged and
skipped without stopping delivery to everyone else.


## 10. Private subscription ids and admin control

Every subscription — customer checkout or admin grant — gets a short id like
`LC-SUB-7QK3M2AD` at creation. The alphabet omits O/0 and I/1 so support and
customer cannot transcribe it wrongly. It is stored, uniquely indexed, and shown
everywhere the subscription appears. Existing rows were backfilled on first boot
after this shipped.

Each subscription also carries free-text **notes**, editable by admins.

The admin console at `/admin` is organised into tabs — **Users**,
**Subscriptions**, **Releases** — with everything billing-related under
Subscriptions:

- **Activate a plan on an account** — grants any plan to any existing account.
  Creates a new subscription with a fresh private id, active immediately, priced
  from the catalogue but with **no payment taken** and no Razorpay order behind
  it. Use it for comped, manually invoiced or support grants. An optional
  *months* field overrides the cycle length; leaving notes blank records who
  granted it, when, and that no payment was taken.
- **Pause / Resume** — `paused` is deliberately distinct from `halted` (which is
  what a failed renewal produces), so an operator can tell a deliberate
  suspension from a payment problem. A paused plan does not entitle and is not
  picked up by the renewal sweep.
- **Delete** — removes the subscription behind a confirm step. Payment rows are
  **kept and detached**: they record money that actually moved, so they stay in
  the ledger even when the subscription is gone.
- Status, vehicle count, period end, do-not-renew and notes are all editable.
  The amount is not — it records what Razorpay captured.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/login/admin/billing/orders` | admin or owner |
| `POST` | `/login/admin/billing/orders` | admin or owner |
| `PATCH` | `/login/admin/billing/orders/:id` | admin or owner |
| `DELETE` | `/login/admin/billing/orders/:id` | admin or owner |

## 6. Testing

Use Razorpay's test cards — e.g. `4111 1111 1111 1111`, any future expiry, any
CVV, and OTP `1234`. Test-mode payments never move real money.

Verify a webhook without waiting for a real payment from
Dashboard → **Settings → Webhooks → your webhook → Send test webhook**.
