CREATE TABLE IF NOT EXISTS content (
 id INTEGER PRIMARY KEY CHECK (id = 1),
 draft TEXT NOT NULL,
 published TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0,
 published_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY,
 csrf TEXT NOT NULL,
 credential_version TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS rate_limits (
 key TEXT PRIMARY KEY,
 count INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_expiry ON rate_limits(expires_at);
CREATE TABLE IF NOT EXISTS analytics (
 day TEXT NOT NULL,
 lang TEXT NOT NULL CHECK(lang IN ('ar','en')),
 kind TEXT NOT NULL CHECK(kind IN ('view','links','projects','resources')),
 card_id TEXT NOT NULL DEFAULT '',
 count INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(day, lang, kind, card_id)
);

CREATE TABLE IF NOT EXISTS import_chunks (run_id TEXT NOT NULL, field TEXT NOT NULL, sequence INTEGER NOT NULL, chunk TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000), PRIMARY KEY(run_id,field,sequence));
