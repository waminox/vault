import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config";

/**
 * SQLite via Node's built-in driver (no native build step). The database holds
 * metadata only; media bytes live encrypted in the blob store.
 */

const MIGRATIONS: string[] = [
  // v1
  `
  CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE sessions (
    id           TEXT PRIMARY KEY,           -- sha256(token), the raw token only lives in the cookie
    created_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    ip           TEXT,
    user_agent   TEXT
  );

  CREATE TABLE login_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    at         INTEGER NOT NULL,
    ip         TEXT,
    user_agent TEXT,
    success    INTEGER NOT NULL,
    reason     TEXT
  );

  CREATE TABLE albums (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    position      TEXT NOT NULL,
    cover_item_id TEXT,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  );

  CREATE TABLE items (
    id          TEXT PRIMARY KEY,
    album_id    TEXT REFERENCES albums(id) ON DELETE SET NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('image','video')),
    name        TEXT NOT NULL,
    mime        TEXT NOT NULL,
    size        INTEGER NOT NULL,
    sha256      TEXT,
    width       INTEGER,
    height      INTEGER,
    duration    REAL,
    taken_at    INTEGER,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    position    TEXT NOT NULL,
    favorite    INTEGER NOT NULL DEFAULT 0,
    deleted_at  INTEGER,
    color       TEXT,
    status      TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','ready','failed')),
    progress    REAL,
    error       TEXT,
    variants    TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX items_album_pos ON items(album_id, position);
  CREATE INDEX items_created  ON items(created_at);
  CREATE INDEX items_sha      ON items(sha256);
  CREATE INDEX items_deleted  ON items(deleted_at);

  CREATE TABLE uploads (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    size         INTEGER NOT NULL,
    chunk_size   INTEGER NOT NULL,
    total_chunks INTEGER NOT NULL,
    album_id     TEXT,
    last_modified INTEGER,
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    client_meta  TEXT
  );

  CREATE TABLE upload_chunks (
    upload_id TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
    idx       INTEGER NOT NULL,
    PRIMARY KEY (upload_id, idx)
  );

  CREATE TABLE jobs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id    TEXT NOT NULL,
    type       TEXT NOT NULL,
    payload    TEXT,
    status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed')),
    attempts   INTEGER NOT NULL DEFAULT 0,
    error      TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX jobs_status ON jobs(status, id);
  `,
];

function open(): DatabaseSync {
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(config.dbPath);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;");
  const { user_version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let v = user_version; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
  try {
    fs.chmodSync(config.dbPath, 0o600);
  } catch {}
  return db;
}

const g = globalThis as unknown as { __vaultDb?: DatabaseSync };

export function db(): DatabaseSync {
  g.__vaultDb ??= open();
  return g.__vaultDb;
}

/** Run fn inside a transaction (synchronous; node:sqlite is sync). */
export function tx<T>(fn: () => T): T {
  const d = db();
  d.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    d.exec("COMMIT");
    return out;
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  }
}

export function getMeta(key: string): string | undefined {
  const row = db().prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function setMeta(key: string, value: string | null): void {
  if (value === null) db().prepare("DELETE FROM meta WHERE key = ?").run(key);
  else db().prepare("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

/** For tests: drop the cached handle so a new data dir can be used. */
export function closeDb(): void {
  g.__vaultDb?.close();
  g.__vaultDb = undefined;
}
