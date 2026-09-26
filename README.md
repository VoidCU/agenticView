# AgenticView

A gamified 3D office for your coding agents, packaged as a Claude Code plugin.

Run one command inside any project and a browser tab opens onto an isometric office: a honeycomb of hexagonal rooms. Spherical robots are your agents. **Atlas**, the Manager, works from the office in the centre; workers sit at desks in the pods around it, next to a meeting room and a lounge. You talk to Atlas, Atlas splits the work, walks over to the right worker and hands it off, and the workers edit your real project files. Flip back to VS Code whenever you like to review the code.

- **Any provider.** Agents run on Claude (API key), on your own **Claude Code session** (Max/Pro plans, via `/agenticview-work`), on OpenAI **Codex**, on Google **Antigravity** (the `agy` CLI), or on Google **Gemini**. *Automatic* picks the first one that is available.
- **Model and effort per agent.** Pick each agent's model from its provider's list (or type a custom id) and a reasoning effort from low to max where the model supports it.
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

- **Claude Max or Pro plan (no API key):** use the **Claude Code session** provider. Open the office, then in a Claude Code session for the same project run `/agenticview-work`. That session becomes a coordinator: it pulls queued tasks from the office and runs each one in the agent's own Claude Code subagent, several agents at once. AgenticView never launches `claude` itself for this provider, so your subscription is only used by Claude Code. A session runs up to 4 tasks at once by default (set per session in the office); open more sessions for more.
- **Claude via API key (provider `claude`):** set `ANTHROPIC_API_KEY` in your shell environment (get one at platform.claude.com). The Agent SDK does **not** reuse your Claude Code login. Alternatively put the key in `~/.agenticview/config.json`:

  ```json
  { "providers": { "claude": { "apiKey": "sk-ant-..." } } }
  ```

- **Codex:** `npm i -g @openai/codex`, then `codex login`.
- **Gemini:** `npm i -g @google/gemini-cli`, then `gemini` once to sign in (or set `GEMINI_API_KEY`).
- **Antigravity:** install the Antigravity CLI (`agy`), then run `agy` once to sign in with your Antigravity account. No API key is needed.

You can install the plugin first and add credentials later; the office shows each provider's status and why one is unavailable.

## Use

| Command | What it opens |
|---|---|
| `/agenticview` | The office for the current project |
| `/agenticview-work` | Not a page: turns this Claude Code session into a worker for the *Claude Code session* provider, pulling queued office tasks until you interrupt it |
| `/agenticview-hub` | The Hub: global agents plus your list of known projects |
| `/agenticview-close` | Close the office for the current project. `/agenticview-close hub` closes the Hub, `/agenticview-close all` closes every running office |

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
node bin/agenticview.mjs close --project /path/to/your/project   # or: close --hub, close --all
```

### Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `/agenticview` says `plugin-root` is missing | The SessionStart hook has not run yet. Restart Claude Code once, then retry. |
| `AgenticView needs its launch link` page | You opened the address without its `#token=` part. Use the exact link the command printed, or run `/agenticview` again (it reuses the running server and prints the link). |
| Provider shows *unavailable* in the office | Hover the chip or open Settings to read the reason: usually a missing key or CLI. Fix it, restart the office (`/agenticview-close`, then `/agenticview`), and reload the page. Provider checks are cached for a minute. |
| Claude agent fails immediately | `ANTHROPIC_API_KEY` is not visible to the shell Claude Code runs in. Set it in `~/.agenticview/config.json` instead, or switch the agent to *Claude Code session* if you are on a Max/Pro plan. |
| Claude Code session task sits "waiting for a worker" | No session is polling. Run `/agenticview-work` in a Claude Code session opened in the project folder (restart Claude Code once after installing or updating the plugin so its `agenticview-worker` MCP server loads). |
| Codex worker cannot edit files on Windows | Codex's Windows sandbox cannot write. Use *auto-edit* or *auto* (both run unsandboxed there) or run under WSL. |
| Gemini reports a `GOOGLE_CLOUD_PROJECT` error | Your Google account type needs that variable set; see the link in the error. |
| Port or stale office | Each project has one server. If a stale one lingers, delete its file in `~/.agenticview/instances/` and rerun. |

Inside the office:

