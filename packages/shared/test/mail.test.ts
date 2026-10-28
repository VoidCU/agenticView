import { describe, it, expect } from "vitest";
import { MailAmountSchema, MailSourceSchema, MailTagSchema, TaskSchema } from "../src/index.js";

const baseTask = {
  id: "t_1",
  kind: "request",
  title: "x",
  description: "y",
  status: "queued",
  createdBy: "user",
  assigneeId: "a_1",
  projectPath: "/p",
  images: [],
  log: [],
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("mail schemas", () => {
  it("defaults latest n to 50", () => {
    expect(MailAmountSchema.parse({ kind: "latest" })).toEqual({ kind: "latest", n: 50 });
  });
  it("rejects a source with no senders", () => {
    expect(
      MailSourceSchema.safeParse({ id: "s", accountId: "a", senders: [], amount: { kind: "sinceLast" } }).success,
    ).toBe(false);
  });
  it("rejects a non-hex tag colour", () => {
    expect(MailTagSchema.safeParse({ id: "g", name: "n", color: "red", meaning: "" }).success).toBe(false);
  });
  it("task mail field is optional but needs thread ids", () => {
    expect(TaskSchema.safeParse(baseTask).success).toBe(true);
    expect(TaskSchema.safeParse({ ...baseTask, mail: { threadIds: ["a_1"] } }).success).toBe(true);
    expect(TaskSchema.safeParse({ ...baseTask, mail: { threadIds: [] } }).success).toBe(false);
  });
});
