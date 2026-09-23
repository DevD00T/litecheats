/**
 * Unit tests for the WhatsApp OTP gateway client. No network: every call goes
 * to a fake `fetch` that records what was sent and replies as scripted.
 *
 *   bun test src/bun/whatsapp-otp.test.ts
 */
import { describe, expect, test } from "bun:test";
import {
	createWhatsAppOtpClient,
	normalizeWhatsAppPhone,
	readGatewayVerdict,
} from "./whatsapp-otp";

interface RecordedCall {
	url: string;
	headers: Headers;
	body: unknown;
}

function fakeGateway(reply: (url: string) => Response | Promise<Response>) {
	const calls: RecordedCall[] = [];
	const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		calls.push({
			url,
			headers: new Headers(init?.headers),
			body: init?.body ? JSON.parse(String(init.body)) : null,
		});
		return reply(url);
	}) as typeof fetch;

	const client = createWhatsAppOtpClient({
		baseUrl: "https://gateway.test/api/otp/abc/",
		apiKey: "secret-key",
		fetch: fetchImpl,
	});
	return { client, calls };
}

const json = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("normalizeWhatsAppPhone", () => {
	test("accepts the usual ways of writing a number", () => {
		expect(normalizeWhatsAppPhone("+91 98765 43210", "91")).toBe("919876543210");
		expect(normalizeWhatsAppPhone("919876543210", "91")).toBe("919876543210");
		expect(normalizeWhatsAppPhone("98765-43210", "91")).toBe("919876543210");
		expect(normalizeWhatsAppPhone("098765 43210", "91")).toBe("919876543210");
		expect(normalizeWhatsAppPhone("0091 98765 43210", "91")).toBe("919876543210");
		expect(normalizeWhatsAppPhone("+1 (415) 555-0100", "91")).toBe("14155550100");
	});

	test("does not add a country code to a number that was written with '+'", () => {
		// Ten digits after "+" is a complete international number, not a local one.
		expect(normalizeWhatsAppPhone("+4412345678", "91")).toBe("4412345678");
	});

	test("with no default country code, a bare local number is left alone", () => {
		expect(normalizeWhatsAppPhone("9876543210", "")).toBe("9876543210");
	});

	test("rejects things that are not phone numbers", () => {
		expect(normalizeWhatsAppPhone("", "91")).toBeNull();
		expect(normalizeWhatsAppPhone("12345", "91")).toBeNull();
		expect(normalizeWhatsAppPhone("+0 123 456 7890", "91")).toBeNull();
		expect(normalizeWhatsAppPhone("98765abc43210", "91")).toBeNull();
		expect(normalizeWhatsAppPhone("+91 98765 43210 1234 5678", "91")).toBeNull();
	});
});

describe("readGatewayVerdict", () => {
	test("reads the common flags", () => {
		expect(readGatewayVerdict({ status: true })).toBe(true);
		expect(readGatewayVerdict({ success: true, message: "OTP verified" })).toBe(true);
		expect(readGatewayVerdict({ verified: true })).toBe(true);
		expect(readGatewayVerdict({ status: "success" })).toBe(true);
		expect(readGatewayVerdict({ data: { valid: true } })).toBe(true);
		expect(readGatewayVerdict({ status: false, message: "Invalid OTP" })).toBe(false);
		expect(readGatewayVerdict({ status: "expired" })).toBe(false);
	});

	test("one false outweighs any true, even nested", () => {
		expect(readGatewayVerdict({ success: true, verified: false })).toBe(false);
		expect(readGatewayVerdict({ status: true, data: { valid: false } })).toBe(false);
	});

	test("returns null when there is nothing to read", () => {
		expect(readGatewayVerdict(null)).toBeNull();
		expect(readGatewayVerdict("ok")).toBeNull();
		expect(readGatewayVerdict({ message: "OTP verified" })).toBeNull();
	});
});

