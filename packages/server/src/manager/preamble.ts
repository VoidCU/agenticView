import { isTerminal, type Agent, type Task, type WorldInfo } from "@agenticview/shared";

/** Fresh, authoritative roster + open-task map injected at the top of every Manager turn. */
export function buildRosterPreamble(world: WorldInfo, agents: Agent[], tasks: Task[]): string {
  const open = tasks.filter((t) => !isTerminal(t.status));
  const runningBy = new Map<string, string>();
  for (const t of open) if (t.status === "running" || t.status === "waiting") runningBy.set(t.assigneeId, t.id);

  const lines: string[] = [`# AgenticView ${world.kind} world: ${world.name}`];
  if (world.projectPath) lines.push(`Project path: ${world.projectPath}`);
  else lines.push(`Known projects: ${world.knownProjects.map((p) => `${p.name} (${p.path})`).join(", ") || "none"}`);
  lines.push("", "## Roster");
  const workers = agents.filter((a) => a.role === "worker");
  for (const a of workers) {
    const state = runningBy.has(a.id) ? `running ${runningBy.get(a.id)}` : "idle";
    lines.push(`- ${a.id} "${a.name}" worker/${a.scope} — ${a.specialty || "generalist"} — ${a.provider ?? "default"} — ${state}`);
  }
  if (workers.length === 0) lines.push("- (no workers yet; use create_agent)");
  lines.push("", "## Open tasks");
  for (const t of open) {
    lines.push(`- ${t.id} ${t.kind} "${t.title}" (${t.status}) → ${t.assigneeId}${t.parentId ? `, parent ${t.parentId}` : ""}`);
  }
  if (open.length === 0) lines.push("- none");
  return lines.join("\n");
}
