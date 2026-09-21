/**
 * Integration tests for the MongoDB layer. They run against a real cluster, in a
 * throwaway database with a random name that is dropped afterwards, so they never
 * touch the app's own database. Skipped when MONGODB_URI is not set.
 *
 *   bun test src/bun/db
 */
import { afterAll, describe, expect, test } from "bun:test";
import * as db from "./index";
import { COLLECTION_DEFINITIONS } from "./schema";

// Atlas caps database names at 38 bytes, so keep the throwaway name short.
const TEST_DB_PREFIX = "lcpwa_test_";
const TEST_DB_NAME = `${TEST_DB_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const hasCluster = Boolean(Bun.env.MONGODB_URI);

if (hasCluster) {
	// Read lazily by the client, so setting them before first use is enough.
	Bun.env.MONGODB_DB_NAME = TEST_DB_NAME;
	Bun.env.OWNER_EMAIL = "owner-test@example.com";
	Bun.env.OWNER_PASSWORD = "test-owner-password";
}

const suite = hasCluster ? describe : describe.skip;
const uid = () => crypto.randomUUID();
const minutes = (n: number) => n * 60 * 1000;

function makeUser(overrides: Partial<db.UserDocument> = {}): db.UserDocument {
	const now = new Date();
	const id = uid();
	return {
		_id: id,
		email: `User-${id}@Example.com`,
		emailLower: `user-${id}@example.com`,
		fullName: "Test User",
		company: "Test Co",
		roles: ["user"],
		isAdmin: false,
		isOwner: false,
		emailVerified: true,
		preferredOrigin: null,
		passwordHash: "hash",
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

function makeSubscription(
	userId: string,
	overrides: Partial<db.BillingSubscriptionDocument> = {},
): db.BillingSubscriptionDocument {
	const now = new Date();
	return {
		_id: uid(),
		userId,
		planId: "institution",
		planName: "Institution",
		cycle: "monthly",
		quantity: 1,
		mode: "order",
		status: "active",
		amount: 118_000,
		currency: "INR",
		razorpayOrderId: `order_${uid()}`,
		razorpaySubscriptionId: null,
		razorpayPaymentId: null,
		shortUrl: null,
		currentPeriodStart: now,
		currentPeriodEnd: new Date(now.getTime() + 30 * 24 * minutes(60)),
		cancelAtPeriodEnd: false,
		privateId: db.generateSubscriptionPrivateId(),
		notes: "",
		renewalWarningSentFor: null,
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

function makePayment(
	userId: string,
	overrides: Partial<db.BillingPaymentDocument> = {},
): db.BillingPaymentDocument {
	const now = new Date();
	return {
		_id: uid(),
		userId,
		subscriptionId: null,
		razorpayPaymentId: `pay_${uid()}`,
		razorpayOrderId: `order_${uid()}`,
		planId: "institution",
		amount: 50_000,
		currency: "INR",
		status: "authorized",
		method: "card",
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

afterAll(async () => {
	if (!hasCluster) return;
	// Never drop anything that is not unmistakably a test database.
	const handle = await db.getDb();
	if (handle.databaseName === TEST_DB_NAME && TEST_DB_NAME.startsWith(TEST_DB_PREFIX)) {
		await handle.dropDatabase();
	}
	await db.closeDb();
});

suite("schema", () => {
	test("creates every collection with its validator and indexes", async () => {
		const handle = await db.getDb();
		const existing = await handle.listCollections({}, { nameOnly: false }).toArray();

		for (const definition of COLLECTION_DEFINITIONS) {
			const found = existing.find((entry) => entry.name === definition.name);
			expect(found, `collection ${definition.name}`).toBeDefined();
			const options = (found as { options?: { validator?: unknown } }).options;
			expect(options?.validator, `validator on ${definition.name}`).toBeDefined();

			const indexNames = (await handle.collection(definition.name).indexes()).map((i) => i.name);
			for (const index of definition.indexes) {
				expect(indexNames, `${definition.name}.${index.name}`).toContain(index.name);
			}
		}
	});

	test("ensureSchema is idempotent", async () => {
		const handle = await db.getDb();
		await db.ensureSchema(handle);
		await db.ensureSchema(handle);
	});

	test("seeds exactly one owner", async () => {
		const owners = await (await db.getDb()).collection("users").countDocuments({ isOwner: true });
		expect(owners).toBe(1);
		const owner = await db.findUserByEmailLower("owner-test@example.com");
		expect(owner?.isAdmin).toBe(true);
		expect(owner?.emailVerified).toBe(true);
	});

	test("the database rejects a document that breaks the schema", async () => {
		const users = (await db.getDb()).collection<Record<string, unknown>>("users");
		const bad = { ...makeUser(), roles: ["superuser"] };
		await expect(users.insertOne(bad as never)).rejects.toMatchObject({ code: 121 });

		const notBoolean = { ...makeUser(), isAdmin: "yes" };
		await expect(users.insertOne(notBoolean as never)).rejects.toMatchObject({ code: 121 });
	});

	test("a wallet balance can never be stored negative", async () => {
		const wallets = (await db.getDb()).collection<Record<string, unknown>>("wallet_accounts");
		await expect(
			wallets.insertOne({
				_id: uid(),
				balance: -1,
				currency: "INR",
				autoRenew: true,
				paymentMode: "wallet",
				createdAt: new Date(),
				updatedAt: new Date(),
			} as never),
		).rejects.toMatchObject({ code: 121 });
	});
});

suite("users", () => {
	test("round trip, lookup, update, list and delete", async () => {
		const user = makeUser();
		await db.insertUser(user);

		const byEmail = await db.findUserByEmailLower(user.emailLower);
		expect(byEmail?._id).toBe(user._id);
		expect(byEmail?.roles).toEqual(["user"]);
		expect(byEmail?.createdAt).toBeInstanceOf(Date);

		await db.updateUserFields(user._id, {
			fullName: "Renamed",
			isAdmin: true,
			preferredOrigin: "https://litecheats.com",
			updatedAt: new Date(),
		});
		const updated = await db.findUserById(user._id);
		expect(updated?.fullName).toBe("Renamed");
		expect(updated?.isAdmin).toBe(true);
		expect(updated?.preferredOrigin).toBe("https://litecheats.com");
		expect(updated?.emailLower).toBe(user.emailLower);

		await db.updateUserFields(user._id, { preferredOrigin: null });
		expect((await db.findUserById(user._id))?.preferredOrigin).toBeNull();

		const listed = await db.listAllUsersSortedByCreatedDesc();
		expect(listed.some((entry) => entry._id === user._id)).toBe(true);
		const times = listed.map((entry) => entry.createdAt.getTime());
		expect(times).toEqual([...times].sort((a, b) => b - a));

		await db.deleteUserById(user._id);
		expect(await db.findUserById(user._id)).toBeNull();
	});

	test("a duplicate email is reported as a unique-constraint error on emailLower", async () => {
		const first = makeUser();
		await db.insertUser(first);
		const clash = makeUser({ emailLower: first.emailLower });

		const error = await db.insertUser(clash).then(
			() => null,
			(caught: unknown) => caught,
		);
		expect(db.isUniqueConstraintError(error)).toBe(true);
		expect(db.uniqueConstraintColumn(error)).toBe("emailLower");
		expect(db.isUniqueConstraintError(new Error("something else"))).toBe(false);
	});

	test("a duplicate primary key is reported as column 'id'", async () => {
		const user = makeUser();
		await db.insertUser(user);
		const error = await db.insertUser(makeUser({ _id: user._id })).then(
			() => null,
			(caught: unknown) => caught,
		);
		expect(db.uniqueConstraintColumn(error)).toBe("id");
	});
});

suite("sessions", () => {
	function makeSession(
		userId: string,
		overrides: Partial<db.SessionDocument> = {},
	): db.SessionDocument {
		const now = new Date();
		return {
			_id: uid(),
			userId,
			userAgent: "bun-test",
			ipAddress: "127.0.0.1",
			deviceKey: "device-a",
			createdAt: now,
			updatedAt: now,
			expiresAt: new Date(now.getTime() + minutes(60)),
			...overrides,
		};
	}

	test("counts, lists, touches and purges", async () => {
		const userId = uid();
		const now = new Date();
		const live = makeSession(userId);
		const otherDevice = makeSession(userId, { deviceKey: "device-b" });
		const expired = makeSession(userId, { expiresAt: new Date(now.getTime() - minutes(5)) });
		for (const session of [live, otherDevice, expired]) await db.insertSession(session);

		expect(await db.countActiveSessionsForUser(userId, now)).toBe(2);
		expect(await db.countActiveSessionsForDevice(userId, "device-a", now)).toBe(1);

		await db.touchSession(live._id, {
			updatedAt: new Date(now.getTime() + 1000),
			expiresAt: new Date(now.getTime() + minutes(120)),
			ipAddress: "10.0.0.1",
			userAgent: "changed",
		});
		const listed = await db.listActiveSessionsForUser(userId, now);
		expect(listed.map((s) => s._id)[0]).toBe(live._id);
		expect(listed[0]?.ipAddress).toBe("10.0.0.1");

		await db.deleteExpiredSessionsForUser(userId, now);
		expect(await db.findSessionById(expired._id)).toBeNull();
		expect(await db.findSessionById(live._id)).not.toBeNull();

		expect(await db.deleteSessionByIdForUser(otherDevice._id, "someone-else")).toBe(false);
		expect(await db.deleteSessionByIdForUser(otherDevice._id, userId)).toBe(true);
		expect(await db.deleteAllSessionsForUser(userId)).toBe(1);
	});
});

suite("releases and artifacts (GridFS)", () => {
	function makeRelease(version: string, isLatest = false): db.ReleaseVersionDocument {
		const now = new Date();
		return {
			_id: uid(),
			version,
			notes: "n",
			publishedAt: now,
			isLatest,
			createdAt: now,
			updatedAt: now,
		};
	}

	function makeArtifact(releaseId: string, data: Uint8Array): db.ReleaseArtifactDocument {
		return {
			_id: uid(),
			releaseId,
			version: "1.0.0",
			platform: "macos",
			format: "dmg",
			target: "universal",
			filename: "Litecheats.dmg",
			sizeBytes: data.byteLength,
			sha256: new Bun.CryptoHasher("sha256").update(data).digest("hex"),
			mimeType: "application/x-apple-diskimage",
			createdAt: new Date(),
		};
	}

	test("latest flag moves between releases and versions are unique", async () => {
		const a = makeRelease(`1.${Date.now()}.0`);
		const b = makeRelease(`2.${Date.now()}.0`);
		await db.insertRelease(a);
		await db.insertRelease(b);

		await db.unsetLatestExcept(a._id, new Date());
		await db.setReleaseLatest(a._id, true, new Date());
		expect((await db.findAnyLatestRelease())?._id).toBe(a._id);

		await db.unsetLatestExcept(b._id, new Date());
		await db.setReleaseLatest(b._id, true, new Date());
		expect((await db.findAnyLatestRelease())?._id).toBe(b._id);
		expect((await db.findReleaseById(a._id))?.isLatest).toBe(false);

		const error = await db.insertRelease(makeRelease(a.version)).then(
			() => null,
			(caught: unknown) => caught,
		);
		expect(db.uniqueConstraintColumn(error)).toBe("version");

		await db.updateReleaseFields(a._id, { notes: "edited" });
		expect((await db.findReleaseByVersion(a.version))?.notes).toBe("edited");
		expect((await db.listReleasesSortedByPublishedDesc(1)).length).toBe(1);
		expect(await db.findMostRecentReleaseByPublishedDesc()).not.toBeNull();
	});

	test("a multi-chunk binary streams back byte for byte and is removed cleanly", async () => {
		const release = makeRelease(`3.${Date.now()}.0`);
		await db.insertRelease(release);

		// 2.5 MiB spans three 1 MiB GridFS chunks.
		const data = crypto.getRandomValues(new Uint8Array(2.5 * 1024 * 1024));
		const artifact = makeArtifact(release._id, data);
		await db.insertArtifact(artifact, data);

		const received = await db.findArtifactBlobById(artifact._id);
		expect(received).not.toBeNull();
		expect(received?.byteLength).toBe(data.byteLength);
		expect(Buffer.compare(received as Buffer, Buffer.from(data))).toBe(0);

		expect((await db.findArtifactMetaById(artifact._id))?.sha256).toBe(artifact.sha256);
		expect((await db.findArtifactByLookup(release._id, "macos", "dmg", "universal"))?._id).toBe(
			artifact._id,
		);
		expect(
			await db.findConflictingArtifact(artifact._id, release._id, "macos", "dmg", "universal"),
		).toBeNull();

		await db.updateArtifactFields(artifact._id, { filename: "Renamed.dmg" });
		await db.updateArtifactVersionForRelease(release._id, "9.9.9");
		const meta = await db.findArtifactMetaById(artifact._id);
		expect(meta?.filename).toBe("Renamed.dmg");
		expect(meta?.version).toBe("9.9.9");

		await db.deleteArtifactById(artifact._id);
		expect(await db.findArtifactBlobById(artifact._id)).toBeNull();
		const handle = await db.getDb();
		expect(
			await handle.collection("release_files.files").countDocuments({ _id: artifact._id as never }),
		).toBe(0);
		expect(
			await handle
				.collection("release_files.chunks")
				.countDocuments({ files_id: artifact._id as never }),
		).toBe(0);
	});

	test("a failed metadata insert does not leave an orphaned binary", async () => {
		const release = makeRelease(`4.${Date.now()}.0`);
		await db.insertRelease(release);
		const data = crypto.getRandomValues(new Uint8Array(1024));
		const artifact = makeArtifact(release._id, data);
		// Breaks the platform enum, so the validator rejects the metadata document.
		const invalid = { ...artifact, platform: "amiga" } as unknown as db.ReleaseArtifactDocument;

		await expect(db.insertArtifact(invalid, data)).rejects.toMatchObject({ code: 121 });
		expect(await db.findArtifactBlobById(artifact._id)).toBeNull();
	});

	test("deleting a release's artifacts removes metadata and binaries", async () => {
		const release = makeRelease(`5.${Date.now()}.0`);
		await db.insertRelease(release);
		const first = crypto.getRandomValues(new Uint8Array(2048));
		const second = crypto.getRandomValues(new Uint8Array(4096));
		const a = makeArtifact(release._id, first);
		const b = { ...makeArtifact(release._id, second), format: "zip" as const };
		await db.insertArtifact(a, first);
		await db.insertArtifact(b, second);

		expect((await db.listArtifactMetaByReleaseIds([release._id])).length).toBe(2);
		expect(await db.deleteArtifactsByReleaseId(release._id)).toBe(2);
		expect(await db.findArtifactBlobById(a._id)).toBeNull();
		expect(await db.findArtifactBlobById(b._id)).toBeNull();
		expect(await db.listArtifactMetaByReleaseIds([])).toEqual([]);

		await db.deleteReleaseById(release._id);
		expect(await db.findReleaseById(release._id)).toBeNull();
	});
});

suite("telegram admins", () => {
	test("env seed, upsert, chat linking", async () => {
		const name = `Seed_${Math.random().toString(36).slice(2, 8)}`;
		await db.seedTelegramAdminsFromEnv([name]);
		await db.seedTelegramAdminsFromEnv([name]);
		const seeded = await db.findTelegramAdminByUsernameLower(name.toLowerCase());
		expect(seeded?.role).toBe("owner");
		expect(seeded?.chatId).toBeNull();
		expect(seeded?.addedByUsername).toBe("env");

		const added = `Added_${Math.random().toString(36).slice(2, 8)}`;
		const first = await db.upsertTelegramAdmin(added, 42, "someone");
		expect(first.created).toBe(true);
		expect(first.admin.role).toBe("admin");
		const again = await db.upsertTelegramAdmin(added, 99, "other");
		expect(again.created).toBe(false);
		expect(again.admin.addedByTelegramId).toBe(42);

		expect(await db.linkTelegramAdminChat(added.toLowerCase(), 123_456_789)).toBe(true);
		expect(await db.linkTelegramAdminChat("nobody_here", 1)).toBe(false);
		const chats = await db.listTelegramAdminChatIds();
		expect(chats).toContainEqual({ username: added, chatId: 123_456_789 });
		expect(chats.some((entry) => entry.username === name)).toBe(false);

		const listed = await db.listTelegramAdminsSorted();
		expect(listed.findIndex((a) => a.role === "owner")).toBeLessThan(
			listed.findIndex((a) => a.role === "admin"),
		);
	});

	test("concurrent upserts of one username create exactly one admin", async () => {
		const name = `Race_${Math.random().toString(36).slice(2, 8)}`;
		const results = await Promise.all(
			Array.from({ length: 8 }, () => db.upsertTelegramAdmin(name, null, null)),
		);
		expect(results.filter((r) => r.created).length).toBe(1);
		expect(
			await (await db.getDb())
				.collection("telegram_admins")
				.countDocuments({ usernameLower: name.toLowerCase() }),
		).toBe(1);
	});
});

suite("email verification", () => {
	test("tokens", async () => {
		const token = uid();
		const userId = uid();
		await db.insertEmailVerificationToken(token, userId, new Date(Date.now() + minutes(10)));
		const found = await db.findEmailVerificationToken(token);
		expect(found?.userId).toBe(userId);
		expect(found?.token).toBe(token);
		await db.deleteEmailVerificationTokensForUser(userId);
		expect(await db.findEmailVerificationToken(token)).toBeNull();
	});

	test("one live code per account, replaced on resend, attempts counted atomically", async () => {
		const userId = uid();
		const expiresAt = new Date(Date.now() + minutes(10));
		await db.upsertEmailVerificationCode({ userId, codeHash: "one", expiresAt });
		const created = await db.findEmailVerificationCode(userId);
		expect(created?.attempts).toBe(0);

		await Promise.all(
			Array.from({ length: 5 }, () => db.incrementEmailVerificationAttempts(userId)),
		);
		expect((await db.findEmailVerificationCode(userId))?.attempts).toBe(5);

		await db.upsertEmailVerificationCode({ userId, codeHash: "two", expiresAt });
		const replaced = await db.findEmailVerificationCode(userId);
		expect(replaced?.codeHash).toBe("two");
		expect(replaced?.attempts).toBe(0);
		expect(replaced?.createdAt.getTime()).toBe(created?.createdAt.getTime());

		await db.deleteEmailVerificationCode(userId);
		expect(await db.findEmailVerificationCode(userId)).toBeNull();
		expect(await db.incrementEmailVerificationAttempts(userId)).toBe(0);
	});
});

suite("billing", () => {
	test("subscription lookups, active selection and updates", async () => {
		const userId = uid();
		const now = new Date();
		const lapsed = makeSubscription(userId, {
			createdAt: new Date(now.getTime() - minutes(300)),
			currentPeriodEnd: new Date(now.getTime() - minutes(60)),
		});
		const current = makeSubscription(userId, { createdAt: new Date(now.getTime() - minutes(30)) });
		const halted = makeSubscription(userId, { status: "halted", currentPeriodEnd: null });
		for (const sub of [lapsed, current, halted]) await db.insertBillingSubscription(sub);

		expect((await db.findBillingSubscriptionById(current._id))?.privateId).toBe(current.privateId);
		expect((await db.findBillingSubscriptionByPrivateId(current.privateId))?._id).toBe(current._id);
		expect(
			(await db.findBillingSubscriptionByOrderId(current.razorpayOrderId as string))?._id,
		).toBe(current._id);
		// `halted` is created last and has no period end, so it is the active one.
		expect((await db.findActiveBillingSubscriptionForUser(userId, now))?._id).toBe(halted._id);
		expect((await db.findLatestBillingSubscriptionForUser(userId))?._id).toBe(halted._id);
		expect((await db.listBillingSubscriptionsForUser(userId, 10)).length).toBe(3);

		await db.updateBillingSubscriptionFields(current._id, {
			status: "cancelled",
			razorpaySubscriptionId: "sub_abc123",
			cancelAtPeriodEnd: true,
			notes: "n",
		});
		const updated = await db.findBillingSubscriptionById(current._id);
		expect(updated?.status).toBe("cancelled");
		expect(updated?.cancelAtPeriodEnd).toBe(true);
		expect((await db.findBillingSubscriptionByRazorpayId("sub_abc123"))?._id).toBe(current._id);
		expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(current.updatedAt.getTime());
	});

	test("nullable Razorpay ids do not collide, real ones do", async () => {
		const userId = uid();
		await db.insertBillingSubscription(makeSubscription(userId, { razorpayOrderId: null }));
		await db.insertBillingSubscription(makeSubscription(userId, { razorpayOrderId: null }));

		const order = `order_${uid()}`;
		await db.insertBillingSubscription(makeSubscription(userId, { razorpayOrderId: order }));
		const error = await db
			.insertBillingSubscription(makeSubscription(userId, { razorpayOrderId: order }))
			.then(
				() => null,
				(caught: unknown) => caught,
			);
		expect(db.uniqueConstraintColumn(error)).toBe("razorpayOrderId");

		const privateId = db.generateSubscriptionPrivateId();
		await db.insertBillingSubscription(makeSubscription(userId, { privateId }));
		const clash = await db.insertBillingSubscription(makeSubscription(userId, { privateId })).then(
			() => null,
			(caught: unknown) => caught,
		);
		expect(db.uniqueConstraintColumn(clash)).toBe("privateId");
		expect(privateId).toMatch(/^LC-SUB-[A-HJ-NP-Z2-9]{8}$/);
	});

	test("payments are idempotent on the Razorpay payment id and keep a known subscription", async () => {
		const userId = uid();
		const sub = makeSubscription(userId);
		await db.insertBillingSubscription(sub);

		const base = makePayment(userId);
		await db.insertBillingPayment({ ...base, subscriptionId: sub._id });
		// Same payment redelivered by the webhook: new status, no subscription known.
		await db.insertBillingPayment({
			...base,
			_id: uid(),
			subscriptionId: null,
			status: "captured",
			method: "upi",
			updatedAt: new Date(),
		});

		const payments = await db.listBillingPaymentsForUser(userId, 10);
		expect(payments.length).toBe(1);
		expect(payments[0]?.status).toBe("captured");
		expect(payments[0]?.method).toBe("upi");
		expect(payments[0]?.subscriptionId).toBe(sub._id);
		expect(payments[0]?._id).toBe(base._id);
		expect(await db.countBillingPaymentsForSubscription(sub._id)).toBe(1);

		// Two payments with no Razorpay id are two rows, not a collision.
		await db.insertBillingPayment(makePayment(userId, { razorpayPaymentId: null }));
		await db.insertBillingPayment(makePayment(userId, { razorpayPaymentId: null }));
		expect((await db.listBillingPaymentsForUser(userId, 10)).length).toBe(3);
	});

	test("concurrent deliveries of one payment produce one row", async () => {
		const userId = uid();
		const base = makePayment(userId);
		await Promise.all(
			Array.from({ length: 6 }, () => db.insertBillingPayment({ ...base, _id: uid() })),
		);
		expect((await db.listBillingPaymentsForUser(userId, 10)).length).toBe(1);
	});

	test("a webhook event can be claimed once", async () => {
		const eventId = `evt_${uid()}`;
		expect(await db.claimBillingWebhookEvent(eventId, "payment.captured")).toBe(true);
		expect(await db.claimBillingWebhookEvent(eventId, "payment.captured")).toBe(false);

		const results = await Promise.all(
			Array.from({ length: 6 }, () => db.claimBillingWebhookEvent(`evt_${uid()}_x`, "e")),
		);
		expect(results.every(Boolean)).toBe(true);

		const same = `evt_${uid()}`;
		const raced = await Promise.all(
			Array.from({ length: 6 }, () => db.claimBillingWebhookEvent(same, "e")),
		);
		expect(raced.filter(Boolean).length).toBe(1);

		expect(
			await db.deleteBillingWebhookEventsOlderThan(new Date(Date.now() + minutes(1))),
		).toBeGreaterThan(0);
	});

	test("the admin notification and renewal warning are claimed once", async () => {
		const sub = makeSubscription(uid());
		await db.insertBillingSubscription(sub);
		const claims = await Promise.all(
			Array.from({ length: 5 }, () => db.claimOrderAdminNotification(sub._id)),
		);
		expect(claims.filter(Boolean).length).toBe(1);

		const now = new Date();
		const soon = makeSubscription(uid(), {
			currentPeriodEnd: new Date(now.getTime() + minutes(60 * 24 * 5)),
		});
		const later = makeSubscription(uid(), {
			currentPeriodEnd: new Date(now.getTime() + minutes(60 * 24 * 60)),
		});
		const due = makeSubscription(uid(), { currentPeriodEnd: new Date(now.getTime() - minutes(5)) });
		const manual = makeSubscription(uid(), {
			currentPeriodEnd: new Date(now.getTime() - minutes(5)),
			cancelAtPeriodEnd: true,
		});
		for (const s of [soon, later, due, manual]) await db.insertBillingSubscription(s);

		const windowEnd = new Date(now.getTime() + minutes(60 * 24 * 10));
		const warn = (await db.listSubscriptionsNeedingRenewalWarning(now, windowEnd)).map(
			(s) => s._id,
		);
		expect(warn).toContain(soon._id);
		expect(warn).not.toContain(later._id);
		expect(warn).not.toContain(due._id);

		await db.markRenewalWarningSent(soon._id, soon.currentPeriodEnd as Date);
		const afterWarn = (await db.listSubscriptionsNeedingRenewalWarning(now, windowEnd)).map(
			(s) => s._id,
		);
		expect(afterWarn).not.toContain(soon._id);

		const dueIds = (await db.listSubscriptionsDueForRenewal(now)).map((s) => s._id);
		expect(dueIds).toContain(due._id);
		expect(dueIds).not.toContain(manual._id);
		expect(dueIds).not.toContain(soon._id);
	});

	test("admin listing joins owners, survives deleted accounts, and totals add up", async () => {
		const owner = makeUser();
		await db.insertUser(owner);
		const sub = makeSubscription(owner._id);
		const orphan = makeSubscription(uid());
		await db.insertBillingSubscription(sub);
		await db.insertBillingSubscription(orphan);
		await db.insertBillingPayment(
			makePayment(owner._id, { subscriptionId: sub._id, status: "captured", amount: 700 }),
		);
		await db.insertBillingPayment(
			makePayment(owner._id, { subscriptionId: sub._id, status: "failed", amount: 999 }),
		);

		const rows = await db.listAllBillingSubscriptionsWithOwner(500);
		const mine = rows.find((row) => row.subscription._id === sub._id);
		expect(mine?.userEmail).toBe(owner.email);
		expect(mine?.userFullName).toBe("Test User");
		expect(mine?.paymentCount).toBe(2);
		const orphaned = rows.find((row) => row.subscription._id === orphan._id);
		expect(orphaned?.userEmail).toBe("");
		expect(orphaned?.paymentCount).toBe(0);

		const totals = await db.getBillingTotals(new Date());
		expect(totals.totalOrders).toBeGreaterThan(0);
		expect(totals.activeOrders).toBeGreaterThan(0);
		// Only the captured payments count towards revenue, never the failed one.
		expect(totals.capturedRevenue).toBeGreaterThanOrEqual(700);
		const captured = await (await db.getDb())
			.collection("billing_payments")
			.aggregate([
				{ $match: { status: "captured" } },
				{ $group: { _id: null, t: { $sum: "$amount" } } },
			])
			.toArray();
		expect(totals.capturedRevenue).toBe(captured[0]?.t as number);
	});

	test("deleting a subscription keeps its payments but detaches them", async () => {
		const userId = uid();
		const sub = makeSubscription(userId);
		await db.insertBillingSubscription(sub);
		const payment = makePayment(userId, { subscriptionId: sub._id, status: "captured" });
		await db.insertBillingPayment(payment);

		expect(await db.deleteBillingSubscriptionById(sub._id)).toBe(true);
		expect(await db.deleteBillingSubscriptionById(sub._id)).toBe(false);
		expect(await db.findBillingSubscriptionById(sub._id)).toBeNull();
		const kept = await db.listBillingPaymentsForUser(userId, 10);
		expect(kept.length).toBe(1);
		expect(kept[0]?.subscriptionId).toBeNull();

		await db.deleteBillingRecordsForUser(userId);
		expect(await db.listBillingPaymentsForUser(userId, 10)).toEqual([]);
	});
});

suite("wallet", () => {
	const movement = (
		userId: string,
		type: "credit" | "debit",
		amount: number,
		referenceId: string | null = null,
	) => ({ userId, type, amount, reason: "test", referenceId, transactionId: uid() });

	test("ensureWallet is idempotent and race-safe", async () => {
		const userId = uid();
		const wallets = await Promise.all(Array.from({ length: 6 }, () => db.ensureWallet(userId)));
		expect(new Set(wallets.map((w) => w.userId))).toEqual(new Set([userId]));
		expect(wallets[0]?.balance).toBe(0);
		expect(wallets[0]?.currency).toBe("INR");
		expect(wallets[0]?.autoRenew).toBe(true);
		expect(wallets[0]?.paymentMode).toBe("wallet");
		expect(
			await (await db.getDb())
				.collection("wallet_accounts")
				.countDocuments({ _id: userId as never }),
		).toBe(1);

		await db.updateWalletPreferences(userId, { autoRenew: false, paymentMode: "checkout" });
		const changed = await db.ensureWallet(userId);
		expect(changed.autoRenew).toBe(false);
		expect(changed.paymentMode).toBe("checkout");
	});

	test("credits, debits and refuses to overdraw, keeping balance and ledger in step", async () => {
		const userId = uid();
		const credit = await db.applyWalletTransaction(movement(userId, "credit", 10_000));
		expect(credit?.balanceAfter).toBe(10_000);
		const debit = await db.applyWalletTransaction(movement(userId, "debit", 3_000));
		expect(debit?.balanceAfter).toBe(7_000);

		expect(await db.applyWalletTransaction(movement(userId, "debit", 7_001))).toBeNull();
		expect((await db.ensureWallet(userId)).balance).toBe(7_000);
		expect((await db.applyWalletTransaction(movement(userId, "debit", 7_000)))?.balanceAfter).toBe(
			0,
		);

		const ledger = await db.listWalletTransactions(userId, 50);
		expect(ledger.length).toBe(3);
		const net = ledger.reduce((sum, t) => sum + (t.type === "credit" ? t.amount : -t.amount), 0);
		expect(net).toBe((await db.ensureWallet(userId)).balance);
		const ledgerTimes = ledger.map((entry) => entry.createdAt.getTime());
		expect(ledgerTimes).toEqual([...ledgerTimes].sort((a, b) => b - a));

		await expect(db.applyWalletTransaction(movement(userId, "credit", -5))).rejects.toThrow();
	});

	test("concurrent debits can never overdraw", async () => {
		const userId = uid();
		await db.applyWalletTransaction(movement(userId, "credit", 100));
		const results = await Promise.all(
			Array.from({ length: 10 }, () => db.applyWalletTransaction(movement(userId, "debit", 30))),
		);
		expect(results.filter(Boolean).length).toBe(3);
		expect((await db.ensureWallet(userId)).balance).toBe(10);
		expect((await db.listWalletTransactions(userId, 50)).length).toBe(4);
	});

	test("a top-up is credited exactly once however many callbacks race", async () => {
		const userId = uid();
		const now = new Date();
		const topup: db.WalletTopupDocument = {
			_id: uid(),
			userId,
			amount: 25_000,
			razorpayOrderId: `order_${uid()}`,
			razorpayPaymentId: null,
			status: "created",
			createdAt: now,
			updatedAt: now,
		};
		await db.insertWalletTopup(topup);
		expect((await db.findWalletTopupByOrderId(topup.razorpayOrderId as string))?._id).toBe(
			topup._id,
		);

		const results = await Promise.all(
			Array.from({ length: 6 }, () =>
				db.creditWalletTopup({
					topupId: topup._id,
					userId,
					amount: topup.amount,
					razorpayPaymentId: "pay_1",
					transactionId: uid(),
				}),
			),
		);
		expect(results.filter(Boolean).length).toBe(1);
		expect((await db.ensureWallet(userId)).balance).toBe(25_000);
		expect((await db.listWalletTransactions(userId, 50)).length).toBe(1);
		const settled = await db.findWalletTopupById(topup._id);
		expect(settled?.status).toBe("paid");
		expect(settled?.razorpayPaymentId).toBe("pay_1");

		// A settled top-up cannot later be failed.
		await db.markWalletTopupFailed(topup._id);
		expect((await db.findWalletTopupById(topup._id))?.status).toBe("paid");
	});

	test("a failure inside a larger transaction rolls the debit back", async () => {
		const userId = uid();
		await db.applyWalletTransaction(movement(userId, "credit", 5_000));

		await expect(
			db.withTransaction(async (session) => {
				const entry = await db.applyWalletTransaction(movement(userId, "debit", 2_000), session);
				expect(entry?.balanceAfter).toBe(3_000);
				throw new Error("subscription update failed");
			}),
		).rejects.toThrow("subscription update failed");

		expect((await db.ensureWallet(userId)).balance).toBe(5_000);
		expect((await db.listWalletTransactions(userId, 50)).length).toBe(1);
	});

	test("failed top-ups and wallet deletion", async () => {
		const userId = uid();
		const now = new Date();
		const topup: db.WalletTopupDocument = {
			_id: uid(),
			userId,
			amount: 10_000,
			razorpayOrderId: null,
			razorpayPaymentId: null,
			status: "created",
			createdAt: now,
			updatedAt: now,
		};
		await db.insertWalletTopup(topup);
		await db.markWalletTopupFailed(topup._id);
		expect((await db.findWalletTopupById(topup._id))?.status).toBe("failed");
		expect(await db.markWalletTopupPaid(topup._id, "pay_late")).toBe(false);

		await db.applyWalletTransaction(movement(userId, "credit", 1_000));
		await db.deleteWalletDataForUser(userId);
		expect(await db.listWalletTransactions(userId, 10)).toEqual([]);
		expect(await db.findWalletTopupById(topup._id)).toBeNull();
		expect((await db.ensureWallet(userId)).balance).toBe(0);
	});
});

suite("connection", () => {
	test("ping and shared connection", async () => {
		expect(await db.pingDatabase()).toBeGreaterThanOrEqual(0);
		expect(await db.getDb()).toBe(await db.getDb());
		expect((await db.getDb()).databaseName).toBe(TEST_DB_NAME);
	});
});
