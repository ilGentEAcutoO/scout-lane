import assert from "node:assert/strict";
import test from "node:test";
import { can, capabilities } from "./rbac.ts";
import { LIMITS, PIPELINE, STAGES } from "./limits.ts";

test("member cannot manage users or prompts", () => {
  assert.equal(can("member", "users.read"), false);
  assert.equal(can("member", "users.write"), false);
  assert.equal(can("member", "settings.write"), false);
  assert.equal(can("member", "jobs.write"), true);
  assert.equal(can("admin", "users.write"), true);
});

test("capabilities match PERMS", () => {
  assert.equal(capabilities("member")["users.write"], false);
  assert.equal(capabilities("admin")["settings.read"], true);
});

test("limits exist for names the UI and API share", () => {
  assert.ok(LIMITS.jobTitleMax < LIMITS.jobDescMax);
  assert.ok(LIMITS.passwordMin >= 10);
  assert.ok(LIMITS.usernameMax <= 32);
});

test("rejected is a drop status outside the hire path", () => {
  assert.equal(PIPELINE.includes("rejected"), false);
  assert.equal(STAGES.at(-1), "rejected");
  assert.deepEqual([...PIPELINE], STAGES.slice(0, -1));
});


