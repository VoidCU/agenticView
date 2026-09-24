import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("bin/agenticview.mjs --help prints usage and exits 0", () => {
  const r = spawnSync(process.execPath, [join(root, "bin", "agenticview.mjs"), "--help"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /open --project/);
});

test("bin/agenticview.mjs rejects an unknown command", () => {
  const r = spawnSync(process.execPath, [join(root, "bin", "agenticview.mjs"), "nope"], { encoding: "utf8" });
  assert.equal(r.status, 1);
});
