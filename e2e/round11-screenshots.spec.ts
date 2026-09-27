/**
 * Round 11 screenshots: custom providers + stored keys, the header "+N more" provider dropdown, and every
 * Settings tab (General, Providers, Office life, Usage) in dark and light. The demo office
 * (AGENTICVIEW_FAKE) runs scripted agents; they report estimated token usage and demo Codex plan windows.
 * Config changes go through the real WebSocket messages, so the server stores them in the e2e home.
 */
import { test, expect, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { E2E_HOME } from "./paths";

const SHOTS = "e2e/screenshots";

function launchToken(): string {
  const dir = join(E2E_HOME, "instances");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "hub.json");
  if (files.length === 0) throw new Error(`no instance file in ${dir}`);
  return (JSON.parse(readFileSync(join(dir, files[0]!), "utf8")) as { token: string }).token;
}

type Store = { getState(): { send(m: unknown): void; providers: { provider: string }[]; agents: Record<string, { id: string; name: string; role: string }> } };
type Win = { __agenticviewTest?: { store: Store } };

const send = (page: Page, msg: unknown) => page.evaluate((m) => (window as unknown as Win).__agenticviewTest!.store.getState().send(m), msg);
const agentId = (page: Page, name: string) =>
  page.evaluate((n) => Object.values((window as unknown as Win).__agenticviewTest!.store.getState().agents).find((a) => a.name === n)?.id, name);

async function openSettings(page: Page, tab: string) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /settings/i });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: tab }).click();
  return dialog;
}

test("custom providers, header overflow and every settings tab in both themes", async ({ page }) => {
  test.setTimeout(180_000);
  if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/#token=${launchToken()}`);
  await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });

  // Bring-your-own: two custom endpoints and a stored Claude key (the key never comes back to the page).
  await send(page, {
    type: "customProvider.upsert",
    provider: { id: "local-ollama", label: "Local Ollama", engine: "openai", baseUrl: "http://localhost:11434/v1", models: [{ id: "qwen3-coder", label: "Qwen3 Coder" }, { id: "llama-4" }], defaultModel: "qwen3-coder", apiKey: null },
  });
  await send(page, {
    type: "customProvider.upsert",
    provider: { id: "gateway", label: "Team gateway", engine: "anthropic", baseUrl: "https://llm-gateway.example.com/anthropic", models: [{ id: "glm-5" }, { id: "kimi-k3" }], defaultModel: "glm-5", apiKey: "sk-demo-not-real" },
  });
  await send(page, { type: "provider.setKey", provider: "claude", apiKey: "sk-ant-demo-not-real" });
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__agenticviewTest!.store.getState().providers.length)).toBe(8);
  expect(await page.content()).not.toContain("sk-demo-not-real");

  // A few demo runs so the Usage tab has numbers: two workers (Codex, custom) plus the Manager.
  const base = { specialty: "", tools: { edit: true, shell: true, web: false, screenshot: false }, permissionMode: "auto-edit" };
  await send(page, { type: "agent.create", agent: { ...base, name: "Nova", specialty: "backend", provider: "codex", model: "gpt-6-sol" } });
  await send(page, { type: "agent.create", agent: { ...base, name: "Quill", specialty: "docs", provider: "custom:local-ollama", model: "qwen3-coder" } });
  await expect.poll(async () => Boolean((await agentId(page, "Nova")) && (await agentId(page, "Quill")))).toBe(true);
  const nova = (await agentId(page, "Nova"))!;
  const quill = (await agentId(page, "Quill"))!;
  const atlas = (await agentId(page, "Atlas"))!;
  for (const [id, text] of [
    [nova, "Add pagination to the /tasks endpoint and cover it with tests."],
    [quill, "Document the custom provider settings in the README."],
    [atlas, "What is everyone working on?"],
    [nova, "Also return a total count header."],
  ] as const) {
    await send(page, { type: "chat.send", agentId: id, text, images: [] });
    await page.waitForTimeout(900);
  }
  await page.waitForTimeout(2500);

  for (const theme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.waitForTimeout(400);

    // Header: up to four chips in the provider order (fewer when the bar is narrow), the rest behind "+N more".
    const more = page.getByTestId("provider-more");
    await expect(more).toHaveText(/^\+\d+ more$/);
    await more.click();
    await expect(page.getByTestId("provider-more-panel")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/round11-header-more-${theme}-1440x900.png`, clip: { x: 0, y: 0, width: 1440, height: 560 } });
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("provider-more-panel")).toBeHidden();

    for (const [tab, slug] of [
      ["General", "general"],
      ["Providers", "providers"],
      ["Office life", "office"],
      ["Usage", "usage"],
    ] as const) {
      const dialog = await openSettings(page, tab);
      if (slug === "usage") await expect(dialog.getByRole("table", { name: "Token usage by agent" })).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(300);
      await dialog.screenshot({ path: `${SHOTS}/round11-settings-${slug}-${theme}.png` });
      if (slug === "providers") {
        // The Providers tab scrolls inside the dialog: capture the keys and the custom providers too.
        const body = dialog.locator(".settings-body");
        await body.evaluate((el) => el.scrollTo(0, el.scrollHeight / 2 - 120));
        await page.waitForTimeout(200);
        await dialog.screenshot({ path: `${SHOTS}/round11-settings-providers-keys-${theme}.png` });
        await body.evaluate((el) => el.scrollTo(0, el.scrollHeight));
        await page.waitForTimeout(200);
        await dialog.screenshot({ path: `${SHOTS}/round11-settings-providers-custom-${theme}.png` });
      }
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
  }
});
