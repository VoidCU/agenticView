---
name: agenticview-statusline
description: Opt in (or out) of AgenticView's status-line relay, which forwards Claude Code's statusLine JSON to the office so it can display rate-limit counters. Use when the user runs /agenticview-statusline or asks to enable/disable the AgenticView status line.
argument-hint: "[off]"
arguments: [action]
allowed-tools: Read, Write, Bash(node *), Bash(cat *)
---

Opt in or out of the AgenticView status-line relay. The relay wraps Claude Code's `statusLine` hook: it posts rate-limit data to the office and, if an existing status-line command is configured, also runs that command so the user's current status line keeps working.

**Never touch any key in `~/.claude/settings.json` other than `statusLine`.**

## Step 1 — Locate the plugin root

Run:

    cat ~/.agenticview/plugin-root

That file contains the absolute path to the plugin folder (written there by the plugin's SessionStart hook). If it is missing, tell the user to restart Claude Code once so the hook can record the path, then stop.

Call that path `PLUGIN_ROOT` in the steps below.

## Step 2 — Read current settings

Read `~/.claude/settings.json`. If the file does not exist, treat `statusLine` as absent and the rest of the file as `{}`.

Parse the JSON and note the current value of `statusLine` (may be absent/null).

## Step 3a — `off` argument (turning the relay off)

If `$ARGUMENTS` is `off`:

1. Read `~/.agenticview/statusline-backup.json`. If it exists and contains a `statusLine` key, that is the original value to restore; if it does not exist (or contains `null`), the original was absent (remove `statusLine` entirely).
2. Show the user the diff:
   - **Before** — the current `statusLine` value in `~/.claude/settings.json`
   - **After** — the restored original value (or "removed")
3. Ask the user to confirm before writing.
4. On confirmation:
   - Set `statusLine` to the restored value, or delete the `statusLine` key if there was none.
   - Write `~/.claude/settings.json` back (preserve all other keys and formatting as much as possible — use the approach in Step 4 below).
   - Delete `~/.agenticview/statusline-backup.json` if it exists.
5. Tell the user the relay is off and that the restored status line (if any) is active again.

Stop here for the `off` path.

## Step 3b — Turning the relay on (no argument or any argument that is not `off`)

1. If `statusLine` is already set to a command whose `command` string contains `statusline.mjs`, tell the user the relay is already active and stop.

2. Build the new `statusLine` object:

   ```json
   {
     "type": "command",
     "command": "node \"PLUGIN_ROOT/bin/statusline.mjs\""
   }
   ```

   Replace `PLUGIN_ROOT` with the actual absolute path from Step 1. On Windows the path uses backslashes; keep them as-is inside the JSON string (they will be double-escaped in the raw JSON).

3. If there is an existing `statusLine` value (not absent, not null):
   - Save the existing value to `~/.agenticview/statusline-backup.json`:
     ```json
     { "statusLine": <existing value> }
     ```
   - Add an `env` key to the new `statusLine` object so the relay can invoke the old command:
     ```json
     {
       "type": "command",
       "command": "node \"PLUGIN_ROOT/bin/statusline.mjs\"",
       "env": {
         "AGENTICVIEW_STATUSLINE_WRAP": "<existing command string>"
       }
     }
     ```
     For the `AGENTICVIEW_STATUSLINE_WRAP` value: if the existing `statusLine` has `type: "command"`, use its `command` string. If it has another shape, JSON-stringify the entire existing value. The relay reads this env variable and runs it as a shell command (POSIX) or `cmd /c` (Windows), forwarding stdin and printing its stdout; the settings `env` key is cross-platform and requires no shell prefix — state this to the user.
   - If there is no existing `statusLine`, skip the backup and the `env` key.

4. Show the user the diff:
   - **Before** — the current `statusLine` value (or "not set")
   - **After** — the new `statusLine` object (pretty-printed)
5. Ask for confirmation before writing.

## Step 4 — Write `~/.claude/settings.json`

On confirmation, update the file with minimal disruption using a Node.js one-liner so JSON key order and other keys are preserved:

```
node -e "
const fs = require('fs'), path = require('path');
const f = path.join(require('os').homedir(), '.claude', 'settings.json');
let s = {};
try { s = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
s.statusLine = <NEW_VALUE_AS_JSON>;
fs.writeFileSync(f, JSON.stringify(s, null, 2) + '\n');
"
```

Substitute the actual JSON for `<NEW_VALUE_AS_JSON>`. To delete `statusLine`, use `delete s.statusLine` instead of assigning it.

After writing, tell the user:
- The relay is now active.
- If a backup was made, remind them to run `/agenticview-statusline off` to restore the original status line.
- The office will start receiving rate-limit data on the next Claude Code response (Pro/Max plans only; data appears after the first response in each window, not before).
