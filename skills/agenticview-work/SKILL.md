---
name: agenticview-work
description: Turn this Claude Code session into an AgenticView worker that pulls tasks from the office queue (the "Claude Code session" provider) and does them with this session's own tools. Use when the user runs /agenticview-work or asks this session to work on AgenticView office tasks.
---

This session becomes a worker for the AgenticView office of the current project (or the Hub if no project office is running). Office agents set to the **Claude Code session** provider (`claude-session`) queue their tasks; you pick them up one at a time and do them here, with your own tools, on the user's own Claude Code plan. AgenticView never launches Claude itself for this provider.

The worker tools come from the plugin's `agenticview-worker` MCP server: `agenticview_next_task`, `agenticview_report`, `agenticview_complete`, `agenticview_bridge`.

## Loop

1. Call `agenticview_next_task`. It waits (up to 10 minutes by default) for a task.
   - If it says no office is running, tell the user to open it with `/agenticview` and stop.
   - If it says no task arrived yet, call it again right away. Do not ask the user between polls.
2. When a task arrives, work on it:
   - Adopt the agent persona: follow the **Agent system prompt** in the task as your instructions for this task, and answer as that agent.
   - Work in the task's **Working directory** (use absolute paths there; `cd` into it for shell commands).
   - Respect **Allowed tools** strictly. If file edits are not allowed, do not use Edit, Write, MultiEdit, NotebookEdit or shell commands that change files. If shell is not allowed, do not use Bash. If web is not allowed, do not use WebFetch or WebSearch. Reading files is always fine.
   - If the task lists attached images, read those files.
   - Report progress briefly with `agenticview_report` at meaningful steps (a one-line `text`, or `events` such as `{"type":"file_changed","path":"src/a.ts","kind":"modify"}` after editing a file). Keep it short; the office shows it in the agent's chat.
   - Use `agenticview_bridge` with `{tool, args}` to call the office tools listed under **Office tools** (for example a Manager's `list_agents`, `create_agent`, `assign_task`, `await_tasks` and `ask_user`, or a worker's `take_screenshot`). Do not use your own subagents in place of office delegation when the task asks you to delegate.
3. Call `agenticview_complete` with `result` set to your final answer for the user (what you did, files changed, how you verified). If you could not do it, pass `error` with the reason instead.
4. Go back to step 1 immediately.

If any worker tool replies that the task was cancelled, stop working on it at once and go back to step 1.

Keep looping until the user interrupts you. One session handles one task at a time; to run tasks in parallel, open more Claude Code sessions in the project and run `/agenticview-work` in each.

Notes:
- The office shows the provider as available while this session is polling or working ("N session workers connected").
- Your permission prompts are this session's own: the office's per-agent permission mode does not change them.
- Stay on this session's model; a model named in the task is informational.