- Type into the command bar at the bottom to give Atlas a task. Atlas walks through the doorways to the worker that gets it, and back again when the task is done.
- Click any robot to open its chat panel. Paste an image to attach it. The ⋯ menu in the chat header edits, copies or deletes the agent.
- Click the empty desk with the `+` pad to create a worker. Pick a name, a specialty, a provider, a model and effort level, which tools it may use, and how much it should ask before acting.
- Click a room (or its name plate) to zoom to it; Esc or *Whole floor* zooms back out. More pods open in new rings as you add workers.
- Drag a worker onto another room or desk to reseat it (dropping on an occupied desk swaps the two). Atlas can do the same: ask it to rearrange the team and it uses its `list_spaces`, `move_worker` and `arrange_workers` tools.
- Workers earn XP for finished tasks. Levels only unlock cosmetic accents.
- When a Claude worker in `ask` mode wants to run something risky, a bubble appears over its head with Allow and Deny.

## Providers and credentials

| Provider | How agents run | What you need |
|---|---|---|
| **claude** | Claude Agent SDK (Claude Code as a library) | `ANTHROPIC_API_KEY` in your environment, or a cloud provider env such as `CLAUDE_CODE_USE_BEDROCK`. The Agent SDK does not reuse the Claude Code login. You can also put the key in `~/.agenticview/config.json` under `providers.claude.apiKey`. |
| **claude-session** ("Claude Code session") | Your own Claude Code session running `/agenticview-work` pulls tasks from the office queue over the plugin's `agenticview-worker` MCP server and runs each in the agent's own background subagent (`.claude/agents/agenticview-<name>.md`). AgenticView never spawns `claude` for it. | A Claude Code login (Max/Pro works). Run `/agenticview-work` in a session for the project; it shows as available while at least one session is polling. Tasks wait in the queue until a session picks them up. |
| **codex** | `@openai/codex-sdk` driving the installed `codex` CLI | `npm i -g @openai/codex`, then sign in (`codex login`) or set `CODEX_API_KEY`. |
| **antigravity** | The installed Antigravity CLI (`agy -p ... --output-format stream-json`) | Install `agy` and run it once to sign in with your Antigravity account. Found on `PATH` or at `%LOCALAPPDATA%\agy\bin\agy.exe`. |
| **gemini** | The installed `gemini` CLI in headless streaming mode | `npm i -g @google/gemini-cli`, then sign in or set `GEMINI_API_KEY`. |

The settings panel in the office shows each provider's status and the reason when one is unavailable. Creating an agent on an unavailable provider is refused with that reason, except for *Claude Code session*, whose tasks simply wait until a worker session connects.

With the default provider on **Automatic**, agents without their own provider run on the first available provider in the order claude, claude-session, codex, antigravity, gemini. The settings panel shows the current choice, e.g. *Automatic (Codex)*.

Each agent can set a model and an effort level. Claude offers the `opus`, `sonnet`, `haiku` and `fable` aliases with effort low–max (none for Haiku); Codex offers the models your CLI knows with effort low–max; Antigravity offers the models `agy models` lists (effort low, medium, high or max for models whose id does not already end in -high/-medium/-low); Gemini offers its model aliases and has no effort control. A *Claude Code session* agent's model is written into its subagent file, so it really runs on that model; without one it inherits the session's model. The effort is a hint for how thorough to be. *Custom…* accepts any model id.

Only Claude supports interactive permission prompts. For Codex, Antigravity and Gemini, the `ask` mode maps to the most restrictive non-interactive setting each CLI offers, and the office says so:

