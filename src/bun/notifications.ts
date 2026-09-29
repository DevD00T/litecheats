import { randomUUID } from "node:crypto";
import {
	NOTIFICATION_AUDIENCES,
	NOTIFICATION_BODY_MAX,
	NOTIFICATION_CATEGORIES,
	NOTIFICATION_TITLE_MAX,
	type NotificationAudience,
	type NotificationCampaign,
	type NotificationCategory,
	type NotificationTemplate,
	type SendNotificationPayload,
	type UpsertNotificationTemplatePayload,
	type UserNotification,
} from "../../shared/notifications";
import {
	type BillingSubscriptionDocument,
	COLLECTIONS,
	type NotificationCampaignDocument,
	type NotificationDocument,
	type NotificationTemplateDocument,
	type UserDocument,
	type WithId,
	campaignStats,
	collection,
	countNotificationTemplates,
	countUnreadNotifications,
	findLatestBillingSubscriptionForUser,
	findNotificationTemplate,
	getDb,
	insertNotificationCampaign,
	insertNotificationTemplates,
	insertNotifications,
	listAllUserIds,
	listNotificationCampaigns,
	listNotificationTemplates,
	listNotificationsForUser,
	listUserIdsWithDevices,
	listUserIdsWithSessionActivitySince,
	markNotificationsDelivered,
	replaceNotificationTemplate,
	touchUserDevice,
} from "./db";

export class NotificationError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

/** The app polls about every 45 s while open, so 3 minutes means "open right now". */
const APP_ONLINE_WINDOW_MS = 3 * 60 * 1000;
/** Website sessions are refreshed every 5 minutes of activity. */
const WEB_ONLINE_WINDOW_MS = 10 * 60 * 1000;
const MAX_RECIPIENTS = 20_000;
const MAX_SELECTED_USERS = 1_000;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

// ─── Parsing ────────────────────────────────────────────────────────────────

function text(value: unknown, field: string, max: number, required = true): string {
	if (value === undefined || value === null) {
		if (required) throw new NotificationError(400, `${field} is required.`);
		return "";
	}
	if (typeof value !== "string") throw new NotificationError(400, `${field} must be text.`);
	const trimmed = value.trim();
	if (required && !trimmed) throw new NotificationError(400, `${field} is required.`);
	if (trimmed.length > max)
		throw new NotificationError(400, `${field} is longer than ${max} characters.`);
	return trimmed;
}

function category(value: unknown): NotificationCategory {
	if (!(NOTIFICATION_CATEGORIES as readonly unknown[]).includes(value)) {
		throw new NotificationError(400, "Unknown notification category.");
	}
	return value as NotificationCategory;
}

/** An in-app path (/pricing) or an https:// link; anything else is refused. */
function link(value: unknown): string | null {
	if (value === undefined || value === null || value === "") return null;
	const raw = text(value, "link", 500);
	if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
	try {
		const url = new URL(raw);
		if (url.protocol === "https:") return url.toString();
	} catch {
		// fall through
	}
	throw new NotificationError(400, "link must be an in-app path like /pricing or an https:// URL.");
}

function audience(value: unknown): NotificationAudience {
	if (!value || typeof value !== "object")
		throw new NotificationError(400, "audience is required.");
	const body = value as Record<string, unknown>;
	if (!(NOTIFICATION_AUDIENCES as readonly unknown[]).includes(body.type)) {
		throw new NotificationError(400, "Unknown audience.");
	}
	const type = body.type as NotificationAudience["type"];
	if (type !== "users") return { type };
	if (!Array.isArray(body.userIds) || !body.userIds.length) {
		throw new NotificationError(400, "Pick at least one user.");
	}
	if (body.userIds.length > MAX_SELECTED_USERS) {
		throw new NotificationError(400, `Pick at most ${MAX_SELECTED_USERS} users.`);
	}
	const userIds = [...new Set(body.userIds.map((id) => text(id, "userIds[]", 80)))];
	return { type, userIds };
}

