import { describe, it, expect } from "vitest";
import { TRANSITIONS, TaskStatusSchema } from "@agenticview/shared";
import { assertTransition, canTransition, IllegalTransitionError } from "../../src/tasks/transitions.js";

describe("transitions", () => {
  const all = TaskStatusSchema.options;
  it("allows exactly the table", () => {
    for (const from of all) {
      for (const to of all) {
        expect(canTransition(from, to)).toBe(TRANSITIONS[from].includes(to));
      }
    }
  });
  it("throws a typed error with both states", () => {
    expect(() => assertTransition("done", "running")).toThrow(IllegalTransitionError);
    try {
      assertTransition("queued", "done");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as IllegalTransitionError).message).toBe("Illegal task transition: queued -> done");
      expect((e as IllegalTransitionError).from).toBe("queued");
      expect((e as IllegalTransitionError).to).toBe("done");
    }
  });
  it("does not throw on a legal transition", () => {
    expect(() => assertTransition("queued", "assigned")).not.toThrow();
  });
});
