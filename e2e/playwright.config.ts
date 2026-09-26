import { defineConfig } from "@playwright/test";
import { execSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { CLI, E2E_HOME, E2E_PORT, E2E_PROJECT, REPO_ROOT } from "./paths";

/*
 * Fresh state every run: no leftover agents, tasks or instance files from a previous run.
 * Playwright evaluates this config in the runner and again in each worker; the env flag makes the
 * cleanup happen exactly once, before the web server starts, and never after it wrote its instance file.
 *
 * On Windows, playwright's webServer child process is not always killed when the test runner
 * exits (SIGTERM is not a real Windows signal). We kill any stale AgenticView e2e server on
 * E2E_PORT here — in the top-level config block — because playwright starts the webServer
 * BEFORE globalSetup runs, so cleanup must happen here to be effective.
 */
if (!process.env.AGENTICVIEW_E2E_CLEANED) {
  // Kill any leftover e2e server that holds E2E_PORT.
  try {
    let pid: number | null = null;
    if (process.platform === "win32") {
      const out = execSync("netstat -ano", { encoding: "utf8", timeout: 5000 });
      const m = out.match(new RegExp(`:${E2E_PORT}\\s+[\\d.]+:\\d+\\s+LISTENING\\s+(\\d+)`));
      if (m) pid = parseInt(m[1]!, 10);
    } else {
      const out = execSync(`lsof -ti tcp:${E2E_PORT}`, { encoding: "utf8", timeout: 5000 }).trim();
      if (out) pid = parseInt(out, 10);
    }
    if (pid !== null) {
      let cmdline: string | null = null;
      try {
        cmdline =
          process.platform === "win32"
            ? execSync(
                `powershell -NoProfile -Command "(Get-WmiObject Win32_Process -Filter 'ProcessId=${pid}').CommandLine"`,
                { encoding: "utf8", timeout: 5000 },
              ).trim()
            : execSync(`ps -p ${pid} -o args=`, { encoding: "utf8", timeout: 5000 }).trim();
      } catch {
        // cmdline stays null
      }
      const isE2E =
        cmdline !== null &&
        (cmdline.includes("agenticview-e2e") ||
          cmdline.includes(E2E_PROJECT.replace(/\\/g, "/")) ||
          cmdline.includes(E2E_PROJECT.replace(/\//g, "\\")));
      if (isE2E) {
        try {
          if (process.platform === "win32") {
            execSync(`powershell -NoProfile -Command "Stop-Process -Id ${pid} -Force"`, { timeout: 5000 });
          } else {
            process.kill(pid, "SIGKILL");
          }
          // Brief pause so the OS releases the port before playwright binds it.
          const until = Date.now() + 800;
          while (Date.now() < until) {
            /* spin */ void 0;
          }
          console.log(`[e2e setup] Killed stale e2e webServer (PID ${pid}) on port ${E2E_PORT}.`);
        } catch {
          /* non-fatal */
        }
      } else if (cmdline !== null) {
        console.warn(
          `[e2e setup] Port ${E2E_PORT} held by PID ${pid} (not an e2e leftover): ${cmdline.slice(0, 120)}`,
        );
      }
    }
  } catch {
    /* non-fatal */
  }

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
