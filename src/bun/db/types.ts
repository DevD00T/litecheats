import type { UserRole, WhatsAppOtpPurpose } from "../../../shared/auth";
import type {
	BillingCycle,
	BillingMode,
	BillingPlanId,
	BillingSubscriptionStatus,
	WalletPaymentMode,
	WalletTransactionType,
} from "../../../shared/billing";
import type { ReleaseFormat, ReleasePlatform } from "../../../shared/releases";

export type { UserRole };

// Documents are stored exactly as declared here: `_id` is a string (UUID) on every
// collection that has its own identity, and every timestamp is a BSON Date.
// The identity alias keeps every call site that names WithId<X> unchanged.
export type WithId<T> = T;

export interface UserDocument {
	_id: string;
	email: string;
	emailLower: string;
	fullName: string;
	company: string;
	roles?: unknown;
	isAdmin?: unknown;
	isOwner?: unknown;
	emailVerified?: unknown;
	/** Validated app origin this account last signed in from, or null. */
	preferredOrigin?: string | null;
	/** WhatsApp number, digits only with country code (e.g. "919876543210"), or null. */
	phone?: string | null;
	phoneVerified?: unknown;
	/** Null for accounts created through WhatsApp: they have no password to check. */
	passwordHash: string | null;
	createdAt: Date;
	updatedAt: Date;
}

/**
 * One delivery from the WhatsApp gateway's webhook, kept as sent. `_id` is the
 * SHA-256 of the raw body, so a redelivery of the same event is stored once.
 */
export interface WhatsAppWebhookEventDocument {
	_id: string;
	event: string;
	sessionId: string | null;
	occurredAt: Date | null;
	receivedAt: Date;
	data: unknown;
}

/**
 * A WhatsApp code we asked the provider to send. The provider holds the code
 * itself; this record is what lets us bound guesses and resends per number, and
 * refuse a verify for a number we never sent to. `_id` in storage is the phone.
 */
export interface WhatsAppOtpChallengeRecord {
	phone: string;
	purpose: WhatsAppOtpPurpose;
	attempts: number;
	lastSentAt: Date;
	expiresAt: Date;
	createdAt: Date;
}

/** Legacy click-through verification link. `_id` in storage is the token. */
export interface EmailVerificationRecord {
	token: string;
	userId: string;
	expiresAt: Date;
	createdAt: Date;
}

/** Signup verification code. `_id` in storage is the user id, so one live code per account. */
export interface EmailVerificationCodeRecord {
	userId: string;
	codeHash: string;
	expiresAt: Date;
	attempts: number;
	lastSentAt: Date;
	createdAt: Date;
}

export interface SessionDocument {
	_id: string;
	userId: string;
	userAgent: string;
	ipAddress: string;
	deviceKey: string;
	createdAt: Date;
	updatedAt: Date;
	expiresAt: Date;
}

export interface ReleaseVersionDocument {
	_id: string;
	version: string;
	notes: string;
	publishedAt: Date;
	isLatest: boolean;
	createdAt: Date;
	updatedAt: Date;
}

/** Artifact metadata. The binary lives in GridFS under the same `_id`. */
export interface ReleaseArtifactDocument {
	_id: string;
	releaseId: string;
	version: string;
	platform: ReleasePlatform;
	format: ReleaseFormat;
	target: string;
	filename: string;
	sizeBytes: number;
	sha256: string;
	mimeType: string;
	createdAt: Date;
}

export interface TelegramAdminDocument {
	_id: string;
	username: string;
	usernameLower: string;
	role: "admin" | "owner";
	/** Private-chat id, or null until this admin has messaged the bot. */
	chatId: number | null;
	addedByTelegramId: number | null;
	addedByUsername: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface BillingSubscriptionDocument {
	_id: string;
	userId: string;
	planId: BillingPlanId;
	planName: string;
	cycle: BillingCycle;
	quantity: number;
	mode: BillingMode;
	status: BillingSubscriptionStatus;
	/** Total charged for the term, in paise, tax included. */
	amount: number;
	currency: string;
	razorpayOrderId: string | null;
	razorpaySubscriptionId: string | null;
	razorpayPaymentId: string | null;
	shortUrl: string | null;
	currentPeriodStart: Date | null;
	currentPeriodEnd: Date | null;
	cancelAtPeriodEnd: boolean;
	/** Short human-quotable id, e.g. LC-SUB-7QK3M2AD. */
	privateId: string;
	notes: string;
	/** Period end the renewal warning was last sent for, so it goes out once. */
	renewalWarningSentFor: Date | null;
	/** Set once admins have been told about this order, so it is announced once. */
	adminNotifiedAt?: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface BillingPaymentDocument {
	_id: string;
	userId: string;
	subscriptionId: string | null;
	razorpayPaymentId: string | null;
	razorpayOrderId: string | null;
	planId: string;
	amount: number;
	currency: string;
	status: string;
	method: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface BillingSubscriptionWithOwner {
	subscription: WithId<BillingSubscriptionDocument>;
	userEmail: string;
	userFullName: string;
	paymentCount: number;
}

export interface BillingTotals {
	totalOrders: number;
	activeOrders: number;
	capturedRevenue: number;
}

/** Prepaid wallet. `_id` in storage is the user id, so every account has at most one. */
export interface WalletDocument {
	userId: string;
	balance: number;
	currency: string;
	autoRenew: boolean;
	paymentMode: WalletPaymentMode;
	createdAt: Date;
	updatedAt: Date;
}

export interface WalletTransactionDocument {
	_id: string;
	userId: string;
	type: WalletTransactionType;
	amount: number;
	balanceAfter: number;
	reason: string;
	referenceId: string | null;
	createdAt: Date;
}

export interface WalletTopupDocument {
	_id: string;
	userId: string;
	amount: number;
	razorpayOrderId: string | null;
	razorpayPaymentId: string | null;
	status: "created" | "paid" | "failed";
	createdAt: Date;
	updatedAt: Date;
}
