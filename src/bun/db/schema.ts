import type { CreateCollectionOptions, Db, Document, IndexDescription } from "mongodb";
import { USER_ROLES, WHATSAPP_OTP_PURPOSES } from "../../../shared/auth";
import {
	BILLING_CYCLES,
	BILLING_PLAN_IDS,
	BILLING_SUBSCRIPTION_STATUSES,
	WALLET_PAYMENT_MODES,
} from "../../../shared/billing";
import { RELEASE_FORMATS, RELEASE_PLATFORMS } from "../../../shared/releases";

/**
 * Every collection the app owns. Callers refer to these constants rather than
 * string literals, so a rename is a one-line change and a typo is a type error.
 */
export const COLLECTIONS = {
	users: "users",
	sessions: "sessions",
	emailVerifications: "email_verifications",
	emailVerificationCodes: "email_verification_codes",
	whatsappOtpChallenges: "whatsapp_otp_challenges",
	whatsappWebhookEvents: "whatsapp_webhook_events",
	releaseVersions: "release_versions",
	releaseArtifacts: "release_artifacts",
	telegramAdmins: "telegram_admins",
	billingSubscriptions: "billing_subscriptions",
	billingPayments: "billing_payments",
	billingWebhookEvents: "billing_webhook_events",
	walletAccounts: "wallet_accounts",
	walletTransactions: "wallet_transactions",
	walletTopups: "wallet_topups",
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

const DAY_SECONDS = 24 * 60 * 60;

/**
 * Expired sessions are purged by MongoDB itself. The TTL monitor only runs about
 * once a minute, so code that reads a session must still compare `expiresAt`.
 */
const SESSION_TTL_SECONDS = 0;

/**
 * Verification records outlive their own expiry by a day. That keeps the "this
 * code has expired, request a new one" message reachable instead of collapsing
 * into "no code found" the moment the clock passes `expiresAt`.
 */
const VERIFICATION_GRACE_SECONDS = DAY_SECONDS;

/**
 * Razorpay redelivers a webhook for at most a day or so. Thirty days is far past
 * any retry window while keeping the idempotency table from growing forever.
 */
const WEBHOOK_EVENT_TTL_SECONDS = 30 * DAY_SECONDS;

/**
 * WhatsApp events carry message text and phone numbers, so they are kept only
 * as long as they are useful for looking into a problem. Changing this later
 * needs a collMod on the index: createIndexes refuses to alter a TTL in place.
 */
export const WHATSAPP_EVENT_RETENTION_DAYS = 30;

// ---------------------------------------------------------------------------
// JSON Schema building blocks
// ---------------------------------------------------------------------------

const string = { bsonType: "string" } as const;
const nullableString = { bsonType: ["string", "null"] } as const;
const boolean = { bsonType: "bool" } as const;
const date = { bsonType: "date" } as const;
const nullableDate = { bsonType: ["date", "null"] } as const;
const nullableNumber = { bsonType: ["number", "null"] } as const;
const nonNegative = { bsonType: "number", minimum: 0 } as const;
/** Amounts are whole paise, so a negative value is always a bug. */
const paise = nonNegative;

function enumOf(values: readonly string[]) {
	return { bsonType: "string", enum: [...values] } as const;
}

function objectSchema(required: string[], properties: Record<string, Document>): Document {
	return {
		bsonType: "object",
		required: ["_id", ...required],
		properties: { _id: string, ...properties },
	};
}

interface CollectionDefinition {
	name: CollectionName;
	/** $jsonSchema for the collection. Rejects malformed writes at the database. */
	schema: Document;
	indexes: IndexDescription[];
}

/**
 * The single source of truth for the database's shape. `ensureSchema` applies it
 * on every boot, so the validators and indexes here are what production runs.
 *
 * Validation runs at level "moderate": new writes and updates to already-valid
 * documents are checked, but a legacy document that predates a rule can still be
 * read and fixed instead of becoming permanently unwritable.
 */
export const COLLECTION_DEFINITIONS: CollectionDefinition[] = [
	{
		name: COLLECTIONS.users,
		schema: objectSchema(
			[
				"email",
				"emailLower",
				"fullName",
				"company",
				"roles",
				"isAdmin",
				"isOwner",
				"emailVerified",
				"passwordHash",
				"createdAt",
				"updatedAt",
			],
			{
				email: string,
				emailLower: string,
				fullName: string,
				company: string,
				roles: { bsonType: "array", items: enumOf(USER_ROLES) },
				isAdmin: boolean,
				isOwner: boolean,
				emailVerified: boolean,
				preferredOrigin: nullableString,
				phone: nullableString,
				phoneVerified: boolean,
				// Null for WhatsApp-only accounts, which have no password.
				passwordHash: nullableString,
				createdAt: date,
				updatedAt: date,
			},
		),
		indexes: [
			{ key: { emailLower: 1 }, name: "emailLower_unique", unique: true },
			{ key: { createdAt: -1 }, name: "createdAt_desc" },
			// One account per WhatsApp number. Partial, so the many accounts with
			// no number (null or missing) never collide with each other.
			{
				key: { phone: 1 },
				name: "phone_unique",
				unique: true,
				partialFilterExpression: { phone: { $type: "string" } },
			},
		],
	},
	{
		// `_id` is the phone number: one live WhatsApp code per number, and a
		// resend replaces it.
		name: COLLECTIONS.whatsappOtpChallenges,
		schema: objectSchema(["purpose", "attempts", "lastSentAt", "expiresAt", "createdAt"], {
			purpose: enumOf(WHATSAPP_OTP_PURPOSES),
			attempts: { bsonType: "number", minimum: 0 },
			lastSentAt: date,
			expiresAt: date,
			createdAt: date,
		}),
		indexes: [
			{
				key: { expiresAt: 1 },
				name: "expiry_ttl",
				expireAfterSeconds: VERIFICATION_GRACE_SECONDS,
			},
		],
	},
	{
		name: COLLECTIONS.sessions,
		schema: objectSchema(
			["userId", "userAgent", "ipAddress", "deviceKey", "createdAt", "updatedAt", "expiresAt"],
			{
				userId: string,
				userAgent: string,
				ipAddress: string,
				deviceKey: string,
				createdAt: date,
				updatedAt: date,
				expiresAt: date,
			},
		),
		indexes: [
			{ key: { userId: 1, expiresAt: 1 }, name: "user_expiry" },
			{ key: { userId: 1, deviceKey: 1, expiresAt: 1 }, name: "user_device_expiry" },
			{ key: { expiresAt: 1 }, name: "expiry_ttl", expireAfterSeconds: SESSION_TTL_SECONDS },
		],
	},
	{
		// `_id` is the emailed token.
		name: COLLECTIONS.emailVerifications,
		schema: objectSchema(["userId", "expiresAt", "createdAt"], {
			userId: string,
			expiresAt: date,
			createdAt: date,
		}),
		indexes: [
			{ key: { userId: 1 }, name: "user" },
			{
				key: { expiresAt: 1 },
				name: "expiry_ttl",
				expireAfterSeconds: VERIFICATION_GRACE_SECONDS,
			},
		],
	},
	{
		// `_id` is the user id: one live code per account, and a resend replaces it.
		name: COLLECTIONS.emailVerificationCodes,
		schema: objectSchema(["codeHash", "expiresAt", "attempts", "lastSentAt", "createdAt"], {
			codeHash: string,
			expiresAt: date,
			attempts: { bsonType: "number", minimum: 0 },
			lastSentAt: date,
			createdAt: date,
		}),
		indexes: [
			{
				key: { expiresAt: 1 },
				name: "expiry_ttl",
				expireAfterSeconds: VERIFICATION_GRACE_SECONDS,
			},
		],
	},
	{
		// `_id` is the SHA-256 of the raw delivery, so a redelivery is one insert that fails.
		// `data` is whatever the gateway sent and is deliberately not constrained.
		name: COLLECTIONS.whatsappWebhookEvents,
		schema: objectSchema(["event", "receivedAt"], {
			event: string,
			sessionId: nullableString,
			occurredAt: nullableDate,
			receivedAt: date,
		}),
		indexes: [
			{ key: { event: 1, receivedAt: -1 }, name: "event_receivedAt" },
			{
				key: { receivedAt: 1 },
				name: "receivedAt_ttl",
				expireAfterSeconds: WHATSAPP_EVENT_RETENTION_DAYS * DAY_SECONDS,
			},
		],
	},
	{
		name: COLLECTIONS.releaseVersions,
		schema: objectSchema(
			["version", "notes", "publishedAt", "isLatest", "createdAt", "updatedAt"],
			{
				version: string,
				notes: string,
				publishedAt: date,
				isLatest: boolean,
				createdAt: date,
				updatedAt: date,
			},
		),
		indexes: [
			{ key: { version: 1 }, name: "version_unique", unique: true },
			{ key: { publishedAt: -1 }, name: "publishedAt_desc" },
			{ key: { isLatest: 1 }, name: "isLatest" },
		],
	},
	{
		// Metadata only. The binary is in the GridFS bucket under the same `_id`.
		name: COLLECTIONS.releaseArtifacts,
		schema: objectSchema(
			[
				"releaseId",
				"version",
				"platform",
				"format",
				"target",
				"filename",
				"sizeBytes",
				"sha256",
				"mimeType",
				"createdAt",
			],
			{
				releaseId: string,
				version: string,
				platform: enumOf(RELEASE_PLATFORMS),
				format: enumOf(RELEASE_FORMATS),
				target: string,
				filename: string,
				sizeBytes: nonNegative,
				sha256: string,
				mimeType: string,
				createdAt: date,
			},
		),
		indexes: [
			// Leading `releaseId` also serves the "all artifacts of a release" query.
			{
				key: { releaseId: 1, platform: 1, format: 1, target: 1 },
				name: "release_platform_format_target",
			},
		],
	},
	{
		name: COLLECTIONS.telegramAdmins,
		schema: objectSchema(["username", "usernameLower", "role", "createdAt", "updatedAt"], {
			username: string,
			usernameLower: string,
			role: enumOf(["admin", "owner"]),
			chatId: nullableNumber,
			addedByTelegramId: nullableNumber,
			addedByUsername: nullableString,
			createdAt: date,
			updatedAt: date,
		}),
		indexes: [{ key: { usernameLower: 1 }, name: "usernameLower_unique", unique: true }],
	},
	{
		name: COLLECTIONS.billingSubscriptions,
		schema: objectSchema(
			[
				"userId",
				"planId",
				"planName",
				"cycle",
				"quantity",
				"mode",
				"status",
				"amount",
				"currency",
				"cancelAtPeriodEnd",
				"privateId",
				"createdAt",
				"updatedAt",
			],
			{
				userId: string,
				planId: enumOf(BILLING_PLAN_IDS),
				planName: string,
				cycle: enumOf(BILLING_CYCLES),
				quantity: { bsonType: "number", minimum: 1 },
				mode: enumOf(["order", "subscription"]),
				status: enumOf(BILLING_SUBSCRIPTION_STATUSES),
				amount: paise,
				currency: string,
				razorpayOrderId: nullableString,
				razorpaySubscriptionId: nullableString,
				razorpayPaymentId: nullableString,
				shortUrl: nullableString,
				currentPeriodStart: nullableDate,
				currentPeriodEnd: nullableDate,
				cancelAtPeriodEnd: boolean,
				privateId: string,
				notes: string,
				renewalWarningSentFor: nullableDate,
				adminNotifiedAt: nullableDate,
				createdAt: date,
				updatedAt: date,
			},
		),
		indexes: [
			{ key: { userId: 1, createdAt: -1 }, name: "user_createdAt" },
			{ key: { createdAt: -1 }, name: "createdAt_desc" },
			{ key: { status: 1, currentPeriodEnd: 1 }, name: "status_periodEnd" },
			// Unique only when present: an order that has not reached Razorpay yet
			// has null here, and null must not collide with null.
			{
				key: { razorpayOrderId: 1 },
				name: "razorpayOrderId_unique",
				unique: true,
				partialFilterExpression: { razorpayOrderId: { $type: "string" } },
			},
			{
				key: { razorpaySubscriptionId: 1 },
				name: "razorpaySubscriptionId_unique",
				unique: true,
				partialFilterExpression: { razorpaySubscriptionId: { $type: "string" } },
			},
			{
				key: { privateId: 1 },
				name: "privateId_unique",
				unique: true,
				partialFilterExpression: { privateId: { $type: "string" } },
			},
		],
	},
	{
		name: COLLECTIONS.billingPayments,
		schema: objectSchema(
			["userId", "planId", "amount", "currency", "status", "createdAt", "updatedAt"],
			{
				userId: string,
				subscriptionId: nullableString,
				razorpayPaymentId: nullableString,
				razorpayOrderId: nullableString,
				planId: string,
				amount: paise,
				currency: string,
				status: string,
				method: nullableString,
				createdAt: date,
				updatedAt: date,
			},
		),
		indexes: [
			{ key: { userId: 1, createdAt: -1 }, name: "user_createdAt" },
			{ key: { subscriptionId: 1 }, name: "subscription" },
			{
				key: { razorpayPaymentId: 1 },
				name: "razorpayPaymentId_unique",
				unique: true,
				partialFilterExpression: { razorpayPaymentId: { $type: "string" } },
			},
		],
	},
	{
		// `_id` is the Razorpay event id, so claiming an event is a single insert.
		name: COLLECTIONS.billingWebhookEvents,
		schema: objectSchema(["event", "receivedAt"], { event: string, receivedAt: date }),
		indexes: [
			{
				key: { receivedAt: 1 },
				name: "receivedAt_ttl",
				expireAfterSeconds: WEBHOOK_EVENT_TTL_SECONDS,
			},
		],
	},
	{
		// `_id` is the user id. `balance >= 0` here is a last line of defence
		// behind the conditional debit in `applyWalletTransaction`.
		name: COLLECTIONS.walletAccounts,
		schema: objectSchema(
			["balance", "currency", "autoRenew", "paymentMode", "createdAt", "updatedAt"],
			{
				balance: paise,
				currency: string,
				autoRenew: boolean,
				paymentMode: enumOf(WALLET_PAYMENT_MODES),
				createdAt: date,
				updatedAt: date,
			},
		),
		indexes: [],
	},
	{
		name: COLLECTIONS.walletTransactions,
		schema: objectSchema(["userId", "type", "amount", "balanceAfter", "reason", "createdAt"], {
			userId: string,
			type: enumOf(["credit", "debit"]),
			amount: paise,
			balanceAfter: paise,
			reason: string,
			referenceId: nullableString,
			createdAt: date,
		}),
		indexes: [{ key: { userId: 1, createdAt: -1 }, name: "user_createdAt" }],
	},
	{
		name: COLLECTIONS.walletTopups,
		schema: objectSchema(["userId", "amount", "status", "createdAt", "updatedAt"], {
			userId: string,
			amount: paise,
			razorpayOrderId: nullableString,
			razorpayPaymentId: nullableString,
			status: enumOf(["created", "paid", "failed"]),
			createdAt: date,
			updatedAt: date,
		}),
		indexes: [
			{ key: { userId: 1, createdAt: -1 }, name: "user_createdAt" },
			{
				key: { razorpayOrderId: 1 },
				name: "razorpayOrderId_unique",
				unique: true,
				partialFilterExpression: { razorpayOrderId: { $type: "string" } },
			},
		],
	},
];

const NAMESPACE_EXISTS = 48;

function isNamespaceExistsError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { code?: unknown }).code === NAMESPACE_EXISTS
	);
}

/**
 * Creates any missing collection, brings every validator up to date and makes
 * sure every index exists. Idempotent, so it is safe to run on every boot and
 * from several server processes at once.
 */
export async function ensureSchema(db: Db): Promise<void> {
	for (const definition of COLLECTION_DEFINITIONS) {
		const options = {
			validator: { $jsonSchema: definition.schema },
			validationLevel: "moderate",
			validationAction: "error",
		} satisfies CreateCollectionOptions;

		try {
			await db.createCollection(definition.name, options);
		} catch (error) {
			if (!isNamespaceExistsError(error)) throw error;
			await db.command({ collMod: definition.name, ...options });
		}

		if (definition.indexes.length) {
			await db.collection(definition.name).createIndexes(definition.indexes);
		}
	}
}
