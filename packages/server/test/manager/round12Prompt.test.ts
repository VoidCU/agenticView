import { describe, it, expect } from "vitest";
import { MANAGER_SYSTEM_PROMPT } from "../../src/manager/tools.js";

describe("round12: manager prompt gating for production and research", () => {
  it("requires production and research to be user-initiated, never self-started", () => {
    expect(MANAGER_SYSTEM_PROMPT).toContain("ONLY when the user explicitly asks for them in their own message");
    expect(MANAGER_SYSTEM_PROMPT).toContain("never self-initiated");
    expect(MANAGER_SYSTEM_PROMPT).toContain("never suggested-and-started");
    expect(MANAGER_SYSTEM_PROMPT).toContain("never as a side effect of other work");
  });

  it("routes production requests to the Producer and research requests to the Research team", () => {
    expect(MANAGER_SYSTEM_PROMPT).toContain("route production requests to the Producer");
    expect(MANAGER_SYSTEM_PROMPT).toContain("research requests to the Research team");
    expect(MANAGER_SYSTEM_PROMPT).toContain("If that team does not exist, tell the user rather than improvising");
  });

  it("reports results through the normal assign_task + await_tasks flow", () => {
    expect(MANAGER_SYSTEM_PROMPT).toContain("Results come back through the normal assign_task + await_tasks flow and are reported like any other task.");
  });

  it("mentions the new rooms and defers layout edits to explicit user requests", () => {
    expect(MANAGER_SYSTEM_PROMPT).toContain("My Office is the user's own room and has no worker seats");
    expect(MANAGER_SYSTEM_PROMPT).toContain("Production Room and Research Room");
    expect(MANAGER_SYSTEM_PROMPT).toContain("set_layout / move_room / set_room_kind");
    expect(MANAGER_SYSTEM_PROMPT).toContain("only when the user asks for a layout change");
  });
});
