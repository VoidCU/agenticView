---
name: agenticview-hub
description: Open the AgenticView Hub, the global office that holds global agents and the list of known projects. Use when the user runs /agenticview-hub or wants to create or manage global agents that can work in any project.
allowed-tools: Bash(node *), Bash(cat *), Bash(npx agenticview *)
---

Open the AgenticView Hub (global world). It is not tied to a project: global agents live here and can be sent to work in any project you have opened before with `/agenticview`.

Run this exact command with the Bash tool, then tell the user the URL it prints (the line starting with `AgenticView:`):

    node "$(cat ~/.agenticview/plugin-root)/bin/agenticview.mjs" hub

Notes:
- If the command reports that the Hub is already running, just share that URL.
- If `~/.agenticview/plugin-root` is missing, ask the user to restart Claude Code once so the plugin's SessionStart hook can record where the plugin lives, or run `npx agenticview hub` instead.
