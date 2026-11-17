#!/usr/bin/env node
/**
 * Keep every shipped executable behind an explicit, named classification.
 *
 * PI-Desktop has exactly one product entry point — the Desktop app. Two
 * support CLIs exist beside it, and the Rust host core builds one binary.
 * Any new executable is a launch path that bypasses the normal process
 * model, so it must be added to the allowlist below with its role named,
 * in the same change that introduces it. Inspired by dsh's
 * verify-application-entrypoints discipline.
 *
 * Usage:
 *   node scripts/check-executable-entrypoints.mjs
 *   pnpm check:entrypoints
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/** package.json-relative bin allowlist: exact bin map -> named role. */
const NODE_BIN_ALLOWLIST = new Map([
  [
    "packages/plugin-devkit/package.json",
    {
      role: "plugin toolchain CLI (scaffold/check/pack); not an app entry",
      bins: { "pi-plugin": "./dist/cli.js" },
    },
  ],
  [
    "apps/pi-host/package.json",
    {
      role: "host process launcher used by the Desktop app",
      bins: { "pi-host": "./dist/cli.js" },
    },
  ],
]);

/** Rust [[bin]] allowlist: Cargo.toml path -> bin name -> named role. */
const CARGO_BIN_ALLOWLIST = new Map([
  [
    "crates/host-core/Cargo.toml",
    { role: "Rust host core binary (persistence + authoritative host state)", bins: ["pi-desktop-host-core"] },
  ],
]);

const problems = [];

function checkPackageJson(relative) {
  const absolute = join(root, relative);
  if (!existsSync(absolute)) return;
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(absolute, "utf8"));
  } catch {
    return;
  }
  if (manifest.bin === undefined) return;
  const allowed = NODE_BIN_ALLOWLIST.get(relative);
  const bins =
    typeof manifest.bin === "string"
      ? { [manifest.name ?? "?"]: manifest.bin }
      : typeof manifest.bin === "object" && manifest.bin !== null
        ? manifest.bin
        : null;
  if (!bins) {
    problems.push(`${relative}: malformed bin field`);
    return;
  }
  if (!allowed) {
    problems.push(
      `${relative}: declares bin ${JSON.stringify(bins)} with no allowlist entry. ` +
        "Every executable needs an explicit classification in scripts/check-executable-entrypoints.mjs.",
    );
    return;
  }
  const actual = JSON.stringify(Object.keys(bins).sort());
  const expected = JSON.stringify(Object.keys(allowed.bins).sort());
  if (actual !== expected) {
    problems.push(
      `${relative}: bin names changed ${actual} (allowlist: ${expected}). ` +
        `If this is intentional, update the "${allowed.role}" entry.`,
    );
  }
}

function checkCargoToml(relative) {
  const absolute = join(root, relative);
  if (!existsSync(absolute)) return;
  const text = readFileSync(absolute, "utf8");
  const binNames = [...text.matchAll(/\[\[bin\]\]\s*(?:[^\[]*?)name\s*=\s*"([^"]+)"/g)].map(
    (match) => match[1],
  );
  if (binNames.length === 0) return;
  const allowed = CARGO_BIN_ALLOWLIST.get(relative);
  if (!allowed) {
    problems.push(
      `${relative}: declares [[bin]] ${binNames.join(", ")} with no allowlist entry.`,
    );
    return;
  }
  const unexpected = binNames.filter((name) => !allowed.bins.includes(name));
  if (unexpected.length > 0) {
    problems.push(
      `${relative}: unexpected [[bin]] ${unexpected.join(", ")}. ` +
        `If this is intentional, update the "${allowed.role}" entry.`,
    );
  }
}

function* walkPackages(dir, prefix) {
  const absolute = join(root, dir);
  if (!existsSync(absolute)) return;
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "node_modules") continue;
    yield join(prefix, entry.name, "package.json");
  }
}

for (const manifest of [...walkPackages("apps", "apps"), ...walkPackages("packages", "packages")]) {
  checkPackageJson(manifest);
}
const cratesDir = join(root, "crates");
if (existsSync(cratesDir)) {
  for (const entry of readdirSync(cratesDir, { withFileTypes: true })) {
    if (entry.isDirectory()) checkCargoToml(join("crates", entry.name, "Cargo.toml"));
  }
}

if (problems.length > 0) {
  process.stderr.write(
    `Executable entrypoint check failed:\n${problems.map((problem) => `  - ${problem}`).join("\n")}\n`,
  );
  process.exit(1);
}
process.stdout.write(
  `Executable entrypoints OK: ${NODE_BIN_ALLOWLIST.size} JS CLIs + ${CARGO_BIN_ALLOWLIST.size} Rust binaries, all classified.\n`,
);
