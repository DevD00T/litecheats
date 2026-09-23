/**
 * End-to-end tests for WhatsApp signup and sign-in, through the real request
 * handler and a real (throwaway) database. Only the gateway is fake, so no
 * WhatsApp message is ever sent. Skipped when MONGODB_URI is not set.
 *
 *   bun test src/bun/whatsapp-auth.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import type { WhatsAppOtpClient, WhatsAppOtpResult } from "./whatsapp-otp";

const TEST_DB_PREFIX = "lcpwa_wa_";
const TEST_DB_NAME = `${TEST_DB_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const hasCluster = Boolean(Bun.env.MONGODB_URI);
const suite = hasCluster ? describe : describe.skip;
const WEBHOOK_SECRET = "test-webhook-secret";

/** Scriptable stand-in for the gateway. The correct code is always "123456". */
const gateway = {
	configured: true,
	sends: [] as string[],
	verifies: [] as { phone: string; code: string }[],
	sendResult: { ok: true } as WhatsAppOtpResult,
	/** When set, overrides the "123456 is right" rule for the next verify calls. */
	verifyOverride: null as WhatsAppOtpResult | null,
};

const fakeClient: WhatsAppOtpClient = {
	get configured() {
		return gateway.configured;
	},
	async sendCode(phone) {
		gateway.sends.push(phone);
		return gateway.sendResult;
	},
	async verifyCode(phone, code) {
		gateway.verifies.push({ phone, code });
		if (gateway.verifyOverride) return gateway.verifyOverride;
		return code === "123456"
			? { ok: true }
			: { ok: false, reason: "rejected", detail: "Invalid OTP" };
	},
};

type Handler = (request: Request) => Promise<Response>;
let handle: Handler;
let db: typeof import("./db");
const previousEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
	if (!hasCluster) return;
	for (const key of [
		"MONGODB_DB_NAME",
		"OWNER_EMAIL",
		"OWNER_PASSWORD",
		"RESEND_API_KEY",
		"TELEGRAM_BOT_ENABLED",
		"BOT_TOKEN",
		"WHATSAPP_WEBHOOK_SECRET",
		"WHATSAPP_WEBHOOK_SECRETS",
	]) {
		previousEnv[key] = Bun.env[key];
	}
	// A connection.update alerts admins on Telegram; tests must never message anyone.
	Bun.env.TELEGRAM_BOT_ENABLED = "false";
	Bun.env.BOT_TOKEN = "";
	Bun.env.WHATSAPP_WEBHOOK_SECRET = WEBHOOK_SECRET;
	Bun.env.WHATSAPP_WEBHOOK_SECRETS = "";
	// Read lazily by the client, so setting them before first use is enough.
	Bun.env.MONGODB_DB_NAME = TEST_DB_NAME;
	Bun.env.OWNER_EMAIL = "owner-test@example.com";
	Bun.env.OWNER_PASSWORD = "test-owner-password";
	// email.ts reads this at import: unset, it logs instead of mailing anyone.
	Bun.env.RESEND_API_KEY = "";

	db = await import("./db");
	await db.closeDb(); // Drop any connection an earlier test file left to its own database.
	const otp = await import("./whatsapp-otp");
	otp.setWhatsAppOtpClientForTests(fakeClient);
	handle = (await import("./auth-server")).handleAuthApiRequest;
});

afterAll(async () => {
	if (!hasCluster) return;
	const handleDb = await db.getDb();
	if (handleDb.databaseName === TEST_DB_NAME && TEST_DB_NAME.startsWith(TEST_DB_PREFIX)) {
		await handleDb.dropDatabase();
	}
	await db.closeDb();
	(await import("./whatsapp-otp")).setWhatsAppOtpClientForTests(null);
	for (const [key, value] of Object.entries(previousEnv)) {
		if (value === undefined) delete Bun.env[key];
		else Bun.env[key] = value;
	}
});

