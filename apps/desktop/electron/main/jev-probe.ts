/**
 * Reachability check for the Jev classifier key.
 *
 * Jev is configured from settings, where a wrong or expired key would
 * otherwise be discovered by the Agent mid-task. The check is the smallest
 * real System One round trip — one boolean question over a one-field state —
 * against the same address and classifier id the Agent's `JevClassify` tool
 * uses, so "the key works" means the endpoint answered this key, not that the
 * string looks plausible.
 *
 * The endpoint is the TypeSafe default unless the caller passes the user's
 * configured one (a System One relay such as Zhizengzeng, or a self-hosted
 * gateway). A configured endpoint is a user-typed address, so it is judged by
 * the same user-endpoint policy as a model base URL: HTTPS anywhere, plain
 * HTTP only when the caller's stored network policy allows it.
 *
 * Nothing is written here: the caller stores the key only when this answered.
 * The key never reaches a log line or an error message; failure text is
 * redacted before it is returned.
 */
import {
  TYPESAFE_JEV_MODEL_ID,
  TYPESAFE_SYSTEM_ONE_URL,
  isSafeUserEndpointUrl,
  jevSystemOneUrl,
  type JevEndpoint,
  type JevKeyCheckResult,
} from "@pi-desktop/shared";

export const JEV_PROBE_TIMEOUT_MS = 20_000;

/** Longest provider message echoed back to the settings dialog. */
const MAX_DETAIL_LENGTH = 300;

export type JevProbeOptions = {
  /** The caller's own cancellation, combined with the timeout. */
  signal?: AbortSignal;
  /** Test seam; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** The user's configured endpoint; absent checks the TypeSafe default. */
  endpoint?: JevEndpoint;
  /**
   * Whether the stored network policy allows plain `http` for this user-typed
   * endpoint. Decided by the caller from settings, never by the renderer.
   */
  allowInsecureHttp?: boolean;
};

/**
 * The smallest valid System One request: `bool` is PI-Desktop's public name for
 * the wire-level `noul` question (see pi-ai's System One transport).
 */
function probeRequestBody(modelId: string) {
  return {
    model: modelId,
    state: { probe: true },
    questions: {
      reachable: {
        type: "noul",
        instructions: "Did this request reach the classifier?",
        criteria: {
          true: "The request reached the classifier.",
          false: "The request did not reach the classifier.",
        },
      },
    },
  };
}

/** A message that never carries the credential it describes. */
function redact(value: string, apiKey: string): string {
  if (!apiKey) return value;
  return value.split(apiKey).join("[redacted]");
}

export async function probeJevApiKey(
  apiKey: string,
  options: JevProbeOptions = {},
): Promise<JevKeyCheckResult> {
  const key = apiKey.trim();
  const endpoint = options.endpoint;
  if (!key) {
    return {
      ok: false,
      message: endpoint
        ? "No API key was provided."
        : "No TypeSafe API key was provided.",
    };
  }
  let url = TYPESAFE_SYSTEM_ONE_URL;
  let modelId = TYPESAFE_JEV_MODEL_ID;
  let service = "TypeSafe";
  if (endpoint) {
    if (
      !isSafeUserEndpointUrl(endpoint.baseUrl, {
        allowInsecureHttp: options.allowInsecureHttp === true,
      })
    ) {
      return {
        ok: false,
        message:
          "The Jev endpoint URL is not allowed: use HTTPS, or plain HTTP to your own machine under the relaxed network policy.",
      };
    }
    url = jevSystemOneUrl(endpoint.baseUrl);
    modelId = endpoint.modelId;
    service = new URL(endpoint.baseUrl).hostname;
  }
  const timeoutMs = options.timeoutMs ?? JEV_PROBE_TIMEOUT_MS;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  try {
    const response = await doFetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(probeRequestBody(modelId)),
      signal,
    });
    if (response.ok) return { ok: true, status: response.status };
    const body = await response.text().catch(() => "");
    const detail = redact(body.slice(0, MAX_DETAIL_LENGTH).trim(), key);
    return {
      ok: false,
      status: response.status,
      message: detail
        ? `${service} returned ${response.status}: ${detail}`
        : `${service} returned ${response.status}`,
    };
  } catch (error) {
    if (options.signal?.aborted) {
      return {
        ok: false,
        message: endpoint
          ? "The Jev key check was cancelled."
          : "The TypeSafe key check was cancelled.",
      };
    }
    const name = (error as { name?: unknown }).name;
    if (name === "TimeoutError" || name === "AbortError") {
      return {
        ok: false,
        message: `${service} did not answer within ${Math.round(timeoutMs / 1000)}s.`,
      };
    }
    return { ok: false, message: redact(error instanceof Error ? error.message : String(error), key) };
  }
}