import { describe, expect, test } from "bun:test";
import {
	NotificationError,
	parseSendPayload,
	parseTemplatePayload,
	renderPlaceholders,
	sendNotification,
} from "./notifications";

const base = {
	category: "offer",
	title: "An offer for {{company}}",
	body: "Hi {{firstName}}",
	audience: { type: "all" },
};

describe("parseSendPayload", () => {
	test("accepts in-app paths and https links, rejects others", () => {
		expect(parseSendPayload({ ...base, link: "/pricing" }).link).toBe("/pricing");
		expect(parseSendPayload({ ...base, link: "https://litecheats.com/x" }).link).toBe(
			"https://litecheats.com/x",
		);
		expect(() => parseSendPayload({ ...base, link: "javascript:alert(1)" })).toThrow(
			NotificationError,
		);
		expect(() => parseSendPayload({ ...base, link: "//evil.example" })).toThrow(NotificationError);
		expect(() => parseSendPayload({ ...base, link: "http://plain.example" })).toThrow(
			NotificationError,
		);
	});

	test("needs at least one user for a hand-picked audience", () => {
		expect(() => parseSendPayload({ ...base, audience: { type: "users", userIds: [] } })).toThrow(
			NotificationError,
		);
		const parsed = parseSendPayload({
			...base,
			audience: { type: "users", userIds: ["a", "a", "b"] },
		});
		expect(parsed.audience.userIds).toEqual(["a", "b"]);
	});

	test("rejects unknown categories and audiences, and empty text", () => {
		expect(() => parseSendPayload({ ...base, category: "spam" })).toThrow(NotificationError);
		expect(() => parseSendPayload({ ...base, audience: { type: "everyone" } })).toThrow(
			NotificationError,
		);
		expect(() => parseSendPayload({ ...base, title: "  " })).toThrow(NotificationError);
	});
});

describe("parseTemplatePayload", () => {
	test("requires a name", () => {
		expect(() => parseTemplatePayload({ ...base, name: "" })).toThrow(NotificationError);
		expect(parseTemplatePayload({ ...base, name: "Offer" }).name).toBe("Offer");
	});
});

describe("renderPlaceholders", () => {
	test("fills known keys and blanks unknown ones", () => {
		expect(
			renderPlaceholders("Hi {{ firstName }} at {{company}}{{nope}}", {
				firstName: "Asha",
				company: "Acme",
			}),
		).toBe("Hi Asha at Acme");
	});
});

describe("sendNotification permissions", () => {
	const payload = parseSendPayload(base);

	test("admins can't send custom (non-template) notifications", async () => {
		await expect(sendNotification(payload, { sentBy: "admin@x", isOwner: false })).rejects.toThrow(
			"only owners can write custom notifications",
		);
	});

	test("admins can't pick individual users", async () => {
		const picked = parseSendPayload({ ...base, audience: { type: "users", userIds: ["u1"] } });
		await expect(sendNotification(picked, { sentBy: "admin@x", isOwner: false })).rejects.toThrow(
			"Only owners can send to hand-picked users.",
		);
	});
});
