import { test } from "node:test";
import assert from "node:assert/strict";
import { pickInstance } from "../hooks/hook.mjs";

test("pickInstance only targets the office for the current project, or the hub", () => {
  const a = { url: "http://a", token: "a", projectPath: "C:\\Proj\\A" };
  const b = { url: "http://b", token: "b", projectPath: "C:\\Proj\\B" };
  const hub = { url: "http://hub", token: "h", projectPath: null };
  assert.equal(pickInstance([a, b, hub], "c:/proj/b/"), b);
  assert.equal(pickInstance([a, b, hub], "C:\\Proj\\Elsewhere"), hub);
  assert.equal(pickInstance([a, b], "C:\\Proj\\Elsewhere"), undefined);
  assert.equal(pickInstance([], "C:\\Proj\\A"), undefined);
});
