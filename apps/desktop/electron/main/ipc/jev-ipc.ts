/**
 * The Jev key check channel.
 *
 * One job, separate from the provider channels: Jev owns no provider row, and
 * its credential lives under a fixed Host secret reference rather than a
 * provider id. The handler only asks the configured System One endpoint; it
 * stores nothing, so a key that fails the check never reaches the secret
 * store.
 *
 * The payload is the bare key for the TypeSafe default, or
 * `{ apiKey, endpoint }` for a user-configured endpoint. An endpoint that
 * fails normalization is refused here rather than dropped: silently falling
 * back to TypeSafe would spend the user's key on an address they did not type.
 * The plaintext-HTTP decision comes from the main process's mirrored network
 * policy, never from the renderer.
 */
import { IPC, normalizeJevEndpoint, type JevEndpoint, type JevKeyCheckResult } from "@pi-desktop/shared";
import { allowInsecureUserEndpointsEnabled } from "../endpoint-policy";
import { probeJevApiKey } from "../jev-probe";
import type { Logger } from "../logger";
import type { IpcRegistrar } from "./types";

export type JevIpcDependencies = {
  registrar: IpcRegistrar;
  logger: Pick<Logger, "app">;
};

export function registerJevIpc({ registrar, logger }: JevIpcDependencies): void {
  registrar.handle(IPC.invoke.jevTest, async (payload: unknown) => {
    const legacyKey = typeof payload === "string";
    const request =
      payload && typeof payload === "object"
        ? (payload as { apiKey?: unknown; endpoint?: unknown })
        : {};
    const apiKey = legacyKey
      ? (payload as string)
      : typeof request.apiKey === "string"
        ? request.apiKey
        : "";
    let endpoint: JevEndpoint | undefined;
    let result: JevKeyCheckResult;
    if (!legacyKey && request.endpoint !== undefined) {
      endpoint = normalizeJevEndpoint(request.endpoint);
      if (!endpoint) {
        result = { ok: false, message: "The Jev endpoint is invalid." };
        logger.app("provider", "warn", "Jev endpoint key check", {
          data: { ok: false, custom: true },
        });
        return result;
      }
    }
    result = await probeJevApiKey(apiKey, {
      ...(endpoint ? { endpoint } : {}),
      allowInsecureHttp: allowInsecureUserEndpointsEnabled(),
    });
    logger.app(
      "provider",
      result.ok ? "info" : "warn",
      endpoint ? "Jev endpoint key check" : "TypeSafe Jev key check",
      {
        data: { ok: result.ok, status: result.status, custom: endpoint !== undefined },
      },
    );
    return result;
  });
}