export function parseTemplatePayload(raw: unknown): UpsertNotificationTemplatePayload {
	if (!raw || typeof raw !== "object") throw new NotificationError(400, "Invalid payload.");
	const body = raw as Record<string, unknown>;
	return {
		name: text(body.name, "name", 80),
		category: category(body.category),
		title: text(body.title, "title", NOTIFICATION_TITLE_MAX),
		body: text(body.body, "body", NOTIFICATION_BODY_MAX),
		link: link(body.link),
	};
}

export function parseSendPayload(raw: unknown): SendNotificationPayload {
	if (!raw || typeof raw !== "object") throw new NotificationError(400, "Invalid payload.");
	const body = raw as Record<string, unknown>;
	return {
		category: category(body.category),
		title: text(body.title, "title", NOTIFICATION_TITLE_MAX),
		body: text(body.body, "body", NOTIFICATION_BODY_MAX),
		link: link(body.link),
		audience: audience(body.audience),
		templateId: body.templateId ? text(body.templateId, "templateId", 80) : null,
	};
}

export function parseNotificationDeviceId(value: string | null): string | null {
	return value && DEVICE_ID_PATTERN.test(value) ? value : null;
}

// ─── Placeholders ───────────────────────────────────────────────────────────

type Vars = Record<string, string>;

export function renderPlaceholders(template: string, vars: Vars): string {
	return template.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (_, key: string) => vars[key] ?? "");
}

function needsOrderVars(...texts: string[]): boolean {
	return texts.some((value) => /\{\{\s*(planName|orderId|orderStatus)\s*\}\}/.test(value));
}

function userVars(
	user: WithId<UserDocument>,
	order: WithId<BillingSubscriptionDocument> | null,
): Vars {
	const fullName = user.fullName?.trim() || user.email;
	return {
		firstName: fullName.split(/\s+/)[0] ?? fullName,
		fullName,
		company: user.company ?? "",
		email: user.email,
		planName: order?.planName ?? "your plan",
		orderId: order?.privateId ?? "",
		orderStatus: order?.status ?? "",
	};
}

// ─── Summaries ──────────────────────────────────────────────────────────────

export function toUserNotification(doc: WithId<NotificationDocument>): UserNotification {
	return {
		id: doc._id,
		category: doc.category,
		title: doc.title,
		body: doc.body,
		link: doc.link,
		createdAt: doc.createdAt.toISOString(),
		readAt: doc.readAt?.toISOString() ?? null,
	};
}

function toTemplate(doc: WithId<NotificationTemplateDocument>): NotificationTemplate {
	return {
		id: doc._id,
		name: doc.name,
		category: doc.category,
		title: doc.title,
		body: doc.body,
		link: doc.link,
		createdBy: doc.createdBy,
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
	};
}

function toCampaign(
	doc: WithId<NotificationCampaignDocument>,
	stats: { delivered: number; read: number } | undefined,
): NotificationCampaign {
	return {
		id: doc._id,
		category: doc.category,
		title: doc.title,
		body: doc.body,
		link: doc.link,
		audience: doc.audience,
		templateId: doc.templateId,
		recipientCount: doc.recipientCount,
		deliveredCount: stats?.delivered ?? 0,
		readCount: stats?.read ?? 0,
		sentBy: doc.sentBy,
		source: doc.source,
		createdAt: doc.createdAt.toISOString(),
	};
}

// ─── Templates ──────────────────────────────────────────────────────────────

const STARTER_TEMPLATES: Omit<NotificationTemplateDocument, "_id" | "createdAt" | "updatedAt">[] = [
	{
		name: "Limited-time offer",
		category: "offer",
		title: "An offer for {{company}}",
		body: "Hi {{firstName}}, for the next 7 days you get 20% off the Institution plan. Tap to see pricing.",
		link: "/pricing",
		createdBy: "Litecheats",
	},
	{
		name: "Order update",
		category: "order",
		title: "Order {{orderId}}: {{orderStatus}}",
		body: "Hi {{firstName}}, your {{planName}} order is now {{orderStatus}}. Tap to see your billing.",
		link: "/billing",
		createdBy: "Litecheats",
	},
	{
		name: "New app version",
		category: "update",
		title: "A new Litecheats app is ready",
		body: "Hi {{firstName}}, a new version of the Litecheats app is available with fixes and improvements.",
		link: "/downloads?tab=android",
		createdBy: "Litecheats",
	},
	{
		name: "Announcement",
		category: "announcement",
		title: "News from Litecheats",
		body: "Hi {{firstName}}, here is what's new at Litecheats this month.",
		link: null,
		createdBy: "Litecheats",
	},
];

