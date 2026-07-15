import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { Database } from "bun:sqlite";

const WEB_SESSION_DATABASE_FILE = "habitat-web-sessions.sqlite";

export type WebSessionMetadata = {
  id: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
};

type WebSessionRow = {
  session_id: string;
  created_at: number;
  expires_at: number;
  last_seen_at: number;
};

export type WebSessionStore = {
  create: (tokenHash: string, expiresAt: Date) => WebSessionMetadata;
  getActive: (tokenHash: string) => WebSessionMetadata | undefined;
  revoke: (tokenHash: string) => void;
  listActive: () => WebSessionMetadata[];
};

export function createWebSessionStore(): WebSessionStore {
  const db = new Database(getWebSessionDatabasePath(), { create: true });
  ensureSchema(db);

  function removeExpiredSessions(): void {
    db.query("DELETE FROM web_sessions WHERE expires_at <= $now").run({ $now: Date.now() });
  }

  return {
    create(tokenHash, expiresAt) {
      removeExpiredSessions();

      const now = Date.now();
      const session: WebSessionRow = {
        session_id: randomBytes(12).toString("base64url"),
        created_at: now,
        expires_at: expiresAt.getTime(),
        last_seen_at: now,
      };

      db.query(`
        INSERT INTO web_sessions (session_id, token_hash, created_at, expires_at, last_seen_at)
        VALUES ($sessionId, $tokenHash, $createdAt, $expiresAt, $lastSeenAt)
      `).run({
        $sessionId: session.session_id,
        $tokenHash: tokenHash,
        $createdAt: session.created_at,
        $expiresAt: session.expires_at,
        $lastSeenAt: session.last_seen_at,
      });

      return toMetadata(session);
    },
    getActive(tokenHash) {
      removeExpiredSessions();

      const session = db.query<WebSessionRow>(`
        SELECT session_id, created_at, expires_at, last_seen_at
        FROM web_sessions
        WHERE token_hash = $tokenHash
      `).get({ $tokenHash: tokenHash });

      if (!session) {
        return undefined;
      }

      const lastSeenAt = Date.now();
      db.query("UPDATE web_sessions SET last_seen_at = $lastSeenAt WHERE session_id = $sessionId").run({
        $lastSeenAt: lastSeenAt,
        $sessionId: session.session_id,
      });

      return toMetadata({ ...session, last_seen_at: lastSeenAt });
    },
    revoke(tokenHash) {
      db.query("DELETE FROM web_sessions WHERE token_hash = $tokenHash").run({ $tokenHash: tokenHash });
    },
    listActive() {
      removeExpiredSessions();
      const sessions = db.query<WebSessionRow>(`
        SELECT session_id, created_at, expires_at, last_seen_at
        FROM web_sessions
        ORDER BY created_at DESC
      `).all();

      return sessions.map(toMetadata);
    },
  };
}

function getWebSessionDatabasePath(): string {
  return process.env.HABITAT_WEB_SESSION_DB_PATH ?? join(process.cwd(), WEB_SESSION_DATABASE_FILE);
}

function ensureSchema(db: Database): void {
  db.query(`
    CREATE TABLE IF NOT EXISTS web_sessions (
      session_id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    )
  `).run();
}

function toMetadata(row: WebSessionRow): WebSessionMetadata {
  return {
    id: row.session_id,
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
    lastSeenAt: new Date(row.last_seen_at).toISOString(),
  };
}