| Agent permission mode | Claude | Codex | Antigravity | Gemini |
|---|---|---|---|---|
| `ask` | prompts you in the office | `read-only` sandbox | read-only: file-edit and shell tools blocked by deny hooks | `default` approval mode (headless: unapproved tools are rejected) |
| `auto-edit` | accept edits | `workspace-write` sandbox (`danger-full-access` on Windows, where Codex's sandbox cannot write files) | edits allowed, shell tools blocked (`--mode accept-edits` plus deny hooks) | `auto_edit` |
| `auto` | bypass permissions | `danger-full-access` | `--dangerously-skip-permissions` | `yolo` |

Gemini reads MCP servers and tool exclusions from settings files, so while a Gemini worker runs, AgenticView temporarily adds an `agenticview-<run>` server entry and a `tools.exclude` list (for tools that agent may not use) to `<project>/.gemini/settings.json`, and restores the file when the last Gemini run in that project finishes. Concurrent runs each get their own entry; exclusions are the union of all running agents. If the server ever dies mid-run, the next launch strips the leftovers.

Antigravity only has a global MCP config (`~/.gemini/config/mcp_config.json`), which AgenticView never edits. Instead, while an Antigravity agent runs with office tools (delegate, report, ...) or with tools it may not use, AgenticView writes a workspace plugin at `<project>/.agents/plugins/agenticview-<run>/`: `mcp_config.json` for the bridge server, and `hooks.json` with `PreToolUse` hooks that deny the blocked tools (file edits, shell, web/browser). It deletes the plugin, along with agy's schema cache for it under `~/.gemini/antigravity-cli/mcp/`, when the run ends, and removes `.agents/plugins` and `.agents` again if the run created them. Stale plugins from a crashed server are removed on the next launch. Headless agy rejects MCP tool calls unless it runs with `--dangerously-skip-permissions` (hooks can deny tools but cannot approve them), so runs with office tools use that flag and rely on the deny hooks for the agent's limits.

**Gemini vs Antigravity.** Both are Google agents but they sign in differently: the Gemini CLI needs a Gemini API key (`GEMINI_API_KEY`) or a Google account with a Google Cloud project (`GOOGLE_CLOUD_PROJECT`), while the Antigravity CLI uses your Antigravity sign-in and needs neither.

An agent whose tools disallow both editing and shell (the Manager, for example) runs Codex in a `read-only` sandbox, Antigravity with the edit and shell tools denied by hooks, and Gemini with the write, shell and web tools excluded, regardless of its permission mode.

## Claude Code sessions as workers

The *Claude Code session* provider uses sessions you start yourself; AgenticView never launches `claude` or the Agent SDK for it. Run `/agenticview:agenticview-work` (or `/agenticview-work`) in a Claude Code session for the project, optionally with an agent name: `/agenticview:agenticview-work Nova`.

- **Agents are subagents.** For every Claude Code session agent the office writes a Claude Code subagent into the project, `.claude/agents/agenticview-<name>.md` (its description, model, allowed tools and system prompt plus the worker protocol). It is rewritten when you edit the agent and on every task, and deleted when the agent is deleted or moves to another provider. Files without the office's `agenticview:generated` marker line are never touched, so you can take one over by deleting that line. The session running `/agenticview-work` is a coordinator: it claims several tasks at once and launches each in its agent's subagent in the background, keeps polling while they work, and completes a run itself if a subagent forgets. A freshly created agent's subagent is picked up by sessions started afterwards (a running session falls back to a general-purpose subagent with the same instructions).
- **Which session serves which agent.** Each session identifies itself with its Claude Code session id and reports the model it runs on. A session takes tasks of agents bound to it first. A task of an agent with no session goes to any free session, and that session becomes the agent's session from then on. Naming an agent in the command binds it to that session. The office shows the bound session, its online state and its model in the chat header and on the robot's name tag.
- **Several tasks, several sessions.** Each session runs up to its capacity of tasks at once (default 4, editable in **Sessions**), one task per agent at a time. Every call about a task carries its `run_id`, so the office always knows which agent did what. Open more sessions for more parallel work, or to keep agents in separate contexts.
- **Continuity.** Each task handed to a subagent includes *Your recent work*: the agent's last five tasks with their results, changed files and the subagent id that did them. The office records per task which session and subagent served it; the agent's chat shows a **Work log** and the header shows the session and subagent serving it right now. A session may continue a still-running subagent with SendMessage instead of starting a new one.
- **Persistence.** Sessions and their capacity (`.agenticview/worker-sessions.json`) and bindings (on each agent) survive closing the office and the session. When you resume the session (`claude --resume <id>`, or **Open session** in the office) and run the command again, it picks up its agents' tasks. While an agent's session is offline its tasks wait, and the chat shows *Waiting for session …* with **Open session**, **Use any session**, or a pick of another session.
- **Managing sessions in the office.** **Sessions** in the top bar lists every known session (online dot, model, capacity, agents it serves, the tasks running in it with their subagents, last seen) with Rename, Forget and Open session, plus **New session**, which opens a new Claude Code tab in VS Code with the command typed in. Press Enter in that tab to connect it: the prompt is never sent automatically. The agent form has a **Session** picker (Any free session, a known session, or Open a new session…), and creating a Claude Code session agent offers to open a session for it. The links use the Claude Code VS Code extension (`vscode://anthropic.claude-code/open`); without it the office shows the command to run in a terminal instead.
- **Models.** A subagent runs on its own model setting, so the model picked for the agent in the office (opus, sonnet, haiku, fable) applies. An agent without a model inherits the session's model, which only you can switch with `/model` in that session; when a picked model cannot apply (no subagent), the office shows *Session X is on Y; run /model Z in that session to switch*.
- **Managers on a session.** A Manager's `await_tasks` over a session returns about every 4 minutes with the tasks still running, and the session calls it again, so long waits are never cut off by a timeout. A Manager and its workers can share one session: the workers run in their own subagents next to the Manager's. Only when every slot of that session is held by the waiting Manager (capacity 1) do `assign_task` and `await_tasks` refuse with a message, since the worker could never start; raise the capacity, or open another session for that worker.

## Rate-limit status line (Pro/Max plans)

Claude Code's `statusLine` hook fires after every response and carries the current rate-limit counters — how many tokens and requests are left in the 5-hour and weekly windows — but only on Pro and Max plans, and only after the first response in a session. Plugins cannot install a `statusLine` command themselves (Claude Code writes the hook into `~/.claude/settings.json`, which is outside any project's plugin scope), so AgenticView ships an opt-in skill instead.

