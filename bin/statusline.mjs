#!/usr/bin/env node
/**
 * statusline.mjs — dependency-free Node ESM relay for Claude Code's statusLine JSON.
 *
 * Claude Code pipes a JSON object on stdin (see code.claude.com/docs/en/statusline) with:
 *   session_id, model {id, display_name}, cwd / workspace.current_dir
 *   rate_limits.five_hour.{used_percentage, resets_at}
 *   rate_limits.seven_day.{used_percentage, resets_at}
 *
 * This script:
 *  1. Reads all stdin, parses JSON (tolerates garbage).
 *  2. Discovers the running office for the cwd (instance file under AGENTICVIEW_HOME/project) and
 *     POSTs {session_id, model, cwd, rate_limits} to <office>/api/claude-limits (fire-and-forget,
 *     300 ms timeout). Never throws or waits longer.
 *  3. Prints a status line. If AGENTICVIEW_STATUSLINE_WRAP holds a command, runs it via the shell
 *     with the original stdin and prints its stdout. Otherwise formats e.g.:
 *       Opus 5.5 · 5h 42% · week 18%
 *  4. Always exits 0.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { request } from "node:http";
import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Instance discovery (mirrors packages/server/src/instances.ts without import)
// ---------------------------------------------------------------------------

function instancesRoot() {
  return process.env.AGENTICVIEW_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".agenticview");
}

function instanceFile(projectPath) {
  const key = projectPath
    ? createHash("sha1").update(resolve(projectPath).toLowerCase()).digest("hex").slice(0, 16)
    : "hub";
  return join(instancesRoot(), "instances", `${key}.json`);
}

async function liveInstance(projectPath) {
  try {
    const raw = await readFile(instanceFile(projectPath), "utf8");
    const inst = JSON.parse(raw);
    const res = await fetch(`${inst.url}/healthz`, { signal: AbortSignal.timeout(700) });
    return res.ok ? inst : undefined;
  } catch {
    return undefined;
  }
}

async function discoverOffice(start) {
  let dir = resolve(start);
  for (;;) {
    const inst = await liveInstance(dir);
    if (inst) return inst;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return liveInstance(null);
}

// ---------------------------------------------------------------------------
// Fire-and-forget POST with 300 ms timeout
// ---------------------------------------------------------------------------

function postLimits(inst, body) {
  return new Promise((res) => {
    const ac = new AbortController();
    const timer = setTimeout(() => { ac.abort(); res(); }, 300);
    try {
      const data = Buffer.from(JSON.stringify(body));
      const url = new URL(`${inst.url}/api/claude-limits`);
      const req = request(
        url.toString(),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": String(data.length),
            "x-agenticview-token": inst.token,
          },
          signal: ac.signal,
        },
        (r) => {
          r.resume(); // drain
          clearTimeout(timer);
          res();
        },
      );
      req.on("error", () => { clearTimeout(timer); res(); });
      req.end(data);
    } catch {
      clearTimeout(timer);
      res();
    }
  });
}

// ---------------------------------------------------------------------------
// Status line formatting
// ---------------------------------------------------------------------------

function formatStatusLine(parsed) {
  const model = parsed?.model?.display_name ?? parsed?.model?.id ?? "";
  const rl = parsed?.rate_limits;
  const fiveHour = rl?.five_hour;
  const sevenDay = rl?.seven_day;
  const parts = [];
  if (model) parts.push(model);
  if (fiveHour && typeof fiveHour.used_percentage === "number") {
    parts.push(`5h ${Math.round(fiveHour.used_percentage)}%`);
  }
  if (sevenDay && typeof sevenDay.used_percentage === "number") {
    parts.push(`week ${Math.round(sevenDay.used_percentage)}%`);
  }
  return parts.join(" · "); // middle dot
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Read all stdin
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // tolerate garbage
  }

  // Determine cwd from parsed payload
  const cwd = parsed?.cwd ?? parsed?.workspace?.current_dir ?? process.cwd();

  // Fire-and-forget: discover office and POST limits (never await > 300 ms)
  const postPromise = (async () => {
    try {
      const inst = await Promise.race([
        discoverOffice(cwd),
        new Promise((r) => setTimeout(() => r(undefined), 800)),
      ]);
      if (inst && parsed) {
        await postLimits(inst, {
          session_id: parsed.session_id,
          model: parsed.model,
          cwd,
          rate_limits: parsed.rate_limits,
        });
      }
    } catch {
      // never throw
    }
  })();

  // The user's previous status-line command, if any: `--wrap-b64 <base64>` on the command line (what
  // /agenticview-statusline writes), or AGENTICVIEW_STATUSLINE_WRAP in the environment.
  const i = process.argv.indexOf("--wrap-b64");
  let wrap = process.env.AGENTICVIEW_STATUSLINE_WRAP;
  if (i > 0 && process.argv[i + 1]) {
    try {
      wrap = Buffer.from(process.argv[i + 1], "base64").toString("utf8") || wrap;
    } catch {
      // keep the env value
    }
  }
  if (wrap) {
    // Run the wrap command, feeding the original stdin text
    const result = spawnSync(wrap, { input: raw, shell: true, encoding: "utf8", timeout: 5000 });
    const out = result.stdout ?? "";
    if (out) process.stdout.write(out.endsWith("\n") ? out : out + "\n");
  } else {
    const line = formatStatusLine(parsed);
    if (line) console.log(line);
  }

  // Wait for the post to finish (or time out — postPromise won't take > 1.1 s total)
  await postPromise;
}

main().catch(() => {}).finally(() => process.exit(0));
