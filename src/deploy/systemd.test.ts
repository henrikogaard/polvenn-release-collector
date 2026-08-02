import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const unit = readFileSync(
  new URL("../../deploy/systemd/polvenn-release-collector.service", import.meta.url),
  "utf8",
);

test("systemd unit applies the reviewed unprivileged sandbox", () => {
  for (const directive of [
    "AmbientCapabilities=",
    "CapabilityBoundingSet=",
    "DevicePolicy=closed",
    "KeyringMode=private",
    "LockPersonality=true",
    "PrivateDevices=true",
    "PrivateIPC=true",
    "ProcSubset=pid",
    "ProtectClock=true",
    "ProtectControlGroups=true",
    "ProtectHostname=true",
    "ProtectKernelLogs=true",
    "ProtectKernelModules=true",
    "ProtectKernelTunables=true",
    "ProtectProc=invisible",
    "RemoveIPC=true",
    "RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6",
    "RestrictNamespaces=true",
    "RestrictRealtime=true",
    "RestrictSUIDSGID=true",
    "SystemCallArchitectures=native",
    "UMask=0077",
  ]) {
    assert.match(unit, new RegExp(`^${directive.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}$`, "m"));
  }
});