describe("createWhatsAppOtpClient", () => {
	test("sends to {base}/send with the api key and the phone", async () => {
		const { client, calls } = fakeGateway(() => json(200, { status: true }));
		expect(await client.sendCode("919876543210")).toEqual({ ok: true });

		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe("https://gateway.test/api/otp/abc/send");
		expect(calls[0]?.headers.get("x-api-key")).toBe("secret-key");
		expect(calls[0]?.headers.get("content-type")).toBe("application/json");
		expect(calls[0]?.body).toEqual({ phone: "919876543210" });
	});

	test("verifies at {base}/verify with the phone and the code", async () => {
		const { client, calls } = fakeGateway(() => json(200, { status: true }));
		expect(await client.verifyCode("919876543210", "123456")).toEqual({ ok: true });
		expect(calls[0]?.url).toBe("https://gateway.test/api/otp/abc/verify");
		expect(calls[0]?.body).toEqual({ phone: "919876543210", code: "123456" });
	});

	test("a wrong code is rejected, whether the gateway says so by status or by body", async () => {
		const byStatus = fakeGateway(() => json(400, { status: false, message: "Invalid OTP" }));
		expect(await byStatus.client.verifyCode("919876543210", "000000")).toMatchObject({
			ok: false,
			reason: "rejected",
		});

		const byBody = fakeGateway(() => json(200, { status: false, message: "Invalid OTP" }));
		expect(await byBody.client.verifyCode("919876543210", "000000")).toMatchObject({
			ok: false,
			reason: "rejected",
		});
	});

	test("verification fails closed on a success status without a positive flag", async () => {
		for (const body of [{}, { message: "done" }, "not json"]) {
			const { client } = fakeGateway(() =>
				typeof body === "string" ? new Response(body, { status: 200 }) : json(200, body),
			);
			expect(await client.verifyCode("919876543210", "123456")).toMatchObject({
				ok: false,
				reason: "unavailable",
			});
		}
	});

	test("a bad key, a server error or a dead tunnel is 'unavailable', not the user's fault", async () => {
		const badKey = fakeGateway(() => json(401, { status: false, message: "Unauthorized" }));
		expect(await badKey.client.verifyCode("919876543210", "123456")).toMatchObject({
			ok: false,
			reason: "unavailable",
		});

		const serverError = fakeGateway(() => new Response("Bad gateway", { status: 502 }));
		expect(await serverError.client.sendCode("919876543210")).toMatchObject({
			ok: false,
			reason: "unavailable",
		});

		const offline = fakeGateway(() => {
			throw new TypeError("fetch failed");
		});
		expect(await offline.client.sendCode("919876543210")).toMatchObject({
			ok: false,
			reason: "unavailable",
			detail: "fetch failed",
		});
	});

	test("throttling is reported as rate_limited", async () => {
		const { client } = fakeGateway(() => json(429, { status: false, message: "Slow down" }));
		expect(await client.sendCode("919876543210")).toMatchObject({
			ok: false,
			reason: "rate_limited",
		});
	});

	test("a send the gateway explicitly refuses is rejected", async () => {
		const { client } = fakeGateway(() => json(200, { status: false, message: "Not on WhatsApp" }));
		expect(await client.sendCode("919876543210")).toMatchObject({
			ok: false,
			reason: "rejected",
			detail: "Not on WhatsApp",
		});
	});

	test("an unconfigured client never calls out", async () => {
		let called = false;
		const client = createWhatsAppOtpClient({
			baseUrl: "https://gateway.test/api/otp/abc",
			apiKey: "",
			fetch: (async () => {
				called = true;
				return json(200, { status: true });
			}) as unknown as typeof fetch,
		});
		expect(client.configured).toBe(false);
		expect(await client.verifyCode("919876543210", "123456")).toMatchObject({
			ok: false,
			reason: "unavailable",
		});
		expect(called).toBe(false);
	});
});
