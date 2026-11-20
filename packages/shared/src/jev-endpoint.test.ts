import { describe, expect, it } from "vitest";
import {
  DEFAULT_JEV_BASE_URL,
  DEFAULT_JEV_MODEL_ID,
  ZHIZENGZENG_JEV_BASE_URL,
  jevEndpointsEqual,
  jevSystemOneUrl,
  normalizeJevEndpoint,
} from "./jev-endpoint.js";
import { TYPESAFE_SYSTEM_ONE_URL } from "./secret-refs.js";

describe("normalizeJevEndpoint", () => {
  it("absent and null mean the TypeSafe default", () => {
    expect(normalizeJevEndpoint(undefined)).toBeUndefined();
    expect(normalizeJevEndpoint(null)).toBeUndefined();
  });

  it("keeps a relay endpoint and defaults the model id", () => {
    expect(normalizeJevEndpoint({ baseUrl: ZHIZENGZENG_JEV_BASE_URL })).toEqual({
      baseUrl: ZHIZENGZENG_JEV_BASE_URL,
      modelId: DEFAULT_JEV_MODEL_ID,
    });
  });

  it("keeps a loopback endpoint with an explicit model and image input", () => {
    expect(
      normalizeJevEndpoint({
        baseUrl: "http://127.0.0.1:8080/v1/",
        modelId: "jev-local",
        imageInput: "state-image-urls",
      }),
    ).toEqual({
      baseUrl: "http://127.0.0.1:8080/v1",
      modelId: "jev-local",
      imageInput: "state-image-urls",
    });
  });

  it("refuses malformed shapes instead of guessing", () => {
    expect(normalizeJevEndpoint("https://api.typesafe.ai/v1")).toBeUndefined();
    expect(normalizeJevEndpoint([])).toBeUndefined();
    expect(normalizeJevEndpoint({})).toBeUndefined();
    expect(normalizeJevEndpoint({ baseUrl: "   " })).toBeUndefined();
    expect(normalizeJevEndpoint({ baseUrl: "not a url" })).toBeUndefined();
    expect(normalizeJevEndpoint({ baseUrl: "ftp://example.com/v1" })).toBeUndefined();
    expect(
      normalizeJevEndpoint({ baseUrl: "https://user:pass@example.com/v1" }),
    ).toBeUndefined();
    expect(
      normalizeJevEndpoint({ baseUrl: DEFAULT_JEV_BASE_URL, modelId: "  " }),
    ).toBeUndefined();
    expect(
      normalizeJevEndpoint({ baseUrl: DEFAULT_JEV_BASE_URL, modelId: 7 }),
    ).toBeUndefined();
    expect(
      normalizeJevEndpoint({ baseUrl: DEFAULT_JEV_BASE_URL, imageInput: "other" }),
    ).toBeUndefined();
    expect(
      normalizeJevEndpoint({ baseUrl: DEFAULT_JEV_BASE_URL, extra: true }),
    ).toBeUndefined();
    expect(
      normalizeJevEndpoint({ baseUrl: `https://${"x".repeat(2100)}.com/v1` }),
    ).toBeUndefined();
  });
});

describe("jevSystemOneUrl", () => {
  it("applies the same rule as pi-ai's System One transport", () => {
    expect(jevSystemOneUrl(DEFAULT_JEV_BASE_URL)).toBe(TYPESAFE_SYSTEM_ONE_URL);
    expect(jevSystemOneUrl(ZHIZENGZENG_JEV_BASE_URL)).toBe(
      "https://api.zhizengzeng.com/v1/systemone",
    );
    expect(jevSystemOneUrl("http://127.0.0.1:8080/v1///")).toBe(
      "http://127.0.0.1:8080/v1/systemone",
    );
  });
});

describe("jevEndpointsEqual", () => {
  it("compares the fields that decide where requests go", () => {
    const endpoint = { baseUrl: ZHIZENGZENG_JEV_BASE_URL, modelId: "jev-latest" };
    expect(jevEndpointsEqual(undefined, undefined)).toBe(true);
    expect(jevEndpointsEqual(endpoint, undefined)).toBe(false);
    expect(jevEndpointsEqual(endpoint, { ...endpoint })).toBe(true);
    expect(jevEndpointsEqual(endpoint, { ...endpoint, modelId: "other" })).toBe(false);
    expect(
      jevEndpointsEqual(endpoint, { ...endpoint, imageInput: "assets" }),
    ).toBe(false);
  });
});