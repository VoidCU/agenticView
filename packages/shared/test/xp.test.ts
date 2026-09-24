import { it, expect } from "vitest";
import { xpFor, levelFor } from "../src/xp.js";

it("awards per spec", () => {
  expect(xpFor("work", "worker")).toBe(10);
  expect(xpFor("chat", "worker")).toBe(2);
  expect(xpFor("request", "manager")).toBe(5);
  expect(xpFor("work", "manager")).toBe(0);
});

it("levels", () => {
  expect(levelFor(0)).toBe(1);
  expect(levelFor(24)).toBe(1);
  expect(levelFor(25)).toBe(2);
  expect(levelFor(100)).toBe(3);
});
