# AgenticView

A gamified 3D office for your coding agents, packaged as a Claude Code plugin.

Run one command inside any project and a browser tab opens onto an isometric office. Spherical robots are your agents. **Atlas**, the Manager, stands on the podium in the middle. Workers sit at desks around it. You talk to Atlas, Atlas splits the work and hands it to the right worker, and the workers edit your real project files. Flip back to VS Code whenever you like to review the code.

- **Any provider.** Claude is the default. Any agent can instead run on OpenAI **Codex** or Google **Gemini**.
- **Two scopes.** *Project* agents live inside a project and only work there. *Global* agents live in your home folder, show up in every office, can be copied into a project, or can be sent to work on any project you have opened before.
- **A Manager with an accurate map.** Every Manager turn starts with a freshly generated roster and open-task list, so it always knows who exists, who is busy, and what is in flight.
- **Agents that can see.** Workers can take screenshots of a URL, and you can paste screenshots into any chat.
- **Your own session, mirrored.** Plugin hooks show what your Claude Code terminal session is doing as a robot in the office too.

## Install

Inside Claude Code:

```
/plugin marketplace add agenticview/agenticview
/plugin install agenticview@agenticview
```

Then restart Claude Code once so the plugin can record where it was installed.

Requirements: Node 22 or newer. The first launch installs the plugin's dependencies (about a minute); later launches start in a second.

## Use

| Command | What it opens |
|---|---|
| `/agenticview` | The office for the current project |
| `/agenticview-hub` | The Hub: global agents plus your list of known projects |

Outside Claude Code the same thing works with `npx agenticview open --project <path>` or `npx agenticview hub`.

Inside the office:

- Type into the command bar at the bottom to give Atlas a task. Watch the beam fire from the podium to the worker that gets it.
- Click any robot to open its chat panel. Paste an image to attach it.
- Click the empty desk with the `+` pad to create a worker. Pick a name, a specialty, a provider, which tools it may use, and how much it should ask before acting.
- Workers earn XP for finished tasks. Levels only unlock cosmetic accents.
- When a Claude worker in `ask` mode wants to run something risky, a bubble appears over its head with Allow and Deny.

## Providers and credentials

| Provider | How agents run | What you need |
|---|---|---|
| **claude** (default) | Claude Agent SDK (Claude Code as a library) | `ANTHROPIC_API_KEY` in your environment, or a cloud provider env such as `CLAUDE_CODE_USE_BEDROCK`. The Agent SDK does not reuse the Claude Code login. You can also put the key in `~/.agenticview/config.json` under `providers.claude.apiKey`. |
| **codex** | `@openai/codex-sdk` driving the installed `codex` CLI | `npm i -g @openai/codex`, then sign in (`codex login`) or set `CODEX_API_KEY`. |
| **gemini** | The installed `gemini` CLI in headless streaming mode | `npm i -g @google/gemini-cli`, then sign in or set `GEMINI_API_KEY`. |

The settings panel in the office shows each provider's status and the reason when one is unavailable. Creating an agent on an unavailable provider is refused with that reason.

Only Claude supports interactive permission prompts. For Codex and Gemini, the `ask` mode maps to the most restrictive non-interactive setting each CLI offers, and the office says so.

Gemini reads MCP servers from settings files, so while a Gemini worker with custom tools runs, AgenticView temporarily adds an `agenticview` entry to `<project>/.gemini/settings.json` and restores the file afterwards.

## Scopes and where data lives

| | Project agents | Global agents |
|---|---|---|
| Stored in | `<project>/.agenticview/agents/` | `~/.agenticview/agents/` |
| Appear in | that project's office | every office (in the Lobby) and the Hub |
| Can work in | that project only | any known project |

`<project>/.agenticview/` also holds tasks and settings. It gets its own `.gitignore` so agent definitions are committable while logs, sessions, and uploads are not. `~/.agenticview/config.json` holds global defaults, provider settings, and the list of known projects.

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
