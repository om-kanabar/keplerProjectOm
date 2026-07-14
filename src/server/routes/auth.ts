import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { getKeplerToken } from "../../kepler";

const WEB_CODE_TTL_MS = 2 * 60 * 1000;
const WEB_CODE_REQUEST_COOLDOWN_MS = 5 * 60 * 1000;
const WEB_SESSION_TTL_SECONDS = 8 * 60 * 60;

type WebLoginCode = {
  expiresAt: Date;
  issuedAt: number;
};

type WebSession = {
  expiresAt: Date;
};

export function registerAuthRoutes(app: Hono): void {
  const webLoginCodes = new Map<string, WebLoginCode>();
  const webSessions = new Map<string, WebSession>();

  app.post("/auth/web", (c) => {
    const configuredToken = getKeplerToken();
    const suppliedToken = readBearerToken(c.req.header("Authorization"));

    if (!suppliedToken || !tokensMatch(suppliedToken, configuredToken)) {
      return Response.json({ error: { message: "Invalid Kepler API key." } }, { status: 401 });
    }

    removeExpiredCodes(webLoginCodes);
    const issuedAt = Date.now();
    const activeCode = [...webLoginCodes.values()].find(
      (login) => login.issuedAt + WEB_CODE_REQUEST_COOLDOWN_MS > issuedAt,
    );
    if (activeCode) {
      return Response.json(
        { error: { message: "A web login code is already active. Use it before requesting another." } },
        { status: 429 },
      );
    }

    const code = randomBytes(18).toString("base64url");
    const expiresAt = new Date(issuedAt + WEB_CODE_TTL_MS);
    webLoginCodes.set(hashSecret(code), { expiresAt, issuedAt });

    return Response.json({ code, expiresAt: expiresAt.toISOString() }, { status: 201 });
  });

  app.post("/auth/web/verify", async (c) => {
    const body = await c.req.json<{ code?: string }>();
    const codeHash = typeof body.code === "string" ? hashSecret(body.code) : "";
    const login = webLoginCodes.get(codeHash);

    if (!login || login.expiresAt.getTime() <= Date.now()) {
      return Response.json({ error: { message: "Invalid or expired web login code." } }, { status: 401 });
    }

    webLoginCodes.delete(codeHash);
    const sessionToken = randomBytes(32).toString("base64url");
    webSessions.set(hashSecret(sessionToken), {
      expiresAt: new Date(Date.now() + WEB_SESSION_TTL_SECONDS * 1000),
    });
    removeExpiredSessions(webSessions);

    c.header(
      "Set-Cookie",
      `habitat_session=${sessionToken}; Path=/; Max-Age=${WEB_SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`,
    );
    return c.json({ authenticated: true });
  });

  app.get("/auth/web/session", (c) => {
    const sessionToken = readCookie(c.req.header("Cookie"), "habitat_session");
    const session = sessionToken ? webSessions.get(hashSecret(sessionToken)) : undefined;

    if (!session || session.expiresAt.getTime() <= Date.now()) {
      if (sessionToken) {
        webSessions.delete(hashSecret(sessionToken));
      }

      return Response.json({ authenticated: false }, { status: 401 });
    }

    return Response.json({ authenticated: true });
  });
}

function readBearerToken(authorization: string | undefined): string | undefined {
  if (!authorization?.startsWith("Bearer ")) {
    return undefined;
  }

  return authorization.slice("Bearer ".length);
}

function tokensMatch(suppliedToken: string, configuredToken: string): boolean {
  const supplied = Buffer.from(suppliedToken);
  const configured = Buffer.from(configuredToken);

  return supplied.length === configured.length && timingSafeEqual(supplied, configured);
}

function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  return cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(name + "="))
    ?.slice(name.length + 1);
}

function removeExpiredCodes(webLoginCodes: Map<string, WebLoginCode>): void {
  const now = Date.now();

  for (const [code, login] of webLoginCodes) {
    if (login.issuedAt + WEB_CODE_REQUEST_COOLDOWN_MS <= now) {
      webLoginCodes.delete(code);
    }
  }
}

function removeExpiredSessions(webSessions: Map<string, WebSession>): void {
  const now = Date.now();

  for (const [tokenHash, session] of webSessions) {
    if (session.expiresAt.getTime() <= now) {
      webSessions.delete(tokenHash);
    }
  }
}
