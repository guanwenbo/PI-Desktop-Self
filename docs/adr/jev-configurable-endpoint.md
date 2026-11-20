# ADR: Jev asks a configurable System One endpoint

- Status: Accepted for implementation
- Date: 2026-11-20
- Amends: spec 03-runtime/11-provider-model-system.md §5,
  03-runtime/03-tools-and-permissions.md §3,
  03-runtime/14-secrets-storage.md §4, 04-ux/06-settings-ia.md (Jev classifier)

## Context

Jev shipped as a fixed first-party integration: one TypeSafe address
(`https://api.typesafe.ai/v1/systemone`), one classifier id (`jev-latest`),
one Host secret slot. Users asked for two deployments the fixed address cannot
serve: a relay account (Zhizengzeng) that forwards the native System One
protocol at its own base URL, and a self-hosted local gateway reached over
plain HTTP on loopback.

pi-ai's System One transport already builds its request URL from the model's
base URL and dispatches by provider, so any endpoint speaking the same
protocol is a configuration change, not a new protocol path. A chat-completions
adapter was considered and rejected: the target services speak System One
natively, and emulating classification over chat would degrade the score and
probability semantics for no requested benefit.

## Decision

1. `AppSettings.jevEndpoint` (optional) stores `{ baseUrl, modelId,
   imageInput? }`. Absent means the TypeSafe default; existing installs are
   untouched. The shape is normalized and validated by
   `packages/shared/src/jev-endpoint.ts`, the single owner of the endpoint
   contract and the `<baseUrl>/systemone` URL rule shared by the settings
   check and the `JevClassify` tool.
2. The endpoint is judged as a user-typed endpoint, exactly like a model base
   URL: `isSafeUserEndpointUrl` plus the stored network policy. HTTPS anywhere;
   plain HTTP only under the relaxed policy (the local-deployment case). The
   decision is made in the main process from stored settings, never from
   renderer input. A refused endpoint withholds the key at session launch.
3. The key stays in the single `secret:app:typesafe-jev` slot. Changing the
   endpoint re-checks and replaces the key; the stored key is never silently
   spent at a new address. The endpoint rides the same settings write as the
   enable switch, and removal clears it with the disable write, preserving the
   probe → store → enable ordering contract.
4. The service dialog offers TypeSafe official, the Zhizengzeng preset, and a
   custom/local endpoint. The card and the tool description name the configured
   endpoint, because the classification state now leaves the machine to an
   address the user chose; the privacy disclosure follows that address.
5. The `jevTest` IPC payload accepts the legacy bare key (TypeSafe default) or
   `{ apiKey, endpoint }`. An endpoint that fails normalization is refused, not
   dropped: a silent fallback to TypeSafe would send the user's key somewhere
   they did not type.

## Consequences

- No new provider row, no chat-model listing, no protocol adapter: the
  classifier stays outside the provider/model system.
- The runtime match config compares endpoints, so an endpoint change retires
  the runtime instead of leaving a stale tool target.
- Data egress is user-chosen and disclosed; the network policy remains the one
  trust boundary for user-typed addresses.
- `imageInput` is carried for proxies that hide their identity, but the tool's
  input contract has no images today, so the compat choice is inert until
  image state is ever offered; it is validated and persisted regardless.