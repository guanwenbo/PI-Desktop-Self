/**
 * The Jev classifier endpoint a user configured (D625 amendment).
 *
 * Jev speaks pi-ai's System One protocol, and that transport builds its URL
 * from the model's base URL — TypeSafe itself, a relay that forwards the same
 * protocol (Zhizengzeng), or a self-hosted gateway all answer at
 * `<baseUrl>/systemone`. This module owns the persisted shape, its
 * normalization, and the one URL rule, so the settings check and the Agent's
 * `JevClassify` tool cannot drift apart.
 *
 * Address trust is not decided here: `isSafeUserEndpointUrl` plus the stored
 * network policy judge whether a normalized endpoint may be dialed (plain
 * `http` only under the relaxed policy, e.g. a loopback deployment).
 */
import { TYPESAFE_JEV_BASE_URL, TYPESAFE_JEV_MODEL_ID } from "./secret-refs.js";

/** Zhizengzeng forwards the native System One protocol at this base URL. */
export const ZHIZENGZENG_JEV_BASE_URL = "https://api.zhizengzeng.com/v1";

export const DEFAULT_JEV_BASE_URL = TYPESAFE_JEV_BASE_URL;
export const DEFAULT_JEV_MODEL_ID = TYPESAFE_JEV_MODEL_ID;

/**
 * How the endpoint takes image state. Absent follows pi-ai's host detection
 * (TypeSafe-style `assets` with the opt-in header, OpenRouter-style state
 * image URLs); a proxy that hides its identity needs the explicit choice.
 */
export type JevImageInput = "assets" | "state-image-urls";

/** Persisted as `AppSettings.jevEndpoint`; absent means the TypeSafe default. */
export type JevEndpoint = {
  /** Protocol + host + path prefix, without the trailing `/systemone`. */
  baseUrl: string;
  /** Classifier model id sent in the request body; normally `jev-latest`. */
  modelId: string;
  imageInput?: JevImageInput;
};

const MAX_BASE_URL_LENGTH = 2048;
const MAX_MODEL_ID_LENGTH = 128;

/**
 * Keep only the fields this endpoint defines, with usable values. Anything
 * malformed answers `undefined` — the caller treats that as "no endpoint"
 * for reads and as a refused write for settings validation, never as a
 * silent fallback that would spend a key on an address the user did not type.
 */
export function normalizeJevEndpoint(value: unknown): JevEndpoint | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) => key !== "baseUrl" && key !== "modelId" && key !== "imageInput",
    )
  ) {
    return undefined;
  }
  if (typeof record.baseUrl !== "string") return undefined;
  const baseUrl = record.baseUrl.trim().replace(/\/+$/u, "");
  if (!baseUrl || baseUrl.length > MAX_BASE_URL_LENGTH) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
  if (parsed.username || parsed.password) return undefined;
  const modelId =
    record.modelId === undefined
      ? TYPESAFE_JEV_MODEL_ID
      : typeof record.modelId === "string"
        ? record.modelId.trim()
        : "";
  if (!modelId || modelId.length > MAX_MODEL_ID_LENGTH) return undefined;
  const imageInput = record.imageInput;
  if (
    imageInput !== undefined &&
    imageInput !== "assets" &&
    imageInput !== "state-image-urls"
  ) {
    return undefined;
  }
  return {
    baseUrl,
    modelId,
    ...(imageInput === undefined ? {} : { imageInput }),
  };
}

/**
 * The System One address for one base URL — the same rule pi-ai's transport
 * applies (`<baseUrl>/systemone`), so the check and the tool agree.
 */
export function jevSystemOneUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/u, "")}/systemone`;
}

/** Whether two endpoints would send the same requests to the same place. */
export function jevEndpointsEqual(
  left: JevEndpoint | undefined,
  right: JevEndpoint | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    left.baseUrl === right.baseUrl &&
    left.modelId === right.modelId &&
    left.imageInput === right.imageInput
  );
}