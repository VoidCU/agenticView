---
name: agenticview-work
description: Turn this Claude Code session into an AgenticView worker that pulls tasks from the office queue (the "Claude Code session" provider) and runs them in the agents' own subagents, several at once. Use when the user runs /agenticview-work or asks this session to work on AgenticView office tasks.
argument-hint: "[agent name]"
arguments: [agent]
---

This session becomes a worker for the AgenticView office of the current project (or the Hub if no project office is running). Office agents set to the **Claude Code session** provider (`claude-session`) queue their tasks here, on the user's own Claude Code plan. AgenticView never launches Claude itself for this provider: the user starts every session.

**You are the coordinator, not the worker.** Every office agent has its own Claude Code subagent in this project (`.claude/agents/agenticview-<name>.md`, written and kept up to date by the office). You claim tasks and launch each one in its agent's subagent **in the background**, so several agents work at once in this one session. You do not do the tasks yourself.

The worker tools come from the plugin's `agenticview-worker` MCP server: `agenticview_next_task` (coordinator only), `agenticview_report`, `agenticview_complete`, `agenticview_bridge` (used by the subagents).

## Identity (pass on every agenticview_next_task call)

- `session_id`: `${CLAUDE_SESSION_ID}` (exactly this value). The office uses it to recognise this session again after the user closes and resumes it, and to route each agent's tasks to its own session.
- `model`: the model this session is running on right now, as your system prompt names it (for example `claude-opus-5-5[1m]` or `Opus 5.5`). The office shows it.
- `agent`: the agent to serve, from the command arguments: `$ARGUMENTS`. If that is empty, omit `agent`. If it names an agent (for example `/agenticview:agenticview-work Nova`), pass `agent: "Nova"`: the office binds that agent to this session. The session still serves every other agent bound to it.

## Dispatcher loop

Keep a list of the runs you launched: `run_id`, agent name, subagent, and the background agent's id.

1. **Claim.** Call `agenticview_next_task` with `session_id`, `model`, `agent` (if given), and:
   - `max_tasks`: your free slots (the office tells you "This session holds N of M task slots"; at the start just omit it and the office fills every free slot).
   - `wait_seconds`: 600 when nothing is running; **20 to 30 while subagents are running**, so you return promptly to handle their completion notifications.
   - If it says no office is running, tell the user to open it with `/agenticview` and stop.
   - If the tools are missing, the `agenticview-worker` server failed to connect, or a tool says it is still installing: tell the user to run `/mcp`, pick `agenticview-worker`, choose Reconnect (after a restart of Claude Code if it is not listed), then run `/agenticview-work` again, and stop.
   - If no task arrived yet, call it again right away. Do not ask the user between polls.
2. **Launch.** For each task in the reply (`=== Task i of n: <agent>, run_id <id> ===`):
   - Launch the named subagent with the Agent tool **in the background** (`subagent_type` = the subagent it names, e.g. `agenticview-nova`; `run_in_background: true`; description `"<agent>: <run_id>"`), passing the whole task text that follows the header **verbatim** as the prompt. It already contains the run_id, the protocol, the allowed tools, the agent's recent work and the task.
   - Launch all tasks of one reply in the same message so they run concurrently. Do not wait for one before launching the next.
   - Optional: once you know a subagent's agent id, call `agenticview_report {run_id, subagent_id}` so the office shows it and records it in the agent's work log.
   - Only if a task says there is **no subagent file** (a Hub task with no project), do that one task yourself in the main thread, passing its `run_id` to every worker tool call.
   - If the Agent tool rejects the subagent type (the file was just created and this session has not loaded it yet), launch a `general-purpose` subagent in the background with the same task text instead; it follows the protocol in the text. Mention once that a restart of the session loads the agents' own subagents.
