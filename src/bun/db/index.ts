/**
 * MongoDB data layer.
 *
 * Import from "./db" as before: this barrel keeps the public surface in one place
 * while the implementation is split by domain.
 *
 *   client.ts             connection, transactions, error helpers
 *   schema.ts             collections, $jsonSchema validators and indexes
 *   seed.ts               first-boot owner account
 *   users.ts, sessions.ts, email-verification.ts, releases.ts,
 *   telegram-admins.ts, billing.ts, wallet.ts   one repository per area
 *
 * Every function is async and connects lazily, so no caller needs to initialise
 * the database first.
 */
export * from "./billing";
export * from "./client";
export * from "./email-verification";
export * from "./releases";
export * from "./schema";
export * from "./sessions";
export * from "./telegram-admins";
export * from "./types";
export * from "./users";
export * from "./wallet";
