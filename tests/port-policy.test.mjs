import assert from "node:assert/strict";
import test from "node:test";
import { isProtectedPort, readProtectedPorts } from "../scripts/port-policy.mjs";

test("default protected ports include the local VPN proxy port", () => {
  const protectedPorts = readProtectedPorts([], "");

  assert.equal(isProtectedPort(17891, protectedPorts), true);
  assert.equal(isProtectedPort(5180, protectedPorts), false);
});

test("protected ports can be extended by local config and environment", () => {
  const protectedPorts = readProtectedPorts([3000, "4000"], "5000,not-a-port,70000");

  assert.equal(isProtectedPort(17891, protectedPorts), true);
  assert.equal(isProtectedPort(3000, protectedPorts), true);
  assert.equal(isProtectedPort(4000, protectedPorts), true);
  assert.equal(isProtectedPort(5000, protectedPorts), true);
  assert.equal(isProtectedPort(70000, protectedPorts), false);
});
