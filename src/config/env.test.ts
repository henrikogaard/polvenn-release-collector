import assert from "node:assert/strict";
import test from "node:test";

async function loadEnv(host: string | undefined) {
  if (host === undefined) {
    delete process.env.POLVENN_COLLECTOR_HOST;
  } else {
    process.env.POLVENN_COLLECTOR_HOST = host;
  }

  const moduleUrl = new URL(`./env.js?test=${crypto.randomUUID()}`, import.meta.url);
  return (await import(moduleUrl.href)).env;
}

test("collector host defaults to IPv4 loopback", async () => {
  const env = await loadEnv(undefined);
  assert.equal(env.host, "127.0.0.1");
});

test("collector host can be configured explicitly", async () => {
  const env = await loadEnv("::1");
  assert.equal(env.host, "::1");
});