/** A fresh client identity per test, so per-IP rate limits never interfere. */
function makeVisitor() {
	const ip = `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 250)).join(".")}`;
	let cookie = "";

	const send = async (method: string, path: string, body?: unknown) => {
		const headers = new Headers({
			"user-agent": "whatsapp-auth-test",
			"x-forwarded-for": ip,
		});
		if (body !== undefined) headers.set("content-type", "application/json");
		if (cookie) headers.set("cookie", cookie);

		const response = await handle(
			new Request(`http://localhost${path}`, {
				method,
				headers,
				body: body === undefined ? undefined : JSON.stringify(body),
			}),
		);
		const setCookie = response.headers.get("set-cookie");
		if (setCookie) cookie = setCookie.split(";")[0] ?? "";
		const text = await response.text();
		return { status: response.status, body: text ? JSON.parse(text) : null };
	};

	return { send, hasCookie: () => cookie.length > 0 };
}

const randomPhone = () => `91${String(7_000_000_000 + Math.floor(Math.random() * 2e9))}`;
const signupDetails = (phone: string) => {
	const id = crypto.randomUUID().slice(0, 8);
	return {
		phone,
		fullName: "WhatsApp Tester",
		company: "Test Co",
		email: `wa-${id}@example.com`,
	};
};

function resetGateway() {
	gateway.configured = true;
	gateway.sends = [];
	gateway.verifies = [];
	gateway.sendResult = { ok: true };
	gateway.verifyOverride = null;
}

suite("WhatsApp signup", () => {
	test("sends a code, then creates a passwordless account and signs it in", async () => {
		resetGateway();
		const visitor = makeVisitor();
		const phone = randomPhone();
		const details = { ...signupDetails(phone), phone: `+91 ${phone.slice(2)}` };

		const sent = await visitor.send("POST", "/login/signup/whatsapp/send", details);
		expect(sent.status).toBe(200);
		expect(sent.body).toMatchObject({ sent: true, phone, retryAfterSeconds: 60 });
		expect(gateway.sends).toEqual([phone]);

		const wrong = await visitor.send("POST", "/login/signup/whatsapp", {
			...details,
			code: "000000",
		});
		expect(wrong.status).toBe(400);
		expect(wrong.body.error).toContain("4 attempts left");
		expect(await db.findUserByPhone(phone)).toBeNull();

		const created = await visitor.send("POST", "/login/signup/whatsapp", {
			...details,
			code: "123 456",
		});
		expect(created.status).toBe(201);
		expect(created.body.user).toMatchObject({
			email: details.email,
			phone,
			phoneVerified: true,
			hasPassword: false,
			emailVerified: false,
		});
		expect(visitor.hasCookie()).toBe(true);

		const saved = await db.findUserByPhone(phone);
		expect(saved?.passwordHash).toBeNull();
		expect(saved?.fullName).toBe("WhatsApp Tester");
		// The code is spent: a replay cannot be used again.
		expect(await db.findWhatsAppOtpChallenge(phone)).toBeNull();

		const session = await visitor.send("GET", "/login/session");
		expect(session.body).toMatchObject({ authenticated: true, user: { phone } });

		// Receipts go to the email, so its own verification code is issued too.
		expect(await db.findEmailVerificationCode(created.body.user.id)).not.toBeNull();
	});

	test("refuses a number or email that is already registered, before sending anything", async () => {
		resetGateway();
		const phone = randomPhone();
		const details = signupDetails(phone);
		const first = makeVisitor();
		await first.send("POST", "/login/signup/whatsapp/send", details);
		expect(
			(await first.send("POST", "/login/signup/whatsapp", { ...details, code: "123456" })).status,
		).toBe(201);
		gateway.sends = [];

		const again = makeVisitor();
		const sameNumber = await again.send("POST", "/login/signup/whatsapp/send", {
			...signupDetails(phone),
		});
		expect(sameNumber.status).toBe(409);

		const sameEmail = await again.send("POST", "/login/signup/whatsapp/send", {
			...details,
			phone: randomPhone(),
		});
		expect(sameEmail.status).toBe(409);
		expect(gateway.sends).toEqual([]);
	});

	test("rejects bad input without calling the gateway", async () => {
		resetGateway();
		const visitor = makeVisitor();
		const badPhone = await visitor.send("POST", "/login/signup/whatsapp/send", {
			...signupDetails("12"),
		});
		expect(badPhone.status).toBe(400);

		const badEmail = await visitor.send("POST", "/login/signup/whatsapp/send", {
			...signupDetails(randomPhone()),
			email: "not-an-email",
		});
		expect(badEmail.status).toBe(400);
		expect(gateway.sends).toEqual([]);
	});

	test("a verify with no code sent first is refused", async () => {
		resetGateway();
		const visitor = makeVisitor();
		const response = await visitor.send("POST", "/login/signup/whatsapp", {
			...signupDetails(randomPhone()),
			code: "123456",
		});
		expect(response.status).toBe(400);
		expect(response.body.error).toContain("Request a new code");
		expect(gateway.verifies).toEqual([]);
	});
});

