/**
 * Unit tests for the WhatsApp webhook's signature check and event summaries.
 * Payloads are the gateway's documented examples. No database, no network.
 *
 *   bun test src/bun/whatsapp-webhook.test.ts
 */
import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { summarizeWhatsAppEvent, verifyWhatsAppWebhookSignature } from "./whatsapp-webhook";

const sign = (body: string, secret: string) =>
	`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

describe("verifyWhatsAppWebhookSignature", () => {
	const body = '{"event":"message.received","data":{}}';

	test("accepts the gateway's sha256=<hex> header for any configured secret", () => {
		expect(verifyWhatsAppWebhookSignature(body, sign(body, "one"), ["one"])).toBe(true);
		expect(verifyWhatsAppWebhookSignature(body, sign(body, "two"), ["one", "two"])).toBe(true);
		// Bare hex and upper case are the same signature.
		const bare = sign(body, "one").slice("sha256=".length).toUpperCase();
		expect(verifyWhatsAppWebhookSignature(body, bare, ["one"])).toBe(true);
	});

	test("rejects a wrong secret, a changed body, a missing header or no secrets", () => {
		expect(verifyWhatsAppWebhookSignature(body, sign(body, "other"), ["one"])).toBe(false);
		expect(verifyWhatsAppWebhookSignature(`${body} `, sign(body, "one"), ["one"])).toBe(false);
		expect(verifyWhatsAppWebhookSignature(body, null, ["one"])).toBe(false);
		expect(verifyWhatsAppWebhookSignature(body, "sha256=abc", ["one"])).toBe(false);
		expect(verifyWhatsAppWebhookSignature(body, sign(body, "one"), [])).toBe(false);
	});
});

describe("summarizeWhatsAppEvent", () => {
	test("messages name the other party and show the text", () => {
		expect(
			summarizeWhatsAppEvent("message.received", {
				key: { id: "AB12CD34EF", remoteJid: "6281234567890@s.whatsapp.net", fromMe: false },
				pushName: "Budi",
				from: "6281234567890@s.whatsapp.net",
				sender: "6281234567890@s.whatsapp.net",
				isGroup: false,
				type: "TEXT",
				content: "Halo, ini test",
			}),
		).toBe("From Budi (6281234567890): Halo, ini test");

		expect(
			summarizeWhatsAppEvent("message.received", {
				from: "1234567890-123456@g.us",
				sender: "6281234567890@s.whatsapp.net",
				isGroup: true,
				type: "TEXT",
				content: "Halo group",
			}),
		).toBe("From (6281234567890) in group 1234567890-123456: Halo group");

		expect(
			summarizeWhatsAppEvent("message.received", {
				from: "6281234567890@s.whatsapp.net",
				type: "AUDIO",
				fileUrl: "/api/media/abc.mp3",
			}),
		).toBe("From (6281234567890): [AUDIO]");

		expect(
			summarizeWhatsAppEvent("message.sent", {
				receiver: "6281234567890@s.whatsapp.net",
				sender: "ME",
				type: "TEXT",
				content: "Pesan balasan",
			}),
		).toBe("To (6281234567890): Pesan balasan");
	});

	test("every documented event gets a readable line", () => {
		expect(
			summarizeWhatsAppEvent("message.status", {
				keyId: "AB12CD34EF",
				remoteJid: "6281234567890@s.whatsapp.net",
				status: "DELIVERED",
			}),
		).toBe("AB12CD34EF to 6281234567890: DELIVERED");
		expect(
			summarizeWhatsAppEvent("message.deleted", {
				keyId: "DE12LT34EF",
				remoteJid: "6281234567890@s.whatsapp.net",
			}),
		).toBe("DE12LT34EF in 6281234567890 was deleted");
		expect(
			summarizeWhatsAppEvent("message.edited", {
				keyId: "ED12IT34EF",
				newContent: "Pesan diperbaiki",
				remoteJid: "6281234567890@s.whatsapp.net",
			}),
		).toBe("ED12IT34EF in 6281234567890 now reads: Pesan diperbaiki");
		expect(summarizeWhatsAppEvent("connection.update", { status: "CONNECTED", qr: null })).toBe(
			"Session is CONNECTED",
		);
		expect(
			summarizeWhatsAppEvent("group.update", {
				jid: "1234567890-123456@g.us",
				subject: "Nama Grup Baru",
				desc: "Deskripsi grup",
			}),
		).toBe("Nama Grup Baru was updated: Deskripsi grup");
		expect(
			summarizeWhatsAppEvent("group.participant", {
				jid: "1234567890-123456@g.us",
				action: "add",
				participants: ["6281234567890@s.whatsapp.net"],
			}),
		).toBe("add: 6281234567890 in group 1234567890-123456");
		expect(
			summarizeWhatsAppEvent("contact.update", {
				jid: "6281234567890@s.whatsapp.net",
				name: "Budi Santoso",
				notify: "Budi",
			}),
		).toBe("Budi Santoso (6281234567890)");
		expect(
			summarizeWhatsAppEvent("status.update", {
				from: "status@broadcast",
				type: "TEXT",
				content: "Halo semua",
			}),
		).toBe("status: Halo semua");
	});

	test("unknown events and malformed data never throw", () => {
		expect(summarizeWhatsAppEvent("presence.update", { anything: 1 })).toBe("presence.update");
		expect(summarizeWhatsAppEvent("message.received", null)).toBe("From unknown:");
		expect(summarizeWhatsAppEvent("group.participant", "nonsense")).toBe(
			"change: someone in a group",
		);
	});

	test("long text is cut to one short line", () => {
		const summary = summarizeWhatsAppEvent("message.received", {
			from: "6281234567890@s.whatsapp.net",
			content: `line one\n${"x".repeat(500)}`,
		});
		expect(summary.length).toBe(200);
		expect(summary).not.toContain("\n");
		expect(summary.endsWith("…")).toBe(true);
	});
});
