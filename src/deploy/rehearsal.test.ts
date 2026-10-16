import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Execute the actual Compose command, rather than asserting its guard text.
// The flow-style command is JSON-compatible; $$ is Compose's literal-$ escape.
const profile = fs.readFileSync("docker-compose.rehearsal.yml", "utf8");
const commandLine = profile.split("\n").find((line) => line.trim().startsWith("command:"));
assert.ok(commandLine);
const command = (JSON.parse(commandLine.slice(commandLine.indexOf("[")).trim()) as string[])
  .map((part) => part.replaceAll("$$", "$"));

async function launch(token: string): Promise<{ started: boolean; code: number | null }> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "beer-guard-test-"));
  try {
    return await new Promise((resolve, reject) => {
      let started = false;
      let output = "";
      const child = spawn(command[0]!, command.slice(1), {
        cwd: process.cwd(),
        env: {
          PATH: process.env.PATH,
          POLVENN_COLLECTOR_ADMIN_TOKEN: token,
          POLVENN_COLLECTOR_HOST: "127.0.0.1",
          POLVENN_COLLECTOR_PORT: "0",
          POLVENN_COLLECTOR_DATA_DIR: directory,
          POLVENN_COLLECTOR_DB_PATH: path.join(directory, "collector.db"),
          POLVENN_COLLECTOR_SOURCES_PATH: path.join(directory, "config.json"),
          POLVENN_COLLECTOR_RUN_ON_START: "false",
          POLVENN_COLLECTOR_INTERVAL_MINUTES: "0",
          POLVENN_COLLECTOR_PUBLIC_STATUS_PAGE: "false",
        },
        stdio: ["ignore", "ignore", "pipe"],
      });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("Rehearsal command did not stop or start within 5 seconds"));
      }, 5000);
      child.stderr.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes("Polvenn release collector listening")) {
          started = true;
          child.kill("SIGTERM");
        }
      });
      child.on("error", (error) => { clearTimeout(timer); reject(error); });
      child.on("close", (code) => { clearTimeout(timer); resolve({ started, code }); });
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

for (const [name, token] of [
  ["empty", ""],
  ["spaces", "   "],
  ["tabs and newlines", "\t\n"],
  ["short", "a".repeat(63)],
  ["long", "a".repeat(65)],
  ["uppercase", "A".repeat(64)],
  ["non-hex", "g".repeat(64)],
  ["padded", " " + "a".repeat(64)],
  ["trailing newline", "a".repeat(64) + "\n"],
] as const) {
  test(`rehearsal rejects ${name} token before API startup`, async () => {
    const result = await launch(token);
    assert.equal(result.started, false);
    assert.notEqual(result.code, 0);
  });
}

test("rehearsal accepts the documented lowercase hex token", async () => {
  assert.equal((await launch("a".repeat(64))).started, true);
});
