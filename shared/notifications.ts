import { AUTH_ADMIN_BASE_PATH, AUTH_BASE_PATH } from "./auth";

/**
 * Notifications admins and owners send to users. Each send is a campaign; every
 * recipient gets their own copy with placeholders already filled in, which the
 * Android app shows as a system notification and the website in its inbox.
 */
export const MY_NOTIFICATIONS_PATH = `${AUTH_BASE_PATH}/me/notifications`;
export const ADMIN_NOTIFICATIONS_PATH = `${AUTH_ADMIN_BASE_PATH}/notifications`;

export const NOTIFICATION_CATEGORIES = [
	"announcement",
	"offer",
	"order",
	"update",
	"custom",
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
	announcement: "Announcement",
	offer: "Offer",
	order: "Order update",
	update: "App update",
	custom: "Custom",
};

/**
 * Who a notification goes to.
 * - all:         every account
 * - app:         accounts with the Android app installed (a device record exists)
 * - online:      active in the last few minutes, in the app or on the website
 * - online_app:  the app is open right now (or was in the last few minutes)
 * - users:       hand-picked accounts (owners only)
 */
export const NOTIFICATION_AUDIENCES = ["all", "app", "online", "online_app", "users"] as const;
export type NotificationAudienceType = (typeof NOTIFICATION_AUDIENCES)[number];

export const NOTIFICATION_AUDIENCE_LABELS: Record<NotificationAudienceType, string> = {
	all: "Everyone",
	app: "Users with the app installed",
	online: "Online now (app or website)",
	online_app: "Using the app right now",
	users: "Selected users",
};

export interface NotificationAudience {
	type: NotificationAudienceType;
	/** Only for type "users". */
	userIds?: string[];
}

/** Placeholders filled per recipient when a notification is sent. */
export const NOTIFICATION_PLACEHOLDERS = [
	{ key: "firstName", description: "First name" },
	{ key: "fullName", description: "Full name" },
	{ key: "company", description: "Company" },
	{ key: "email", description: "Email" },
	{ key: "planName", description: "Latest order's plan" },
	{ key: "orderId", description: "Latest order's private id, e.g. LC-SUB-7QK3M2AD" },
	{ key: "orderStatus", description: "Latest order's status" },
] as const;

export const NOTIFICATION_TITLE_MAX = 120;
export const NOTIFICATION_BODY_MAX = 1000;

export interface UserNotification {
	id: string;
	category: NotificationCategory;
	title: string;
	body: string;
	/** An in-app path like /pricing, or an https:// URL. Null when there's nothing to open. */
	link: string | null;
	createdAt: string;
	readAt: string | null;
}

export interface MyNotificationsResponse {
	notifications: UserNotification[];
	unread: number;
}

export interface NotificationTemplate {
	id: string;
	name: string;
	category: NotificationCategory;
	title: string;
	body: string;
	link: string | null;
	createdBy: string;
	createdAt: string;
	updatedAt: string;
}

export interface NotificationTemplatesResponse {
	templates: NotificationTemplate[];
}

export interface UpsertNotificationTemplatePayload {
	name: string;
	category: NotificationCategory;
	title: string;
	body: string;
	link?: string | null;
}

export interface SendNotificationPayload {
	category: NotificationCategory;
	title: string;
	body: string;
	link?: string | null;
	audience: NotificationAudience;
	/** Set when sent from a template. Admins may only send templates; owners may send anything. */
	templateId?: string | null;
}

export interface AudiencePreviewResponse {
	count: number;
	/** A few recipients' emails, to sanity-check the selection. */
	sample: string[];
}

export interface NotificationCampaign {
	id: string;
	category: NotificationCategory;
	title: string;
	body: string;
	link: string | null;
	audience: NotificationAudience;
	templateId: string | null;
	recipientCount: number;
	deliveredCount: number;
	readCount: number;
	sentBy: string;
	/** "manual" for admin sends, "order-status" for the automatic order updates. */
	source: "manual" | "order-status";
	createdAt: string;
}

export interface NotificationCampaignsResponse {
	campaigns: NotificationCampaign[];
}

export interface SendNotificationResponse {
	campaign: NotificationCampaign;
}
