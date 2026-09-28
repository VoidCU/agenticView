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

  it("reports production and research results like any other task", () => {
    expect(MANAGER_SYSTEM_PROMPT).toContain("Results come back as \"## Worker results\" like any other task.");
  });

  it("mentions the new rooms and defers layout edits to explicit user requests", () => {
    expect(MANAGER_SYSTEM_PROMPT).toContain("My Office is the user's own room and has no worker seats");
    expect(MANAGER_SYSTEM_PROMPT).toContain("Production Room and Research Room");
    expect(MANAGER_SYSTEM_PROMPT).toContain("set_layout / move_room / set_room_kind");
    expect(MANAGER_SYSTEM_PROMPT).toContain("only when the user asks for a layout change");
  });

  it("says designated desks exist only in work rooms and meeting room / lounge moves are temporary", () => {
    expect(MANAGER_SYSTEM_PROMPT).toContain("Designated desks exist only in work rooms (pods, Production Room, Research Room)");
    expect(MANAGER_SYSTEM_PROMPT).toContain("moving a worker to the meeting room or lounge only seats it there for a while and keeps its designated desk");
  });
});
