import type { IncomingMessage } from "node:http";

export const ADMIN_COOKIE_NAME = "polvenn_admin_token";

export function extractBearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (!header) {
    return null;
  }

  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }

  const token = match[1]?.trim();
  return token ? token : null;
}

export function parseCookies(request: IncomingMessage): Record<string, string> {
  const header = request.headers.cookie;
  if (!header) {
    return {};
  }

  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separatorIndex = part.indexOf("=");
        if (separatorIndex === -1) {
          return [part, ""];
        }

        const key = part.slice(0, separatorIndex).trim();
        const value = part.slice(separatorIndex + 1).trim();
        return [key, decodeURIComponent(value)];
      }),
  );
}

export function extractAdminCookieToken(request: IncomingMessage): string | null {
  const cookies = parseCookies(request);
  return cookies[ADMIN_COOKIE_NAME] ?? null;
}

export function buildAdminSessionCookie(token: string, secure: boolean): string {
  const parts = [
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];

  if (secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function buildAdminLogoutCookie(secure: boolean): string {
  const parts = [
    `${ADMIN_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];

  if (secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function isAuthorizedRequest(
  request: IncomingMessage,
  adminToken: string | null,
): boolean {
  if (!adminToken) {
    return true;
  }

  return extractBearerToken(request) === adminToken
    || extractAdminCookieToken(request) === adminToken;
}
