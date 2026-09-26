/**
 * Inbox with a multi-line (markdown) question, and a Timeline workflow, as review screenshots.
 * Data is injected client-side through the test probe (never sent to the server), so it is stable.
 *
 * Runs when AGENTICVIEW_SCREENSHOTS=1 npm run test:e2e. Saved to e2e/screenshots/ (gitignored).
 */
import { test, expect, type Page } from "@playwright/test";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { E2E_HOME } from "./paths";

test.use({ trace: "off", viewport: { width: 1440, height: 900 } });

function launchToken(): string {
  const dir = join(E2E_HOME, "instances");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "hub.json");
  if (files.length === 0) throw new Error(`no instance file in ${dir}`);
  return (JSON.parse(readFileSync(join(dir, files[0]!), "utf8")) as { token: string }).token;
}

async function open(page: Page) {
  mkdirSync("e2e/screenshots", { recursive: true });
  await page.goto(`/#token=${launchToken()}`);
  await expect(page.locator(".office canvas")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => !!(window as unknown as { __agenticviewTest?: { inject?: unknown } }).__agenticviewTest?.inject);
}

/** Feed server-shaped messages to the page's store (client only). */
async function inject(page: Page, msgs: unknown[]) {
  await page.evaluate((list) => {
    const probe = (window as unknown as { __agenticviewTest: { inject(m: unknown): void } }).__agenticviewTest;
    for (const m of list) probe.inject(m);
  }, msgs);
}

async function managerId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const st = (window as unknown as { __agenticviewTest: { store: { getState(): { agents: Record<string, { id: string; role: string }> } } } }).__agenticviewTest.store.getState();
    return Object.values(st.agents).find((a) => a.role === "manager")!.id;
  });
}

const iso = (s: number) => new Date(Date.now() - 600_000 + s * 1000).toISOString();

test("inbox with a multi-line question and a limit note", async ({ page }) => {
  await open(page);
  const mid = await managerId(page);
  await inject(page, [
    { type: "task.updated", task: { id: "t_shot_q", kind: "request", title: "Set up the persistence layer for accounts", description: "", status: "waiting", createdBy: "user", assigneeId: mid, projectPath: "", images: [], log: [], createdAt: iso(0) } },
    {
      type: "question.request",
      id: "q_shot",
      agentId: mid,
      taskId: "t_shot_q",
      question: "Which database should I use for accounts?\n\nOptions I found:\n- **Postgres**, already in `docker-compose.yml`\n- SQLite, simpler for local tests\n\nAfter you choose I will run:\n```\nnpm run db:migrate\nnpm test\n```",
    },
    { type: "limit.request", id: "l_shot", agentId: mid, taskId: "t_shot_q", reason: "Rate limited by the provider (429).\nThe window resets in about 20 minutes.", suggested: { provider: "codex" }, resetAt: new Date(Date.now() + 1_200_000).toISOString() },
  ]);
  // The question toast focuses its answer box, so open the Inbox from the top bar.
  await page.getByRole("button", { name: /^Inbox/ }).click();
  await expect(page.getByTestId("inbox-question-q_shot")).toBeVisible();
  await expect(page.getByTestId("inbox-question-q_shot").locator("pre.smd-code")).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "e2e/screenshots/inbox-multiline-question.png" });
  await page.keyboard.press("Escape");
});

test("timeline workflow for one request", async ({ page }) => {
  await open(page);
  const mid = await managerId(page);
  const wid = "w_shot_worker";
  await inject(page, [
    {
      type: "task.updated",
      task: {
        id: "r_shot", kind: "request", title: "Add a login page", description: "Add a login page", status: "done", createdBy: "user", assigneeId: mid, projectPath: "", images: [],
        createdAt: iso(0), startedAt: iso(2), finishedAt: iso(330),
        result: "The login page is live.\n\n- **Form** with email + password\n- Validation and tests\n- `npm test`: 42 passed",
        log: [
          { ts: iso(0), type: "user", text: "Add a login page with email and password" },
          { ts: iso(3), type: "tool_start", text: 'list_agents {}' },
          { ts: iso(4), type: "tool_start", text: 'create_agent {"name":"Pixel"}' },
          { ts: iso(20), type: "tool_start", text: 'ask_user {"question":"Should we also support Google sign-in?"}' },
        ],
      },
    },
    { type: "task.updated", task: { id: "c_shot1", kind: "work", parentId: "r_shot", title: "Build the login form", description: "", status: "failed", createdBy: mid, assigneeId: wid, projectPath: "", images: [], log: [], createdAt: iso(10), startedAt: iso(11), finishedAt: iso(70), error: "Rate limit reached (429)", tier: { provider: "claude", model: "sonnet" } } },
    { type: "task.updated", task: { id: "c_shot2", kind: "work", parentId: "r_shot", title: "Build the login form", description: "", status: "done", createdBy: mid, assigneeId: wid, projectPath: "", images: [], log: [{ ts: iso(72), type: "status", text: "Switched to Codex after a quota limit" }], createdAt: iso(71), startedAt: iso(73), finishedAt: iso(250), result: "Form done in `LoginForm.tsx` with validation.\nTests added.", tier: { provider: "codex" } } },
    { type: "task.updated", task: { id: "c_shot3", kind: "work", parentId: "r_shot", title: "Review the form", description: "", status: "done", createdBy: mid, assigneeId: mid, projectPath: "", images: [], log: [], createdAt: iso(252), startedAt: iso(253), finishedAt: iso(320), result: "Looks good." } },
  ]);
  await page.getByRole("button", { name: "Timeline" }).click();
  await expect(page.getByTestId("timeline-panel")).toBeVisible();
  await page.getByTestId("timeline-panel").getByRole("button", { name: /Add a login page/ }).click();
  await expect(page.getByRole("list", { name: "Workflow: Add a login page" })).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "e2e/screenshots/timeline-workflow.png" });
});
