import { defineConfig } from "@playwright/test";
import { mkdirSync, rmSync } from "node:fs";
import { CLI, E2E_HOME, E2E_PORT, E2E_PROJECT, REPO_ROOT } from "./paths";

/*
 * Fresh state every run: no leftover agents, tasks or instance files from a previous run.
 * Playwright evaluates this config in the runner and again in each worker; the env flag makes the
 * cleanup happen exactly once, before the web server starts, and never after it wrote its instance file.
 */
if (!process.env.AGENTICVIEW_E2E_CLEANED) {
  rmSync(E2E_HOME, { recursive: true, force: true });
  rmSync(E2E_PROJECT, { recursive: true, force: true });
  mkdirSync(E2E_HOME, { recursive: true });
  mkdirSync(E2E_PROJECT, { recursive: true });
  process.env.AGENTICVIEW_E2E_CLEANED = "1";
}

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  /*
   * *-screenshots.spec.ts files render the full 3D office at several sizes and themes to produce review
   * screenshots. They are too slow for CI's software-rendered browser and assert little behaviour, so they
   * only run on request: AGENTICVIEW_SCREENSHOTS=1 npm run test:e2e.
   */
  testIgnore: process.env.AGENTICVIEW_SCREENSHOTS ? [] : [/-screenshots\.spec\.ts$/],
  timeout: 60_000,
  /* Both tests drive one shared server and project directory, so they must not interleave. */
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `node "${CLI}" open --project "${E2E_PROJECT}" --no-browser --port ${E2E_PORT}`,
    cwd: REPO_ROOT,
    url: `http://127.0.0.1:${E2E_PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { ...process.env, AGENTICVIEW_HOME: E2E_HOME, AGENTICVIEW_FAKE: "1" },
  },
});
