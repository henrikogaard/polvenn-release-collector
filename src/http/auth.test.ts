import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_COOKIE_NAME,
  buildAdminLogoutCookie,
  buildAdminSessionCookie,
  extractAdminCookieToken,
  extractBearerToken,
  isAuthorizedRequest,
  parseCookies,
} from "./auth.js";

test("extractBearerToken returns bearer token from authorization header", () => {
  const request = {
    headers: {
      authorization: "Bearer super-secret-token",
    },
  };

  assert.equal(
    extractBearerToken(request as never),
    "super-secret-token",
  );
});

test("isAuthorizedRequest allows requests when no admin token is configured", () => {
  const request = {
    headers: {},
  };

  assert.equal(isAuthorizedRequest(request as never, null), true);
});

test("isAuthorizedRequest rejects wrong bearer token", () => {
  const request = {
    headers: {
      authorization: "Bearer wrong-token",
    },
  };

  assert.equal(isAuthorizedRequest(request as never, "expected-token"), false);
});

test("parseCookies reads cookie header", () => {
  const request = {
    headers: {
      cookie: "foo=bar; hello=world",
    },
  };

  assert.deepEqual(parseCookies(request as never), {
    foo: "bar",
    hello: "world",
  });
});

test("extractAdminCookieToken returns admin session cookie", () => {
  const request = {
    headers: {
      cookie: `${ADMIN_COOKIE_NAME}=topsecret`,
    },
  };

  assert.equal(extractAdminCookieToken(request as never), "topsecret");
});

test("isAuthorizedRequest accepts matching admin cookie", () => {
  const request = {
    headers: {
      cookie: `${ADMIN_COOKIE_NAME}=expected-token`,
    },
  };

  assert.equal(isAuthorizedRequest(request as never, "expected-token"), true);
});

test("buildAdminSessionCookie and logout cookie include expected attributes", () => {
  assert.match(buildAdminSessionCookie("token", true), /HttpOnly/);
  assert.match(buildAdminSessionCookie("token", true), /Secure/);
  assert.match(buildAdminLogoutCookie(true), /Max-Age=0/);
});
