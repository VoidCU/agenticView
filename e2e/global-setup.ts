/**
 * Playwright globalSetup: runs once before the webServer starts.
 *
 * On Windows, playwright's webServer child process is not always killed when the test runner
 * exits (SIGTERM is not a real Windows signal and process.kill may not propagate to the child).
 * A leftover server on E2E_PORT causes the next run to fail immediately with
 * "port already in use" before any test executes.
 *
 * This setup detects and kills a stale AgenticView e2e server (one whose command line
 * references the E2E_PROJECT path) so that repeated local runs stay green.
 */
import { execSync } from "node:child_process";
import { E2E_PORT, E2E_PROJECT } from "./paths";

export default async function globalSetup(): Promise<void> {
  // Best-effort: if we cannot determine the owning pid, just let playwright error with a clear message.
  try {
    const pid = findListeningPid(E2E_PORT);
    if (pid === null) return; // port is free, nothing to do

    const cmdline = getCommandLine(pid);
    const isE2ELeftover =
      cmdline !== null &&
      (cmdline.includes("agenticview-e2e") ||
        cmdline.includes(E2E_PROJECT.replace(/\\/g, "/")) ||
        cmdline.includes(E2E_PROJECT.replace(/\//g, "\\")));

    if (!isE2ELeftover) {
      // Something else holds the port - do not kill it; playwright will give a clear error.
      console.warn(
        `\n[global-setup] Port ${E2E_PORT} is held by PID ${pid} (not an e2e leftover). ` +
          `Stop that process manually and re-run.\nCommand: ${cmdline ?? "(unknown)"}\n`,
      );
      return;
    }

    killProcess(pid);
    // Give the OS a moment to release the port before playwright binds it.
    await new Promise((r) => setTimeout(r, 300));
    console.log(`[global-setup] Killed stale e2e webServer (PID ${pid}) on port ${E2E_PORT}.`);
  } catch {
    // Non-fatal: if cleanup fails, playwright will still give a useful error.
  }
}

/** Return the PID listening on the given port, or null if the port is free / undetectable. */
function findListeningPid(port: number): number | null {
  try {
    if (process.platform === "win32") {
      // netstat output: "  TCP  127.0.0.1:4399  0.0.0.0:0  LISTENING  1234"
      const out = execSync(`netstat -ano`, { encoding: "utf8", timeout: 5000 });
      const re = new RegExp(`:${port}\\s+[\\d.]+:\\d+\\s+LISTENING\\s+(\\d+)`);
      const m = out.match(re);
      return m ? parseInt(m[1]!, 10) : null;
    } else {
      // lsof on macOS/Linux
      const out = execSync(`lsof -ti tcp:${port}`, { encoding: "utf8", timeout: 5000 }).trim();
      const pid = parseInt(out, 10);
      return isNaN(pid) ? null : pid;
    }
  } catch {
    return null;
  }
}

/** Return the full command line string of a process, or null on error. */
function getCommandLine(pid: number): string | null {
  try {
    if (process.platform === "win32") {
      const out = execSync(
        `powershell -NoProfile -Command "(Get-WmiObject Win32_Process -Filter 'ProcessId=${pid}').CommandLine"`,
        { encoding: "utf8", timeout: 5000 },
      );
      return out.trim() || null;
    } else {
      return execSync(`ps -p ${pid} -o args=`, { encoding: "utf8", timeout: 5000 }).trim() || null;
    }
  } catch {
    return null;
  }
}

/** Kill a process by PID. */
function killProcess(pid: number): void {
  if (process.platform === "win32") {
    execSync(`powershell -NoProfile -Command "Stop-Process -Id ${pid} -Force"`, { timeout: 5000 });
  } else {
    process.kill(pid, "SIGKILL");
  }
}
