/**
 * The order Jev's credential and switch move in.
 *
 * Adding Jev stores a key only after TypeSafe answered it and then enables the
 * classifier; removing Jev disables it before the key is deleted. Both orders
 * are the contract this test pins, because either one reversed leaves a state
 * the Agent cannot run in: an enabled classifier without a key, or a key with
 * nothing to spend it on.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { addJevService, removeJevService } from "../src/components/settings/jev-config.ts";

const KEY = "typesafe-fixture-key";

/** Records what the caller asked for, in the order it happened. */
function deps({ check = { ok: true, status: 200 }, failStore = false } = {}) {
  const log = [];
  return {
    log,
    config: {
      probe: async (key) => {
        log.push(["probe", key]);
        return check;
      },
      storeKey: async (key) => {
        log.push(["store", key]);
        if (failStore) throw new Error("secret store unavailable");
      },
      deleteKey: async () => {
        log.push(["delete"]);
      },
      setEnabled: async (enabled) => {
        log.push(["enabled", enabled]);
      },
    },
  };
}

test("a key that answered is stored, then Jev is enabled", async () => {
  const { log, config } = deps();
  const outcome = await addJevService(config, `  ${KEY}  `);

  assert.deepEqual(outcome, { ok: true });
  assert.deepEqual(log, [
    ["probe", KEY],
    ["store", KEY],
    ["enabled", true],
  ]);
});

test("a blank key is never probed and never stored", async () => {
  const { log, config } = deps();
  assert.deepEqual(await addJevService(config, "   "), { ok: false, reason: "missing-key" });
  assert.deepEqual(log, []);
});

test("a check the user closed the dialog on is cancelled, not stored", async () => {
  const { log, config } = deps();
  const controller = new AbortController();
  // The dialog closes while TypeSafe is still thinking, then answers ok.
  config.probe = async (key) => {
    log.push(["probe", key]);
    controller.abort();
    return { ok: true, status: 200 };
  };
  const outcome = await addJevService(config, KEY, controller.signal);

  assert.deepEqual(outcome, { ok: false, reason: "cancelled" });
  assert.deepEqual(log, [["probe", KEY]]);
});

test("a key TypeSafe refused is reported and nothing is written", async () => {
  const { log, config } = deps({
    check: { ok: false, status: 401, message: "TypeSafe returned 401: invalid key" },
  });
  const outcome = await addJevService(config, KEY);

  assert.deepEqual(outcome, {
    ok: false,
    reason: "check-failed",
    status: 401,
    message: "TypeSafe returned 401: invalid key",
  });
  // Only the check happened: a refused key must not reach the secret store,
  // and must not switch the classifier on.
  assert.deepEqual(log, [["probe", KEY]]);
});

test("a store failure surfaces and leaves Jev disabled", async () => {
  const { log, config } = deps({ failStore: true });
  await assert.rejects(() => addJevService(config, KEY), /secret store unavailable/);
  assert.deepEqual(log, [
    ["probe", KEY],
    ["store", KEY],
  ]);
});

test("removing Jev disables it before the key is deleted", async () => {
  const { log, config } = deps();
  await removeJevService(config);
  assert.deepEqual(log, [["enabled", false], ["delete"]]);
});

const ENDPOINT = { baseUrl: "https://api.zhizengzeng.com/v1", modelId: "jev-latest" };

/** Same recorder, but the endpoint arguments are part of the contract too. */
function endpointDeps({ check = { ok: true, status: 200 } } = {}) {
  const log = [];
  return {
    log,
    config: {
      probe: async (key, endpoint) => {
        log.push(["probe", key, endpoint]);
        return check;
      },
      storeKey: async (key) => {
        log.push(["store", key]);
      },
      deleteKey: async () => {
        log.push(["delete"]);
      },
      setEnabled: async (enabled, endpoint) => {
        log.push(["enabled", enabled, endpoint]);
      },
    },
  };
}

test("the endpoint is probed with the key and rides the enabling write", async () => {
  const { log, config } = endpointDeps();
  const outcome = await addJevService(config, KEY, undefined, ENDPOINT);
  assert.deepEqual(outcome, { ok: true });
  assert.deepEqual(log, [
    ["probe", KEY, ENDPOINT],
    ["store", KEY],
    ["enabled", true, ENDPOINT],
  ]);
});

test("adding the default service clears a stored endpoint", async () => {
  const { log, config } = endpointDeps();
  await addJevService(config, KEY);
  assert.deepEqual(log, [
    ["probe", KEY, undefined],
    ["store", KEY],
    ["enabled", true, null],
  ]);
});

test("a key the relay refused writes nothing", async () => {
  const { log, config } = endpointDeps({
    check: { ok: false, status: 401, message: "api.zhizengzeng.com returned 401" },
  });
  const outcome = await addJevService(config, KEY, undefined, ENDPOINT);
  assert.equal(outcome.ok, false);
  assert.deepEqual(log, [["probe", KEY, ENDPOINT]]);
});

test("removing Jev clears the endpoint with the switch", async () => {
  const { log, config } = endpointDeps();
  await removeJevService(config);
  assert.deepEqual(log, [["enabled", false, null], ["delete"]]);
});
