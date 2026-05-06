import type Database from "better-sqlite3";

export function now() {
  return Date.now();
}

export function parseEventRetentionLimit(name: string) {
  const value = process.env[name];
  if (value == null || value.trim() === "") {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer when set.`);
  }
  return parsed;
}

export function configureDatabaseConnection(db: Database.Database) {
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
}

export function ensureSchemaMigrationsTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);
}

function hasSchemaMigration(db: Database.Database, version: number) {
  const row = db
    .prepare(`SELECT version FROM schema_migrations WHERE version = ?`)
    .get(version) as { version: number } | undefined;
  return Boolean(row);
}

export function recordSchemaMigration(db: Database.Database, version: number, name: string) {
  db.prepare(
    `INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)`,
  ).run(version, name, now());
}

export function runSchemaMigration(
  db: Database.Database,
  version: number,
  name: string,
  migrate: () => void,
) {
  if (hasSchemaMigration(db, version)) {
    return;
  }
  migrate();
  recordSchemaMigration(db, version, name);
}