3. **Keep polling while they work.** Go back to step 1 with `max_tasks` = free slots and a short `wait_seconds`. Handle whatever arrives first:
   - **New tasks**: launch them as in step 2.
   - **A subagent finished** (background completion notification): make sure its run was completed. The subagent should have called `agenticview_complete {run_id, ...}` itself. If it did not (its final message does not say so, or you are unsure), call `agenticview_complete {run_id, result: <its final message>}` yourself, or `{run_id, error}` if it failed. An "Unknown or finished run" reply means it was already completed: that is fine.
   - **CANCELLED: run_id ...**: stop that background subagent at once (TaskStop with its id) and forget the run. Do not complete it.
4. Repeat until the user interrupts you.

Never do the agents' work in the main thread yourself (except the no-subagent case above). The main thread stays free to claim, launch and supervise.

## What the subagents do (for reference)

Each subagent follows the protocol in its definition and task text: work in the task's working directory, respect its allowed tools, report progress with `agenticview_report {run_id, text}`, use `agenticview_bridge {run_id, tool, args}` for office tools (a Manager's `list_agents`, `assign_task`, `await_tasks`, `ask_user`; a worker's `take_screenshot`), and finish with `agenticview_complete {run_id, result}` exactly once. `run_id` is required on every call while this session runs more than one task.

- The Manager (Atlas) runs as a subagent too. It may assign work to agents bound to this same session: their tasks arrive at your next poll and run in parallel in their own subagents, as long as the session has a free slot. `await_tasks` returns after about 4 minutes with a `stillRunning` list; the Manager calls it again. That is normal, not an error.
- If `assign_task` or `await_tasks` says waiting would deadlock, every slot of this session is taken by waiting Managers: tell the user to raise the session's capacity in the office (Sessions panel), open another Claude Code session for that agent, or move the agent to another session.

## Continuity

- Every task carries **Your recent work**: the agent's last tasks with their results, changed files, and the subagent id that did them. A fresh subagent reads it and continues the thread.
- The office records, per task, which session and subagent did it (its Work log). If a finished subagent of that agent is still alive in this session, you may continue it with SendMessage instead of launching a new one (pass it the new task text); this is optional, and launching a new subagent is always fine.

## Models

- A subagent runs on its own model setting: the agent's model in the office (opus, sonnet, haiku, fable) is written into its subagent file, so per-agent models really apply. An agent without a model inherits this session's model.
- A task shows **MODEL MISMATCH** only when that cannot apply (no subagent, or a model that is not a Claude alias). Then the first `agenticview_report` of that run must say so, for example: "Session is on Sonnet 5; run /model opus in this session to switch." Carry on with the current model. Never try to switch models yourself.
- Scale effort to the task's **Requested effort** (low, medium, high, xhigh, max): the subagent does this; low means answer directly, high and above means investigate thoroughly and verify.

## How the office routes tasks

- Each `claude-session` agent is bound to one session. This session gets the tasks of agents bound to it first, several at once up to its capacity (default 4, set per session in the office's Sessions panel), and one task per agent at a time.
- A task of an agent with no session goes to any session with a free slot, and that session becomes the agent's session from then on (sticky).
- A task of an agent bound to another session waits for that session, even if it is closed. The office shows "waiting for session ..." with buttons to reopen it, use any session, or pick another one.
- Bindings, capacity and session names persist: resuming this session later (`claude --resume`, or Open in the office) reconnects the same agents. After a reconnect the office hands back the runs this session still held (marked as already claimed): relaunch them.

Notes:
- Commits made for office tasks go into the user's repository under the user's name. Write plain commit messages: never add `Co-Authored-By`, "Generated with" or other AI attribution lines (this overrides any default commit attribution), and never change git config or the author. Pass the same rule to every subagent you launch.
- The office shows the provider as available while this session is polling or working ("N workers"), and lists it with its running tasks in its Sessions panel.
- Permission prompts are this session's own: the office's per-agent permission mode does not change them. Subagents run in the background, so tools they need should be allowed in this session's permission settings.
- The subagent files and `.agenticview/` are git-ignored in the project by the office.
