---
name: agenticview
description: Open the AgenticView 3D agent office for the current project in the browser. Use when the user runs /agenticview or asks to see, manage, chat with, or delegate work to their agents visually.
allowed-tools: Bash(node *), Bash(cat *)
---

Open the AgenticView office for the project in the current working directory.

Run this exact command with the Bash tool from the project root, then tell the user the URL it prints (the line starting with `AgenticView:`). Keep the command running in the background if the tool offers that; the server stays up while the office is open.

    node "$(cat ~/.agenticview/plugin-root)/bin/agenticview.mjs" open --project "$PWD"

Notes:
- The first run installs dependencies and can take a minute; later runs start in about a second.
- If the command reports that an office is already running for this project, just share that URL. Never start a second server for the same project.
- If `~/.agenticview/plugin-root` is missing, ask the user to restart Claude Code once so the plugin's SessionStart hook can record where the plugin lives. As a fallback, run `node "<plugin folder>/bin/agenticview.mjs" open --project "$PWD"`, where the plugin folder is the one `/plugin` lists for agenticview (for a git clone, the clone itself).
- Agents run on the provider each agent is set to. Claude agents need `ANTHROPIC_API_KEY` in the environment (the Agent SDK does not reuse the Claude Code login); Codex agents need the `codex` CLI signed in; Gemini agents need the `gemini` CLI signed in. The office's settings panel shows which providers are available and why.
