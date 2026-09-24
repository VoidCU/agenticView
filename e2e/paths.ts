import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Deterministic scratch dirs so the test can find the instance file the CLI writes. No side effects here. */
export const E2E_HOME = join(tmpdir(), "agenticview-e2e-home");
export const E2E_PROJECT = join(tmpdir(), "agenticview-e2e-project");
export const E2E_PORT = 4399;
export const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const CLI = join(REPO_ROOT, "packages", "server", "dist", "cli.js");
