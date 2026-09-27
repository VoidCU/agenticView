/**
 * Screenshot helper: pins a realistic spread of notes on Pod A's board and the Manager board by
 * injecting agents and tasks straight into the page's store (window.__agenticviewTest.inject), so the
 * walk-mode boards and their popups show every column without driving real runs.
 */
import type { Page } from "@playwright/test";

export async function seedPinnedBoards(page: Page): Promise<{ requestId: string; requestTitle: string }> {
  return page.evaluate(() => {
    type Agent = { id: string; name: string; role: string; appearance: Record<string, unknown> } & Record<string, unknown>;
    type Probe = { store: { getState(): { agents: Record<string, Agent> } }; inject(msg: unknown): void };
    const t = (window as unknown as { __agenticviewTest: Probe }).__agenticviewTest;
    const atlas = Object.values(t.store.getState().agents).find((a) => a.role === "manager")!;
    const worker = (id: string, name: string, color: string, seat: number): Agent => ({
      ...atlas, id, name, role: "worker", specialty: "Frontend", lounging: false,
      appearance: { ...atlas.appearance, color, accent: color, eyes: "round" },
      placement: { space: "pod-a", seat },
    });
    const pixel = worker("w_e2e_pin_1", "Pixel", "#5b8cff", 0);
    const byte = worker("w_e2e_pin_2", "Byte", "#3dbb74", 1);
    for (const agent of [pixel, byte]) t.inject({ type: "agent.updated", agent });
    const now = Date.now();
    let n = 0;
    const task = (title: string, status: string, assigneeId: string, extra: Record<string, unknown> = {}) => {
      n++;
      const createdAt = new Date(now - n * 90_000).toISOString();
      const done = status === "done" || status === "failed";
      t.inject({ type: "task.updated", task: {
        id: `t_e2e_pin_${n}`, kind: "work", title, description: title, status, createdBy: atlas.id, assigneeId,
        projectPath: "", images: [], log: [], createdAt, startedAt: createdAt,
        ...(done ? { finishedAt: new Date(now - n * 30_000).toISOString() } : {}),
        ...(status === "failed" ? { error: "Tests failed" } : {}),
        ...extra,
      } });
      return `t_e2e_pin_${n}`;
    };
    const requestTitle = "Build the sign-in flow";
    const requestId = task(requestTitle, "running", atlas.id, { kind: "request", createdBy: "user", log: [{ ts: new Date(now - 200_000).toISOString(), type: "user", text: requestTitle }] });
    task("Add password reset", "waiting", atlas.id, { kind: "request", createdBy: "user" });
    task("Write release notes", "done", atlas.id, { kind: "request", createdBy: "user" });
    task("Fix flaky CI job", "failed", atlas.id, { kind: "request", createdBy: "user" });
    task("Draft the landing page", "queued", atlas.id, { kind: "request", createdBy: "user" });
    task("Sign-in form with validation", "running", pixel.id, { parentId: requestId });
    task("Session cookie middleware", "running", byte.id, { parentId: requestId });
    task("Password strength meter", "queued", pixel.id, { parentId: requestId });
    task("OAuth callback route", "queued", byte.id);
    task("Remember-me checkbox", "queued", pixel.id);
    task("Which SSO provider to support?", "waiting", byte.id);
    task("Login page layout", "done", pixel.id, { parentId: requestId });
    task("Rate-limit sign-in attempts", "done", byte.id);
    task("Error toast for bad password", "done", pixel.id);
    task("Legacy auth migration", "failed", byte.id);
    return { requestId, requestTitle };
  });
}

/** Stand `back` units in front of a room's whiteboard, looking at its centre (face fully in view). */
export async function faceBoard(page: Page, spaceId: string, back = 1.9, side = 0): Promise<void> {
  await page.evaluate(([r, b, s]) => {
    type Win = {
      __agenticviewTest: { boardPose(id: string): { yaw: number; face: [number, number, number] } | undefined };
      __teleportWalk(x: number, z: number, yaw?: number, pitch?: number): void;
    };
    const w = window as unknown as Win;
    const pose = w.__agenticviewTest.boardPose(r)!;
    const nx = Math.sin(pose.yaw), nz = Math.cos(pose.yaw);
    const x = pose.face[0] + nx * b + nz * s;
    const z = pose.face[2] + nz * b - nx * s;
    // Eye height 1.7, board centre at face[1]: tilt the view down onto it.
    const pitch = Math.atan2(pose.face[1] - 1.7, Math.hypot(b, s));
    w.__teleportWalk(x, z, Math.atan2(-(pose.face[0] - x), -(pose.face[2] - z)), pitch);
  }, [spaceId, back, side] as const);
}