suite("WhatsApp sign-in", () => {
	async function registeredPhone(): Promise<string> {
		const phone = randomPhone();
		const details = signupDetails(phone);
		const visitor = makeVisitor();
		await visitor.send("POST", "/login/signup/whatsapp/send", details);
		await visitor.send("POST", "/login/signup/whatsapp", { ...details, code: "123456" });
		// The signup code went out moments ago; let the resend cooldown pass.
		await (await db.getDb())
			.collection("whatsapp_otp_challenges")
			.deleteOne({ _id: phone as never });
		return phone;
	}

	test("signs a saved account in with a code", async () => {
		resetGateway();
		const phone = await registeredPhone();
		const visitor = makeVisitor();

		const sent = await visitor.send("POST", "/login/whatsapp/send", { phone: phone.slice(2) });
		expect(sent.status).toBe(200);
		expect(sent.body.phone).toBe(phone);

		const signedIn = await visitor.send("POST", "/login/whatsapp", { phone, code: "123456" });
		expect(signedIn.status).toBe(200);
		expect(signedIn.body.user.phone).toBe(phone);
		expect((await visitor.send("GET", "/login/session")).body.authenticated).toBe(true);
	});

	test("an unknown number gets a clear 404 and no message is sent", async () => {
		resetGateway();
		const visitor = makeVisitor();
		const response = await visitor.send("POST", "/login/whatsapp/send", { phone: randomPhone() });
		expect(response.status).toBe(404);
		expect(gateway.sends).toEqual([]);
	});

	test("a second code inside the cooldown is refused", async () => {
		resetGateway();
		const phone = await registeredPhone();
		const visitor = makeVisitor();
		expect((await visitor.send("POST", "/login/whatsapp/send", { phone })).status).toBe(200);
		const again = await visitor.send("POST", "/login/whatsapp/send", { phone });
		expect(again.status).toBe(429);
		expect(gateway.sends.filter((sent) => sent === phone)).toHaveLength(2); // signup + first login
	});

	test("five wrong codes burn the challenge", async () => {
		resetGateway();
		const phone = await registeredPhone();
		const visitor = makeVisitor();
		await visitor.send("POST", "/login/whatsapp/send", { phone });

		for (let attempt = 1; attempt <= 4; attempt++) {
			const wrong = await visitor.send("POST", "/login/whatsapp", { phone, code: "000000" });
			expect(wrong.status).toBe(400);
		}
		const last = await visitor.send("POST", "/login/whatsapp", { phone, code: "000000" });
		expect(last.status).toBe(429);

		// Even the right code is refused now: a new one must be requested.
		const late = await visitor.send("POST", "/login/whatsapp", { phone, code: "123456" });
		expect(late.status).toBe(400);
		expect(late.body.error).toContain("Request a new code");
	});

	test("a gateway outage returns 503 and does not cost the user a guess", async () => {
		resetGateway();
		const phone = await registeredPhone();
		const visitor = makeVisitor();
		await visitor.send("POST", "/login/whatsapp/send", { phone });

		gateway.verifyOverride = { ok: false, reason: "unavailable", detail: "tunnel down" };
		const outage = await visitor.send("POST", "/login/whatsapp", { phone, code: "123456" });
		expect(outage.status).toBe(503);
		expect((await db.findWhatsAppOtpChallenge(phone))?.attempts).toBe(0);

		gateway.verifyOverride = null;
		const recovered = await visitor.send("POST", "/login/whatsapp", { phone, code: "123456" });
		expect(recovered.status).toBe(200);
	});

	test("a WhatsApp account cannot be opened with the email and password form", async () => {
		resetGateway();
		const phone = randomPhone();
		const details = signupDetails(phone);
		const visitor = makeVisitor();
		await visitor.send("POST", "/login/signup/whatsapp/send", details);
		await visitor.send("POST", "/login/signup/whatsapp", { ...details, code: "123456" });

		const other = makeVisitor();
		const response = await other.send("POST", "/login", {
			email: details.email,
			password: "anything-at-all-1!",
		});
		expect(response.status).toBe(401);
		expect(response.body.error).toContain("WhatsApp");
		expect(other.hasCookie()).toBe(false);
	});

	test("with no gateway configured, WhatsApp answers 503", async () => {
		resetGateway();
		gateway.configured = false;
		const visitor = makeVisitor();
		const response = await visitor.send("POST", "/login/whatsapp/send", { phone: randomPhone() });
		expect(response.status).toBe(503);
	});
});

