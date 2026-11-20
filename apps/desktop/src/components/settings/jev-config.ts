/**
 * The order Jev's credential, endpoint, and switch move in.
 *
 * Adding Jev means "a key that works is stored, and the classifier is on", in
 * that order: the key is checked against the configured System One endpoint
 * first, nothing is written when the check fails, and only a key that answered
 * becomes `jevEnabled`. The endpoint travels with the enabling write, so there
 * is no intermediate state where the switch is on against a stale address. So
 * an enabled Jev always has a key the Agent can actually spend, at the address
 * the user chose.
 *
 * Removing Jev takes the switch down before the key is deleted, and clears the
 * endpoint with the switch, so no state in between can leave an enabled
 * classifier without a key or a stored endpoint without a service. Closing the
 * dialog abandons an in-flight check the same way: cancel means nothing was
 * kept.
 *
 * This lives outside the components because the settings card and the service
 * dialog both drive it, and because the order is the part worth testing. It
 * imports nothing at runtime: the caller supplies the effects.
 */
import type { JevEndpoint, JevKeyCheckResult } from "@pi-desktop/shared";

export type JevConfigDeps = {
  /** Ask the endpoint whether the key works; never stores anything. */
  probe: (key: string, endpoint?: JevEndpoint) => Promise<JevKeyCheckResult>;
  storeKey: (key: string) => Promise<void>;
  deleteKey: () => Promise<void>;
  /**
   * Persist the switch. `endpoint` rides along when present: `null` clears a
   * stored endpoint back to the TypeSafe default, `undefined` leaves the
   * stored endpoint untouched (the card's toggle never retargets the service).
   */
  setEnabled: (enabled: boolean, endpoint?: JevEndpoint | null) => Promise<void>;
};

export type JevAddOutcome =
  | { ok: true }
  | { ok: false; reason: "missing-key" }
  | { ok: false; reason: "cancelled" }
  | { ok: false; reason: "check-failed"; status?: number; message?: string };

/**
 * Store `apiKey` and turn Jev on at `endpoint`, or leave everything untouched.
 *
 * `signal` abandons the whole action: a dialog the user closed while the check
 * was still in flight must not come back later with a stored credential and an
 * enabled classifier. The check is the long part, so it is the only step that
 * needs the guard — everything after it has already been decided.
 */
export async function addJevService(
  deps: JevConfigDeps,
  apiKey: string,
  signal?: AbortSignal,
  endpoint?: JevEndpoint,
): Promise<JevAddOutcome> {
  const key = apiKey.trim();
  if (!key) return { ok: false, reason: "missing-key" };
  const check = await deps.probe(key, endpoint);
  if (signal?.aborted) return { ok: false, reason: "cancelled" };
  if (!check.ok) {
    return { ok: false, reason: "check-failed", status: check.status, message: check.message };
  }
  await deps.storeKey(key);
  await deps.setEnabled(true, endpoint ?? null);
  return { ok: true };
}

/**
 * Turn Jev off, drop the endpoint, and delete the key; disabled first, so
 * neither step is orphaned.
 */
export async function removeJevService(
  deps: Pick<JevConfigDeps, "deleteKey" | "setEnabled">,
): Promise<void> {
  await deps.setEnabled(false, null);
  await deps.deleteKey();
}