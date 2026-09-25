---
name: agenticview-close
description: Close (stop) a running AgenticView office. Use when the user runs /agenticview-close or asks to close, stop, quit or shut down AgenticView, the office or the hub.
argument-hint: "[all | hub]"
allowed-tools: Bash(node *), Bash(cat *)
---

Stop the AgenticView office server. Pick the command from the arguments (`$ARGUMENTS`) and run it with the Bash tool from the project root:

- No argument: close the office for the current project.

      node "$(cat ~/.agenticview/plugin-root)/bin/agenticview.mjs" close --project "$PWD"

- `hub`: close the global hub.

      node "$(cat ~/.agenticview/plugin-root)/bin/agenticview.mjs" close --hub

- `all`: close every running office and the hub.

      node "$(cat ~/.agenticview/plugin-root)/bin/agenticview.mjs" close --all

Then tell the user what it printed (`AgenticView: closed ...`, or that nothing was running).

Notes:
- Closing stops any agent runs still in progress in that office; queued tasks are marked interrupted the next time the office opens. Browser tabs of a closed office stop updating and can be closed.
- Claude Code sessions running `/agenticview-work` for that office keep polling and report that no office is running; interrupt them if you are done.
- If `~/.agenticview/plugin-root` is missing, ask the user to restart Claude Code once so the plugin's SessionStart hook can record where the plugin lives.
