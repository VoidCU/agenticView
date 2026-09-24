import { test } from "node:test";
import assert from "node:assert/strict";
import { formatHookEvent } from "../hooks/hook.mjs";

test("formatHookEvent maps Claude Code hook payloads to short lines", () => {
  assert.deepEqual(formatHookEvent({ hook_event_name: "UserPromptSubmit", prompt: "make it blue" }), { kind: "UserPromptSubmit", text: "You: make it blue" });
  assert.deepEqual(formatHookEvent({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: "src/a.ts" } }), { kind: "PostToolUse", text: "Edit src/a.ts" });
  assert.deepEqual(formatHookEvent({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "npm test" } }), { kind: "PostToolUse", text: "Bash npm test" });
  assert.deepEqual(formatHookEvent({ hook_event_name: "PostToolUse", tool_name: "Grep", tool_input: { pattern: "foo" } }), { kind: "PostToolUse", text: "Grep foo" });
  assert.deepEqual(formatHookEvent({ hook_event_name: "SessionStart" }), { kind: "SessionStart", text: "Session started" });
  assert.deepEqual(formatHookEvent({ hook_event_name: "SessionEnd" }), { kind: "SessionEnd", text: "Session ended" });
  assert.equal(formatHookEvent({ hook_event_name: "UserPromptSubmit", prompt: "x".repeat(200) }).text.length, "You: ".length + 120);
  assert.equal(formatHookEvent({}), undefined);
});