Running `/agenticview-statusline` installs the relay: it sets `statusLine` in `~/.claude/settings.json` to invoke `bin/statusline.mjs`, which posts the counters to the office (so the office can show them) and then exits. If you already have a status-line command configured, the relay saves it as a backup and wraps it: the original command is stored in `~/.agenticview/statusline-backup.json` and passed to the relay via the `AGENTICVIEW_STATUSLINE_WRAP` environment variable (set through the settings `env` key, which is cross-platform and needs no shell prefix). The relay then runs it and forwards its output, so your existing status line keeps working unchanged.

### Turning the relay on

```
/agenticview-statusline
```

The skill reads `~/.claude/settings.json`, shows you the before and after of the `statusLine` key, and asks for confirmation before writing. It never touches any other key.

### Turning the relay off

```
/agenticview-statusline off
```

The skill restores the original `statusLine` value from the backup (or removes `statusLine` entirely if there was none before), shows the diff, and asks for confirmation.

### Notes

- Rate-limit data is only available on Claude Pro and Max plans. On other plans the hook fires but carries no counters; the office simply receives nothing.
- The data arrives after the first response in each window, not before it. The office shows counters as soon as Claude Code delivers them.
- The relay is a lightweight Node.js script with no extra dependencies. The office does not need the relay to function; turning it off has no other effect.

## Scopes and where data lives

| | Project agents | Global agents |
|---|---|---|
| Stored in | `<project>/.agenticview/agents/` | `~/.agenticview/agents/` |
| Appear in | that project's office | every office (in the Lobby) and the Hub |
| Can work in | that project only | any known project |

`<project>/.agenticview/` also holds tasks, settings and the Claude Code session records. Every project keeps its own folder, and the office adds it to the project's `.gitignore` when it opens (creating the file if needed), together with the generated subagents:

```gitignore
# AgenticView
.agenticview/
.claude/agents/agenticview-*.md
```

Only missing lines are added, once, and your own lines and line endings are kept. To commit your agents (and settings), delete the `.agenticview/` line (and the subagent line to commit those too): the office does not add a line back once its `# AgenticView` block exists. Inside, `.agenticview/.gitignore` still keeps tasks (which carry logs), sessions and uploads out of Git. `~/.agenticview/config.json` holds global defaults, provider settings, and the list of known projects.

## Security

The server binds to `127.0.0.1` only. Every request and WebSocket connection needs the random token that is minted at launch and passed once in the URL. Agents only receive the tools you allowed on them. Custom tools handed to Codex, Antigravity and Gemini go through a per-run bridge token that stops working when the run ends.

## FAQ

### What does AgenticView do? Does it change my actual project?

AgenticView puts a team of coding agents in a browser-based 3D office. You give the Manager a request, workers carry it out in your project's working tree, and the office shows their activity. Review the changes in your editor or with `git diff`; see the [test drive](#test-drive-in-a-project-5-minutes) for a first task.

### What do I need to get started? Can I try it without credentials?