suite("WhatsApp webhook", () => {
	const sessionId = `sess-${crypto.randomUUID().slice(0, 8)}`;

	async function deliver(payload: unknown, options: { secret?: string | null } = {}) {
		const body = JSON.stringify(payload);
		const headers = new Headers({ "content-type": "application/json" });
		const secret = options.secret === undefined ? WEBHOOK_SECRET : options.secret;
		if (secret) {
			const digest = createHmac("sha256", secret).update(body).digest("hex");
			headers.set("x-webhook-signature", `sha256=${digest}`);
		}
		const response = await handle(
			new Request("http://localhost/whatsapp/webhook", { method: "POST", headers, body }),
		);
		return { status: response.status, body: await response.json() };
	}

	const received = (content: string) => ({
		event: "message.received",
		sessionId,
		timestamp: new Date().toISOString(),
		data: {
			key: { id: crypto.randomUUID(), remoteJid: "919876543210@s.whatsapp.net", fromMe: false },
			pushName: "Asha",
			from: "919876543210@s.whatsapp.net",
			type: "TEXT",
			content,
		},
	});

	async function storedFor(filter: Record<string, unknown>) {
		return (await db.getDb())
			.collection("whatsapp_webhook_events")
			.find({ sessionId, ...filter })
			.toArray();
	}

	test("stores a signed delivery, once, however often it is redelivered", async () => {
		const payload = received(`hello ${crypto.randomUUID()}`);
		const first = await deliver(payload);
		expect(first).toEqual({ status: 200, body: { received: true, event: "message.received" } });
		expect((await deliver(payload)).status).toBe(200);

		const stored = await storedFor({ "data.content": payload.data.content });
		expect(stored).toHaveLength(1);
		expect(stored[0]?.event).toBe("message.received");
		expect(stored[0]?.occurredAt).toBeInstanceOf(Date);
	});

	test("refuses unsigned, wrongly signed and malformed deliveries", async () => {
		const payload = received(`forged ${crypto.randomUUID()}`);
		expect((await deliver(payload, { secret: null })).status).toBe(401);
		expect((await deliver(payload, { secret: "someone-else" })).status).toBe(401);
		expect(await storedFor({ "data.content": payload.data.content })).toHaveLength(0);

		expect((await deliver({ sessionId, data: {} })).status).toBe(400);

		const get = await handle(new Request("http://localhost/whatsapp/webhook"));
		expect(get.status).toBe(405);
	});

	test("with no secret configured, every delivery is refused", async () => {
		Bun.env.WHATSAPP_WEBHOOK_SECRET = "";
		try {
			expect((await deliver(received("no secret"))).status).toBe(401);
		} finally {
			Bun.env.WHATSAPP_WEBHOOK_SECRET = WEBHOOK_SECRET;
		}
	});

	test("never stores the pairing QR from a connection update", async () => {
		const response = await deliver({
			event: "connection.update",
			sessionId,
			timestamp: new Date().toISOString(),
			data: { status: "SCAN_QR", qr: "2@secret-pairing-code" },
		});
		expect(response.status).toBe(200);
		const [stored] = await storedFor({ event: "connection.update" });
		expect(stored?.data).toEqual({ status: "SCAN_QR", qr: "[redacted]" });
	});

	test("admins can list events, filtered, with counts and the session state", async () => {
		await deliver({
			event: "connection.update",
			sessionId,
			timestamp: new Date().toISOString(),
			data: { status: "CONNECTED", qr: null },
		});
		await deliver({
			event: "message.status",
			sessionId,
			timestamp: new Date().toISOString(),
			data: { keyId: "K1", remoteJid: "919876543210@s.whatsapp.net", status: "READ" },
		});

		const anonymous = makeVisitor();
		expect((await anonymous.send("GET", "/login/admin/whatsapp/events")).status).toBe(401);

		const admin = makeVisitor();
		const login = await admin.send("POST", "/login", {
			email: "owner-test@example.com",
			password: "test-owner-password",
		});
		expect(login.status).toBe(200);

		const all = await admin.send("GET", "/login/admin/whatsapp/events");
		expect(all.status).toBe(200);
		expect(all.body.webhookConfigured).toBe(true);
		expect(all.body.webhookPath).toBe("/whatsapp/webhook");
		expect(all.body.connection.status).toBe("CONNECTED");
		expect(all.body.counts["message.status"]).toBeGreaterThanOrEqual(1);

		const statuses = await admin.send(
			"GET",
			"/login/admin/whatsapp/events?event=message.status&limit=5",
		);
		expect(statuses.body.events.length).toBeGreaterThanOrEqual(1);
		expect(
			statuses.body.events.every((item: { event: string }) => item.event === "message.status"),
		).toBe(true);
		expect(statuses.body.events[0].summary).toBe("K1 to 919876543210: READ");
	});
});

