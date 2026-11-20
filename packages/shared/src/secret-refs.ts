/**
 * Fixed constants owned by first-party desktop integrations: the Host secret
 * references their credentials are stored under, and the addresses those
 * credentials are spent on.
 */
export const JEV_API_KEY_SECRET_REF = "secret:app:typesafe-jev";

/**
 * The default TypeSafe System One endpoint behind Jev, and the classifier it
 * asks. A user-configured `jevEndpoint` (see `jev-endpoint.ts`) replaces the
 * address and model id; these constants remain the absent-endpoint default.
 *
 * The settings key check calls this address. The Agent's `JevClassify` tool
 * reaches the same one through pi-ai's `typesafe` provider, whose published
 * base URL resolves to it; if that address ever moves in pi-ai, this constant
 * is what the check has to follow.
 */
export const TYPESAFE_JEV_BASE_URL = "https://api.typesafe.ai/v1";
export const TYPESAFE_SYSTEM_ONE_URL = `${TYPESAFE_JEV_BASE_URL}/systemone`;
export const TYPESAFE_JEV_MODEL_ID = "jev-latest";