/** A fresh database gets a few starter templates to edit. */
async function ensureStarterTemplates(): Promise<void> {
	if ((await countNotificationTemplates()) > 0) return;
	const now = new Date();
	await insertNotificationTemplates(
		STARTER_TEMPLATES.map((template) => ({
			...template,
			_id: randomUUID(),
			createdAt: now,
			updatedAt: now,
		})),
	);
}

export async function listTemplates(): Promise<NotificationTemplate[]> {
	await getDb();
	await ensureStarterTemplates();
	return (await listNotificationTemplates()).map(toTemplate);
}

export async function saveTemplate(
	id: string | null,
	payload: UpsertNotificationTemplatePayload,
	editor: string,
): Promise<void> {
	await getDb();
	const now = new Date();
	if (id) {
		const existing = await findNotificationTemplate(id);
		if (!existing) throw new NotificationError(404, "Template not found.");
		await replaceNotificationTemplate({
			...existing,
			name: payload.name,
			category: payload.category,
			title: payload.title,
			body: payload.body,
			link: payload.link ?? null,
			updatedAt: now,
		});
		return;
	}
	await insertNotificationTemplates([
		{
			_id: randomUUID(),
			name: payload.name,
			category: payload.category,
			title: payload.title,
			body: payload.body,
			link: payload.link ?? null,
			createdBy: editor,
			createdAt: now,
			updatedAt: now,
		},
	]);
}

// ─── Audience ───────────────────────────────────────────────────────────────

export async function resolveAudience(
	target: NotificationAudience,
	now = new Date(),
): Promise<string[]> {
	await getDb();
	switch (target.type) {
		case "all":
			return listAllUserIds();
		case "app":
			return listUserIdsWithDevices();
		case "online_app":
			return listUserIdsWithDevices(new Date(now.getTime() - APP_ONLINE_WINDOW_MS));
		case "online": {
			const [app, web] = await Promise.all([
				listUserIdsWithDevices(new Date(now.getTime() - APP_ONLINE_WINDOW_MS)),
				listUserIdsWithSessionActivitySince(new Date(now.getTime() - WEB_ONLINE_WINDOW_MS)),
			]);
			return [...new Set([...app, ...web])];
		}
		case "users": {
			const users = await collection<UserDocument>(COLLECTIONS.users);
			const found = await users
				.find({ _id: { $in: target.userIds ?? [] } }, { projection: { _id: 1 } })
				.toArray();
			return found.map((user) => user._id);
		}
	}
}

export async function previewAudience(
	target: NotificationAudience,
): Promise<{ count: number; sample: string[] }> {
	const ids = await resolveAudience(target);
	const users = await collection<UserDocument>(COLLECTIONS.users);
	const sample = await users
		.find({ _id: { $in: ids.slice(0, 5) } }, { projection: { email: 1 } })
		.toArray();
	return { count: ids.length, sample: sample.map((user) => user.email) };
}

// ─── Sending ────────────────────────────────────────────────────────────────

interface SendOptions {
	sentBy: string;
	/** Owners may send custom messages and pick users; admins send templates to groups. */
	isOwner: boolean;
	source?: "manual" | "order-status";
	/** Skip the owner checks (system-generated order updates). */
	system?: boolean;
}

