# AgenticView

A gamified 3D office for your coding agents, packaged as a Claude Code plugin.

Run one command inside any project and a browser tab opens onto an isometric office. Spherical robots are your agents. **Atlas**, the Manager, stands on the podium in the middle. Workers sit at desks around it. You talk to Atlas, Atlas splits the work and hands it to the right worker, and the workers edit your real project files. Flip back to VS Code whenever you like to review the code.

- **Any provider.** Agents run on Claude (API key), on your own **Claude Code session** (Max/Pro plans, via `/agenticview-work`), on OpenAI **Codex**, or on Google **Gemini**. *Automatic* picks the first one that is available.
- **Two scopes.** *Project* agents live inside a project and only work there. *Global* agents live in your home folder, show up in every office, can be copied into a project, or can be sent to work on any project you have opened before.
- **A Manager with an accurate map.** Every Manager turn starts with a freshly generated roster and open-task list, so it always knows who exists, who is busy, and what is in flight.
- **Agents that can see.** Workers can take screenshots of a URL, and you can paste screenshots into any chat.
- **Your own session, mirrored.** Plugin hooks show what your Claude Code terminal session is doing as a robot in the office too.

## Requirements

- **Claude Code** 2.x (the CLI, the desktop app, or the VS Code extension all work).
- **Node.js 22 or newer** on your PATH (`node --version`).
- A browser. The office is a normal web page served on `127.0.0.1`.
- For real agents, credentials for at least one provider (see [Providers and credentials](#providers-and-credentials)). You can try the whole UI without any credentials using demo mode (below).

## Install

### 1. Add the plugin inside Claude Code

Open Claude Code in any folder and run:

```
/plugin marketplace add VoidCU/agenticView
/plugin install agenticview@agenticview
```

The first command registers this repository as a plugin marketplace. The second installs the `agenticview` plugin from it. Accept the prompts.

### 2. Restart Claude Code once

Close and reopen Claude Code (or start a new session with `claude`). On start, the plugin's `SessionStart` hook writes the plugin's install location to `~/.agenticview/plugin-root`; the `/agenticview` command needs that file.

### 3. Give agents a way to run

Pick one:

- **Claude Max or Pro plan (no API key):** use the **Claude Code session** provider. Open the office, then in a Claude Code session for the same project run `/agenticview-work`. That session becomes a worker: it pulls queued tasks from the office and does them with its own tools. AgenticView never launches `claude` itself for this provider, so your subscription is only used by Claude Code. One session handles one task at a time; open more sessions for more parallel workers.
- **Claude via API key (provider `claude`):** set `ANTHROPIC_API_KEY` in your shell environment (get one at platform.claude.com). The Agent SDK does **not** reuse your Claude Code login. Alternatively put the key in `~/.agenticview/config.json`:

  ```json
  { "providers": { "claude": { "apiKey": "sk-ant-..." } } }
  ```

- **Codex:** `npm i -g @openai/codex`, then `codex login`.
- **Gemini:** `npm i -g @google/gemini-cli`, then `gemini` once to sign in (or set `GEMINI_API_KEY`).

You can install the plugin first and add credentials later; the office shows each provider's status and why one is unavailable.

## Use

| Command | What it opens |
|---|---|
| `/agenticview` | The office for the current project |
| `/agenticview-work` | Not a page: turns this Claude Code session into a worker for the *Claude Code session* provider, pulling queued office tasks until you interrupt it |
| `/agenticview-hub` | The Hub: global agents plus your list of known projects |

Run `/agenticview` inside a project (Claude Code must be started in the project folder). Claude runs the launcher, and the first time it installs the plugin's own dependencies (about a minute; later launches take a second). It then prints a line like:

```
AgenticView: http://127.0.0.1:52210/#token=3f9c...
```

and opens it in your browser. Keep that Claude Code session open; it hosts the server. The `#token=` part is the access key for that office, so use the exact link printed.

### Test drive in a project (5 minutes)

1. In a project folder, run `claude`, then `/agenticview`. A browser tab opens onto the office with **Atlas** on the podium.
2. Click the empty desk marked **New agent**. Name it `Nova`, specialty `frontend`, leave the provider on *Default*, keep *Edit files* and *Shell* on, choose *Edits are fine, ask for the rest*, and click **Create agent**. A robot appears at the desk.
3. Type into the command bar at the bottom: `Add a README section that explains how to run the tests`, and press Enter. Atlas reads the roster, assigns the work to Nova (watch the beam), waits for her, and reports back. Nova's desk shows the files she touches.
4. Click Nova to open her chat and ask her something directly, for example `Which test framework does this project use?`.
5. Switch to VS Code or `git diff` to review what changed. Everything the agents do is in your working tree; nothing is committed for you.
6. Try `/agenticview-hub` to create a **global** agent, then open the project again: the global agent waits in the Lobby and can be given work here or copied into the project.

### Try it with no credentials (demo mode)

To see the office without any API keys, start the server by hand with scripted agents that echo what you send:

```
AGENTICVIEW_FAKE=1 node "$(cat ~/.agenticview/plugin-root)/bin/agenticview.mjs" open --project .
```

(On Windows PowerShell: `$env:AGENTICVIEW_FAKE=1; node "$(Get-Content ~/.agenticview/plugin-root)/bin/agenticview.mjs" open --project .`)

### Without the plugin (from a clone)

```
git clone https://github.com/VoidCU/agenticView.git
cd agenticView && npm install --omit=dev
node bin/agenticview.mjs open --project /path/to/your/project
node bin/agenticview.mjs hub
```

### Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `/agenticview` says `plugin-root` is missing | The SessionStart hook has not run yet. Restart Claude Code once, then retry. |
| `AgenticView needs its launch link` page | You opened the address without its `#token=` part. Use the exact link the command printed, or run `/agenticview` again (it reuses the running server and prints the link). |
| Provider shows *unavailable* in the office | Hover the chip or open Settings to read the reason: usually a missing key or CLI. Fix it, restart the office (`/agenticview` again after stopping the old one), and reload the page. Provider checks are cached for a minute. |
| Claude agent fails immediately | `ANTHROPIC_API_KEY` is not visible to the shell Claude Code runs in. Set it in `~/.agenticview/config.json` instead, or switch the agent to *Claude Code session* if you are on a Max/Pro plan. |
| Claude Code session task sits "waiting for a worker" | No session is polling. Run `/agenticview-work` in a Claude Code session opened in the project folder (restart Claude Code once after installing or updating the plugin so its `agenticview-worker` MCP server loads). |
| Codex worker cannot edit files on Windows | Codex's Windows sandbox cannot write. Use *auto-edit* or *auto* (both run unsandboxed there) or run under WSL. |
| Gemini reports a `GOOGLE_CLOUD_PROJECT` error | Your Google account type needs that variable set; see the link in the error. |
| Port or stale office | Each project has one server. If a stale one lingers, delete its file in `~/.agenticview/instances/` and rerun. |

Inside the office:

- Type into the command bar at the bottom to give Atlas a task. Watch the beam fire from the podium to the worker that gets it.
- Click any robot to open its chat panel. Paste an image to attach it.
- Click the empty desk with the `+` pad to create a worker. Pick a name, a specialty, a provider, which tools it may use, and how much it should ask before acting.
- Workers earn XP for finished tasks. Levels only unlock cosmetic accents.
- When a Claude worker in `ask` mode wants to run something risky, a bubble appears over its head with Allow and Deny.

## Providers and credentials

| Provider | How agents run | What you need |
|---|---|---|
| **claude** | Claude Agent SDK (Claude Code as a library) | `ANTHROPIC_API_KEY` in your environment, or a cloud provider env such as `CLAUDE_CODE_USE_BEDROCK`. The Agent SDK does not reuse the Claude Code login. You can also put the key in `~/.agenticview/config.json` under `providers.claude.apiKey`. |
| **claude-session** ("Claude Code session") | Your own Claude Code session running `/agenticview-work` pulls tasks from the office queue over the plugin's `agenticview-worker` MCP server and does them with its own tools. AgenticView never spawns `claude` for it. | A Claude Code login (Max/Pro works). Run `/agenticview-work` in a session for the project; it shows as available while at least one session is polling. Tasks wait in the queue until a session picks them up. |
| **codex** | `@openai/codex-sdk` driving the installed `codex` CLI | `npm i -g @openai/codex`, then sign in (`codex login`) or set `CODEX_API_KEY`. |
| **gemini** | The installed `gemini` CLI in headless streaming mode | `npm i -g @google/gemini-cli`, then sign in or set `GEMINI_API_KEY`. |

The settings panel in the office shows each provider's status and the reason when one is unavailable. Creating an agent on an unavailable provider is refused with that reason, except for *Claude Code session*, whose tasks simply wait until a worker session connects.

With the default provider on **Automatic**, agents without their own provider run on the first available provider in the order claude, claude-session, codex, gemini. The settings panel shows the current choice, e.g. *Automatic (Codex)*.

Only Claude supports interactive permission prompts. For Codex and Gemini, the `ask` mode maps to the most restrictive non-interactive setting each CLI offers, and the office says so:

| Agent permission mode | Claude | Codex | Gemini |
|---|---|---|---|
| `ask` | prompts you in the office | `read-only` sandbox | `default` approval mode (headless: unapproved tools are rejected) |
| `auto-edit` | accept edits | `workspace-write` sandbox (`danger-full-access` on Windows, where Codex's sandbox cannot write files) | `auto_edit` |
| `auto` | bypass permissions | `danger-full-access` | `yolo` |

Gemini reads MCP servers and tool exclusions from settings files, so while a Gemini worker runs, AgenticView temporarily adds an `agenticview-<run>` server entry and a `tools.exclude` list (for tools that agent may not use) to `<project>/.gemini/settings.json`, and restores the file when the last Gemini run in that project finishes. Concurrent runs each get their own entry; exclusions are the union of all running agents. If the server ever dies mid-run, the next launch strips the leftovers.

An agent whose tools disallow both editing and shell (the Manager, for example) runs Codex in a `read-only` sandbox and Gemini with the write, shell and web tools excluded, regardless of its permission mode.

## Scopes and where data lives

| | Project agents | Global agents |
|---|---|---|
| Stored in | `<project>/.agenticview/agents/` | `~/.agenticview/agents/` |
| Appear in | that project's office | every office (in the Lobby) and the Hub |
| Can work in | that project only | any known project |

`<project>/.agenticview/` also holds tasks and settings. It gets its own `.gitignore` so agent definitions and settings are committable while tasks (which carry logs), sessions, and uploads are not. `~/.agenticview/config.json` holds global defaults, provider settings, and the list of known projects.

## Security

The server binds to `127.0.0.1` only. Every request and WebSocket connection needs the random token that is minted at launch and passed once in the URL. Agents only receive the tools you allowed on them. Custom tools handed to Codex and Gemini go through a per-run bridge token that stops working when the run ends.

## Development

```
npm install
npm run build          # shared, server, web
npm test               # unit + integration tests (no credentials needed)
npm run dev -w packages/web   # Vite dev server; run the CLI on port 4310 for the API
npm run release        # rebuilds and fails if the committed bundles are stale
```

Handy while developing the UI: `AGENTICVIEW_FAKE=1 node packages/server/dist/cli.js open --project <dir> --no-browser --port 4310` starts the server with scripted agents that echo prompts, so no API keys are needed.

The built bundles in `packages/server/dist` and `packages/web/dist` are committed on purpose: plugins have no install-time build step.

One opt-in live test runs a real Claude worker in a temp directory: `AGENTICVIEW_LIVE=1 npm test`.

## License

MIT