suite("Linking WhatsApp to an existing account", () => {
	/** A signed-in visitor holding a fresh email-and-password account. */
	async function emailAccount() {
		const visitor = makeVisitor();
		const email = `link-${crypto.randomUUID().slice(0, 8)}@example.com`;
		const created = await visitor.send("POST", "/login/signup", {
			fullName: "Link Tester",
			company: "Test Co",
			email,
			password: "Str0ng!password",
		});
		expect(created.status).toBe(201);
		expect(created.body.user).toMatchObject({ signupMethod: "email", phone: null });
		return { visitor, email, id: created.body.user.id as string };
	}

	test("sends a link code, links the number, and the number then signs in", async () => {
		resetGateway();
		const { visitor, id } = await emailAccount();
		const phone = randomPhone();

		const sent = await visitor.send("POST", "/login/whatsapp/link/send", { phone });
		expect(sent.status).toBe(200);
		expect(gateway.sends).toEqual([phone]);
		expect((await db.findWhatsAppOtpChallenge(phone))?.userId).toBe(id);

		const wrong = await visitor.send("POST", "/login/whatsapp/link", { phone, code: "000000" });
		expect(wrong.status).toBe(400);
		expect((await db.findUserById(id))?.phone).toBeNull();

		const linked = await visitor.send("POST", "/login/whatsapp/link", { phone, code: "123456" });
		expect(linked.status).toBe(200);
		expect(linked.body.user).toMatchObject({
			phone,
			phoneVerified: true,
			signupMethod: "email",
			hasPassword: true,
		});
		expect(linked.body.user.phoneLinkedAt).toEqual(expect.any(String));

		// Linked, the same account can now sign in with WhatsApp on another device.
		await (await db.getDb())
			.collection("whatsapp_otp_challenges")
			.deleteOne({ _id: phone as never });
		const elsewhere = makeVisitor();
		await elsewhere.send("POST", "/login/whatsapp/send", { phone });
		const signedIn = await elsewhere.send("POST", "/login/whatsapp", { phone, code: "123456" });
		expect(signedIn.status).toBe(200);
		expect(signedIn.body.user.id).toBe(id);
	});

	test("needs a signed-in account", async () => {
		resetGateway();
		const anonymous = makeVisitor();
		const response = await anonymous.send("POST", "/login/whatsapp/link/send", {
			phone: randomPhone(),
		});
		expect(response.status).toBe(401);
		expect(gateway.sends).toEqual([]);
	});

	test("refuses a number already on another account, before sending anything", async () => {
		resetGateway();
		const taken = randomPhone();
		const details = signupDetails(taken);
		const owner = makeVisitor();
		await owner.send("POST", "/login/signup/whatsapp/send", details);
		await owner.send("POST", "/login/signup/whatsapp", { ...details, code: "123456" });
		gateway.sends = [];

		const { visitor } = await emailAccount();
		const response = await visitor.send("POST", "/login/whatsapp/link/send", { phone: taken });
		expect(response.status).toBe(409);
		expect(response.body.error).toContain("already linked to another account");
		expect(gateway.sends).toEqual([]);
	});

	test("an account that already has WhatsApp linked cannot link another number", async () => {
		resetGateway();
		const details = signupDetails(randomPhone());
		const visitor = makeVisitor();
		await visitor.send("POST", "/login/signup/whatsapp/send", details);
		await visitor.send("POST", "/login/signup/whatsapp", { ...details, code: "123456" });

		const response = await visitor.send("POST", "/login/whatsapp/link/send", {
			phone: randomPhone(),
		});
		expect(response.status).toBe(409);
	});

	test("a link code can only be spent by the account that asked for it", async () => {
		resetGateway();
		const requester = await emailAccount();
		const intruder = await emailAccount();
		const phone = randomPhone();
		await requester.visitor.send("POST", "/login/whatsapp/link/send", { phone });

		const stolen = await intruder.visitor.send("POST", "/login/whatsapp/link", {
			phone,
			code: "123456",
		});
		expect(stolen.status).toBe(400);
		expect(gateway.verifies).toEqual([]);
		expect((await db.findUserById(intruder.id))?.phone).toBeNull();

		const own = await requester.visitor.send("POST", "/login/whatsapp/link", {
			phone,
			code: "123456",
		});
		expect(own.status).toBe(200);
	});

	test("admins see how each account signed up and whether WhatsApp is linked", async () => {
		resetGateway();
		const details = signupDetails(randomPhone());
		const visitor = makeVisitor();
		await visitor.send("POST", "/login/signup/whatsapp/send", details);
		const created = await visitor.send("POST", "/login/signup/whatsapp", {
			...details,
			code: "123456",
		});
		const { id: emailOnlyId } = await emailAccount();

		const admin = makeVisitor();
		await admin.send("POST", "/login", {
			email: "owner-test@example.com",
			password: "test-owner-password",
		});
		const listing = await admin.send("GET", "/login/admin/users");
		expect(listing.status).toBe(200);

		type Listed = {
			id: string;
			signupMethod: string;
			phone: string | null;
			phoneVerified: boolean;
		};
		const users = listing.body.users as Listed[];
		const whatsappUser = users.find((user) => user.id === created.body.user.id);
		expect(whatsappUser).toMatchObject({
			signupMethod: "whatsapp",
			phone: details.phone,
			phoneVerified: true,
		});
		expect(users.find((user) => user.id === emailOnlyId)).toMatchObject({
			signupMethod: "email",
			phone: null,
			phoneVerified: false,
		});

		const { stats } = listing.body;
		expect(stats.whatsappSignups).toBe(users.filter((u) => u.signupMethod === "whatsapp").length);
		expect(stats.whatsappLinked).toBe(users.filter((u) => u.phone && u.phoneVerified).length);
		expect(stats.whatsappSignups).toBeGreaterThanOrEqual(1);
	});
});