export async function sendNotification(
	payload: SendNotificationPayload,
	options: SendOptions,
): Promise<NotificationCampaign> {
	// Permissions first: a refused request never touches the database.
	if (!options.system && !options.isOwner) {
		if (payload.audience.type === "users") {
			throw new NotificationError(403, "Only owners can send to hand-picked users.");
		}
		if (!payload.templateId) {
			throw new NotificationError(
				403,
				"Admins send from a template; only owners can write custom notifications.",
			);
		}
	}

	await getDb();
	let content = {
		category: payload.category,
		title: payload.title,
		body: payload.body,
		link: payload.link ?? null,
	};
	if (payload.templateId) {
		const template = await findNotificationTemplate(payload.templateId);
		if (!template) throw new NotificationError(404, "Template not found.");
		if (!options.system && !options.isOwner) {
			// Admins send the template as written.
			content = {
				category: template.category,
				title: template.title,
				body: template.body,
				link: template.link,
			};
		}
	}

	const recipients = await resolveAudience(payload.audience);
	if (!recipients.length)
		throw new NotificationError(400, "No users match this audience right now.");
	if (recipients.length > MAX_RECIPIENTS) {
		throw new NotificationError(
			400,
			`That's ${recipients.length} users; send to at most ${MAX_RECIPIENTS} at once.`,
		);
	}

	const users = await (await collection<UserDocument>(COLLECTIONS.users))
		.find({ _id: { $in: recipients } })
		.toArray();
	const withOrders = needsOrderVars(content.title, content.body);
	const now = new Date();
	const campaignId = randomUUID();

	const docs: WithId<NotificationDocument>[] = [];
	for (const user of users) {
		const order = withOrders ? await findLatestBillingSubscriptionForUser(user._id) : null;
		const vars = userVars(user, order);
		docs.push({
			_id: randomUUID(),
			userId: user._id,
			campaignId,
			category: content.category,
			title: renderPlaceholders(content.title, vars).slice(0, NOTIFICATION_TITLE_MAX),
			body: renderPlaceholders(content.body, vars).slice(0, NOTIFICATION_BODY_MAX),
			link: content.link,
			createdAt: now,
			deliveredAt: null,
			readAt: null,
		});
	}

	const campaign: WithId<NotificationCampaignDocument> = {
		_id: campaignId,
		...content,
		audience: payload.audience,
		templateId: payload.templateId ?? null,
		recipientCount: docs.length,
		sentBy: options.sentBy,
		source: options.source ?? "manual",
		createdAt: now,
	};
	await insertNotificationCampaign(campaign);
	await insertNotifications(docs);
	return toCampaign(campaign, { delivered: 0, read: 0 });
}

/** Automatic "order update" when an admin changes an order's status. Never throws. */
export async function notifyOrderStatusChanged(
	order: WithId<BillingSubscriptionDocument>,
	newStatus: string,
): Promise<void> {
	try {
		await sendNotification(
			{
				category: "order",
				title: `Order ${order.privateId}: ${newStatus}`,
				body: `Hi {{firstName}}, your ${order.planName} order ${order.privateId} is now ${newStatus}.`,
				link: "/billing",
				audience: { type: "users", userIds: [order.userId] },
				templateId: null,
			},
			{ sentBy: "system", isOwner: true, system: true, source: "order-status" },
		);
	} catch (error) {
		console.warn(
			"[notifications] order update not sent:",
			error instanceof Error ? error.message : error,
		);
	}
}

export async function listCampaigns(limit = 50): Promise<NotificationCampaign[]> {
	await getDb();
	const docs = await listNotificationCampaigns(limit);
	const stats = await campaignStats(docs.map((doc) => doc._id));
	return docs.map((doc) => toCampaign(doc, stats.get(doc._id)));
}

// ─── A user's inbox ─────────────────────────────────────────────────────────

/**
 * What the app or website shows. Fetching marks the returned notifications as
 * delivered and, when the app sends its device id, marks that device as online.
 */
export async function fetchMyNotifications(
	userId: string,
	deviceId: string | null,
	limit: number,
): Promise<{ notifications: UserNotification[]; unread: number }> {
	await getDb();
	const now = new Date();
	if (deviceId) await touchUserDevice(userId, deviceId, now);
	const docs = await listNotificationsForUser(userId, Math.min(Math.max(limit, 1), 100));
	await markNotificationsDelivered(
		userId,
		docs.filter((doc) => !doc.deliveredAt).map((doc) => doc._id),
		now,
	);
	return {
		notifications: docs.map(toUserNotification),
		unread: await countUnreadNotifications(userId),
	};
}
