---
name: agenticview-work
description: Turn this Claude Code session into an AgenticView worker that pulls tasks from the office queue (the "Claude Code session" provider) and does them with this session's own tools. Use when the user runs /agenticview-work or asks this session to work on AgenticView office tasks.
argument-hint: "[agent name]"
arguments: [agent]
---

This session becomes a worker for the AgenticView office of the current project (or the Hub if no project office is running). Office agents set to the **Claude Code session** provider (`claude-session`) queue their tasks; you pick them up one at a time and do them here, with your own tools, on the user's own Claude Code plan. AgenticView never launches Claude itself for this provider: the user starts every session.

The worker tools come from the plugin's `agenticview-worker` MCP server: `agenticview_next_task`, `agenticview_report`, `agenticview_complete`, `agenticview_bridge`.

## Identity (pass on every call)

- `session_id`: `${CLAUDE_SESSION_ID}` (exactly this value). The office uses it to recognise this session again after the user closes and resumes it, and to route each agent's tasks to its own session.
- `model`: the model this session is running on right now, as your system prompt names it (for example `claude-opus-5-5[1m]` or `Opus 5.5`). Pass it to `agenticview_next_task`. The office shows it; you cannot change it.
- `agent`: the agent to serve, from the command arguments: `$ARGUMENTS`. If that is empty, omit `agent`. If it names an agent (for example `/agenticview:agenticview-work Nova`), pass `agent: "Nova"` to `agenticview_next_task`: the office binds that agent to this session.

## Loop

1. Call `agenticview_next_task` with `session_id`, `model` and (if given) `agent`. It waits (up to 10 minutes by default) for a task.
   - If it says no office is running, tell the user to open it with `/agenticview` and stop.
   - If the tools are missing or the `agenticview-worker` server failed to connect, or a tool says it is still installing, tell the user to run `/mcp`, pick `agenticview-worker`, choose Reconnect (after a restart of Claude Code if it is not listed), then run `/agenticview-work` again, and stop.
   - If it says no task arrived yet, call it again right away. Do not ask the user between polls.
2. When a task arrives, work on it:
   - Adopt the agent persona: follow the **Agent system prompt** in the task as your instructions for this task, and answer as that agent.
   - Work in the task's **Working directory** (use absolute paths there; `cd` into it for shell commands).
   - Respect **Allowed tools** strictly. If file edits are not allowed, do not use Edit, Write, MultiEdit, NotebookEdit or shell commands that change files. If shell is not allowed, do not use Bash. If web is not allowed, do not use WebFetch or WebSearch. Reading files is always fine.
   - If the task shows **MODEL MISMATCH**, your first `agenticview_report` must say so, for example: "Session is on Sonnet 5; run /model opus in this session to switch." Then carry on with the current model. Never try to switch models yourself.
   - If the task lists attached images, read those files.
   - Report progress briefly with `agenticview_report` at meaningful steps (a one-line `text`, or `events` such as `{"type":"file_changed","path":"src/a.ts","kind":"modify"}` after editing a file). Keep it short; the office shows it in the agent's chat.
   - Use `agenticview_bridge` with `{tool, args}` to call the office tools listed under **Office tools** (for example a Manager's `list_agents`, `create_agent`, `assign_task`, `await_tasks` and `ask_user`, or a worker's `take_screenshot`). Do not use your own subagents in place of office delegation when the task asks you to delegate.
   - Long waits: `await_tasks` over the bridge returns after about 4 minutes with a `stillRunning` list when tasks are not done yet. Call it again with those ids until everything has finished. That is normal, not an error.
   - If `assign_task` or `await_tasks` says waiting would deadlock (the worker is bound to this same session), do not wait: tell the user to open another Claude Code session for that agent (Sessions panel in the office > New session, or `/agenticview:agenticview-work <agent>` in a new session) or to switch the agent to another session, and report that in your result.
3. Call `agenticview_complete` with `result` set to your final answer for the user (what you did, files changed, how you verified). If you could not do it, pass `error` with the reason instead.
4. Go back to step 1 immediately.

If any worker tool replies that the task was cancelled, stop working on it at once and go back to step 1.

Keep looping until the user interrupts you. One session handles one task at a time; to run tasks in parallel, open more Claude Code sessions in the project and run `/agenticview-work` in each.

## How the office routes tasks

- Each `claude-session` agent is bound to one session. This session gets the tasks of agents bound to it first.
- A task of an agent with no session goes to any free session, and that session becomes the agent's session from then on (sticky).
- A task of an agent bound to another session waits for that session, even if it is closed. The office shows "waiting for session ..." with buttons to reopen it, use any session, or pick another one.
- Bindings and session names persist: resuming this session later (`claude --resume`, or Open in the office) reconnects the same agents.

Notes:
- The office shows the provider as available while this session is polling or working ("N workers"), and lists it in its Sessions panel.
- Your permission prompts are this session's own: the office's per-agent permission mode does not change them.
- Stay on this session's model: only the user can switch it (`/model`). A **Requested model** in the task is informational.
- Scale effort to the task's **Requested effort** (low, medium, high, xhigh, max). Low: answer directly with the minimum reading and checking needed. Medium: normal care. High and above: investigate thoroughly, consider edge cases, and verify (tests, typecheck) before completing; at max, be exhaustive. With no requested effort, use your normal judgement.
