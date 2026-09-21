#!/usr/bin/env bun

/**
 * Creates the collections, validators and indexes in MongoDB, and seeds the owner
 * account if there is none. The app does exactly this on every boot, so running it
 * is optional: use it to prepare a database ahead of a deploy, or to check that the
 * connection string and permissions are right.
 *
 *   bun run db:setup
 */

import { closeDb, COLLECTION_DEFINITIONS, getDb, pingDatabase } from "../src/bun/db";

try {
	const db = await getDb();
	const latency = await pingDatabase();
	console.log(`Connected to "${db.databaseName}" (${latency} ms round trip).\n`);

	for (const definition of COLLECTION_DEFINITIONS) {
		const collection = db.collection(definition.name);
		const [documents, indexes] = await Promise.all([
			collection.estimatedDocumentCount(),
			collection.indexes(),
		]);
		console.log(
			`${definition.name.padEnd(28)} ${String(documents).padStart(6)} docs   ${indexes.length} indexes`,
		);
	}
	console.log("\nSchema is up to date.");
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
} finally {
	await closeDb();
}
