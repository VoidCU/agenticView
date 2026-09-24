import type { PermissionMode, Provider } from "@agenticview/shared";

/** What a permission mode really does on each provider. Shown next to the radio so the promise matches the behaviour. */
export function modeHint(provider: Provider, mode: PermissionMode): string {
  switch (provider) {
    case "claude":
      if (mode === "ask") return "Claude asks you before every edit and command: an Allow/Deny bubble appears over the robot.";
      if (mode === "auto-edit") return "Claude makes file edits without asking; shell and web commands still ask you.";
      return "Claude never asks. Best for trusted, sandboxed work.";
    case "codex":
      if (mode === "ask") return "Codex cannot prompt: runs in a read-only sandbox (no edits, no commands).";
      if (mode === "auto-edit") return "Codex writes inside the workspace sandbox without asking. On Windows the sandbox cannot write, so it runs with full access.";
      return "Codex runs with full access and never asks.";
    case "gemini":
      if (mode === "ask") return "Gemini cannot prompt: runs in its default approval mode, where headless tool calls that would need approval are rejected.";
      if (mode === "auto-edit") return "Gemini auto-approves file edits; other tools follow its default policy.";
      return "Gemini runs in yolo mode: everything is approved automatically.";
  }
}
