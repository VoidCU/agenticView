import { test, expect } from "@playwright/test";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { E2E_HOME } from "./paths";

// Disable tracing: on Windows the test-results directory may not exist, causing an ENOENT
// when Playwright tries to write the trace zip even for passing tests (retain-on-failure
// triggers a write attempt during browserContext.close regardless of pass/fail on Windows).
test.use({ trace: "off" });

function launchToken(): string {
  const dir = join(E2E_HOME, "instances");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "hub.json");
  if (files.length === 0) throw new Error(`no instance file in ${dir}`);
  return (JSON.parse(readFileSync(join(dir, files[0]!), "utf8")) as { token: string }).token;
}

const viewports = [
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "1280x800", width: 1280, height: 800 },
];

for (const viewport of viewports) {
  for (const theme of ["light", "dark"] as const) {
    test(`HUD panel edges ${theme} ${viewport.name}`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize(viewport);
      await page.addInitScript((selectedTheme) => {
        localStorage.setItem("av:hud:chat-collapsed", "false");
        localStorage.setItem("av:hud:tasks-collapsed", "false");
        localStorage.setItem("av:hud:show-tags", "false");
        document.documentElement.setAttribute("data-theme", selectedTheme);
      }, theme);
      await page.goto(`/#token=${launchToken()}`);
      await expect(page.locator(".panel-tasks")).toBeVisible({ timeout: 20_000 });
      await expect(page.locator(".panel-chat")).toBeVisible();
      await expect(page.locator(".tag-name")).toHaveCount(0);
      mkdirSync("e2e/screenshots", { recursive: true });
      await page.screenshot({ path: `e2e/screenshots/hud-panels-open-${theme}-${viewport.name}.png` });

      await page.getByRole("button", { name: "Collapse tasks" }).click();
      await page.getByRole("button", { name: "Collapse chat" }).click();
      await expect(page.getByRole("button", { name: /Expand tasks/ })).toBeVisible();
      await expect(page.getByRole("button", { name: "Expand chat" })).toBeVisible();
      await expect(page.locator(".panel-tasks, .panel-chat")).toHaveCount(0);
      await page.screenshot({ path: `e2e/screenshots/hud-panels-collapsed-${theme}-${viewport.name}.png` });
    });
  }
}
