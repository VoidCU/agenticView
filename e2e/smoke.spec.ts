import { test, expect } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { E2E_HOME } from "./paths";

function launchToken(): string {
  const dir = join(E2E_HOME, "instances");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "hub.json");
  if (files.length === 0) throw new Error(`no instance file in ${dir}`);
  const inst = JSON.parse(readFileSync(join(dir, files[0]!), "utf8")) as { token: string };
  return inst.token;
}

test("office loads, agent can be created, and the manager answers", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.goto(`/#token=${launchToken()}`);
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");

  const newName = `Nova${Date.now().toString(36).slice(-4)}`;
  await page.getByRole("button", { name: /new agent/i }).first().click();
  await page.getByPlaceholder("Nova").fill(newName);
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(page.locator(".tag-name", { hasText: newName })).toBeVisible({ timeout: 15_000 });

  const bar = page.getByLabel(/Tell Atlas what to build/);
  await bar.fill("build a login page");
  await bar.press("Enter");
  await expect(page.getByRole("region", { name: "Done" }).or(page.locator("section[aria-label='Done']"))).toBeVisible({ timeout: 20_000 });
  // The reply also lands in the collapsed Work log, so look for a visible copy rather than the first match.
  await expect(page.getByText(/demo mode/).locator("visible=true").first()).toBeVisible({ timeout: 10_000 });

  await expect(page.locator("[data-status='idle'] .tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 15_000 });
  expect(errors, errors.join("\n")).toEqual([]);
});

test("rejects the page without a token and recovers with one", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /needs its launch link/i })).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);
  await page.goto(`/#token=${launchToken()}`);
  await page.reload();
  await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });
});