For the plugin, use Claude Code 2.x, Node.js 22 or newer on PATH, and a browser. Follow [Install](#install), restart Claude Code once, then run `/agenticview` from a session opened in your project folder. Real agents need a configured provider; [demo mode](#try-it-with-no-credentials-demo-mode) uses scripted echo agents without credentials. You can also [run from a clone](#without-the-plugin-from-a-clone).

### Which providers can I use, and how do I set them up?

- **Claude API (`claude`):** set `ANTHROPIC_API_KEY`, or put the key under `providers.claude.apiKey` in `~/.agenticview/config.json`.
- **Claude Code session (`claude-session`):** sign in to Claude Code and run `/agenticview-work` in a session for the project. This supports your Max/Pro session; the API provider does not reuse that login.
- **Codex (`codex`):** install with `npm i -g @openai/codex`, then run `codex login` or set `CODEX_API_KEY`.
- **Antigravity (`antigravity`):** install the `agy` CLI and run `agy` once to sign in with your Antigravity account.
- **Gemini (`gemini`):** install with `npm i -g @google/gemini-cli`, then run `gemini` to sign in or set `GEMINI_API_KEY`.

Choose a provider per agent or use the office default. **Automatic** selects the first available provider in this order: Claude API, Claude Code session, Codex, Antigravity, Gemini. See [Providers and credentials](#providers-and-credentials) for availability, models, and permission differences.

### What does the Manager do, and what do workers do?

Atlas reads the project, plans assignments, chooses or creates workers, and collects their results before reporting back. The Manager is instructed never to edit files itself and has read-only file tools by default. Workers make the requested changes and run relevant checks using their allowed tools. Give Atlas the desired outcome, scope, and verification criteria; click a worker to talk to it directly.

### How do I assign work, track it, or cancel it?

Use the bottom command bar to send work to Atlas, or a worker's chat to send it a request directly. The **Tasks** panel shows the assignee and status: **Queued** includes assigned tasks, **Running** means work is active, **Waiting** means an office question or approval needs your response, and **Done** or **Failed** shows the outcome (cancelled tasks appear under Failed). Click a task to open its agent's chat; use **Cancel** on an unfinished task to stop it.

### Why is a Claude Code session task waiting for a worker or session?

Run `/agenticview-work` in a Claude Code session opened in the same project. If the agent is bound to an offline session, use **Open session**, **Use any session**, or choose another session in the office. A session runs several tasks at once (its capacity, default 4), so a session-backed Manager and its workers can share it; with capacity 1 they need separate sessions. If the worker tools are missing after installation or an update, restart Claude Code so the plugin's MCP server loads. See [Claude Code sessions as workers](#claude-code-sessions-as-workers).

### When will agents ask for approval?

Set tool allowances and the permission mode in the agent form. Claude API agents can show **Allow**/**Deny** prompts in the office; `auto-edit` accepts edits and `auto` bypasses permission prompts. Codex, Antigravity and Gemini do not support those interactive office prompts: `ask` uses Codex's read-only sandbox, a read-only Antigravity run (edit and shell tools blocked) or Gemini's restrictive headless mode. Claude Code session workers use their session's own permission prompts; the office setting does not change them. Check the [permission mapping](#providers-and-credentials) before choosing a mode, especially on Windows, where Codex `auto-edit` runs unsandboxed.

### Why will the office not open, or why is a provider unavailable?

If `plugin-root` is missing, restart Claude Code and retry `/agenticview`. If the page asks for its launch link, use the complete printed URL, including `#token=`. For an unavailable provider, hover its status chip or open **Settings** to read the reason, then check that its CLI or credentials are visible to the server. Provider checks are cached for a minute; after changing the server's environment, stop and relaunch the office. See [Troubleshooting](#troubleshooting) for specific provider errors.

### Can I reuse agents across projects, and where is their data stored?

Project agents work only in their own project; global agents appear in every office and can work in known projects or be copied into a project. Open `/agenticview-hub` to manage global agents and known projects. Project data lives under `<project>/.agenticview/`, while global agents and defaults live under `~/.agenticview/`; see [Scopes and where data lives](#scopes-and-where-data-lives) for storage and Git tracking details.

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

### Releasing

Prepare the release on `main`. Keep the version consistent across these seven files (the lockfile is refreshed by npm):

- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json` (the `agenticview` plugin entry)
- `package.json`
- `packages/shared/package.json`
- `packages/server/package.json`
- `packages/web/package.json`
- `package-lock.json` (root and workspace versions)

Bump the six manifest versions to `X.Y.Z`, run `npm install` to refresh the lockfile, then run `npm run build`. The shared and server builds use `tsc -b --force` so committed bundles match a clean build. Commit the version changes, lockfile, and rebuilt bundles in `packages/shared/dist`, `packages/server/dist`, and `packages/web/dist`, then publish the tag:

```sh
git tag vX.Y.Z && git push origin main --tags
```

The [release workflow](.github/workflows/release.yml) runs for tags matching `v*.*.*`, or manually through **Actions > release > Run workflow** with an existing tag as input. Its read-only verification job checks out that tag without persisting credentials, verifies its version against all six manifests, runs `npm ci`, typechecking, tests, and a full build on Ubuntu with Node 22, and rejects modified or untracked files in any of the three committed dist directories. Only after those checks pass does a separate job with release permissions create a GitHub release with generated notes. Tags with a prerelease suffix, such as `v1.2.3-beta.1`, are marked as prereleases.

Users update from their terminal with:

```sh
claude plugin marketplace update agenticview
claude plugin update agenticview@agenticview
```

Restart Claude Code after updating.

## License

MIT
