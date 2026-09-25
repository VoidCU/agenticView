import { planOffice, type Agent, type Placement, type Task, type WorldInfo } from "@agenticview/shared";

export interface TaskBoardGroup {
  id: string;
  name: string;
  path?: string;
  tasks: Task[];
  agents: Map<string, Task[]>;
}

// Windows paths may arrive with either separator and varying drive/folder casing.
export function pathKey(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-z]:/i.test(normalized) || normalized.startsWith("//") ? normalized.toLowerCase() : normalized;
}

export function isTaskInProject(task: Task, tasksById: Map<string, Task>, world?: WorldInfo): boolean {
  const currentPath = world?.projectPath;
  if (!currentPath) return true;
  let root = task;
  const seen = new Set([root.id]);
  while (root.parentId && tasksById.has(root.parentId) && !seen.has(root.parentId)) {
    root = tasksById.get(root.parentId)!;
    seen.add(root.id);
  }
  const taskPath = task.projectPath || root.projectPath;
  if (!taskPath) return true;
  return pathKey(taskPath) === pathKey(currentPath);
}

export function filterProjectTasks(tasks: Task[], world?: WorldInfo): Task[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return tasks.filter((t) => isTaskInProject(t, byId, world));
}

export function getAgentRoomId(agent: Agent | undefined, placements: Record<string, Placement>): string | undefined {
  if (!agent) return undefined;
  if (agent.role === "manager") return "office";
  return placements[agent.id]?.space ?? agent.placement?.space;
}

export function filterTasksByRoom(
  tasks: Task[],
  roomId: string,
  agents: Record<string, Agent>,
  placements: Record<string, Placement>,
): Task[] {
  if (!roomId) return tasks;
  return tasks.filter((t) => {
    const agent = agents[t.assigneeId];
    return getAgentRoomId(agent, placements) === roomId;
  });
}

export function groupTasksByAgent(tasks: Task[], agents: Record<string, Agent>): [string, Task[]][] {
  const map = new Map<string, Task[]>();
  const sorted = [...tasks].sort(
    (a, b) => (b.finishedAt ?? b.createdAt).localeCompare(a.finishedAt ?? a.createdAt) || a.id.localeCompare(b.id),
  );
  for (const t of sorted) {
    const list = map.get(t.assigneeId) ?? [];
    list.push(t);
    map.set(t.assigneeId, list);
  }
  return [...map.entries()].sort(([a], [b]) => {
    const nameA = agents[a]?.name ?? (a ? `Unknown agent (${a})` : "Unassigned");
    const nameB = agents[b]?.name ?? (b ? `Unknown agent (${b})` : "Unassigned");
    return nameA.localeCompare(nameB);
  });
}

export function groupTasksByBoard(tasks: Task[], world?: WorldInfo): TaskBoardGroup[] {
  const boards = new Map<string, TaskBoardGroup>();
  const add = (id: string, name: string, path?: string) => {
    if (!boards.has(id)) boards.set(id, { id, name, path, tasks: [], agents: new Map() });
    return boards.get(id)!;
  };
  if (world?.projectPath) add(`project:${pathKey(world.projectPath)}`, world.name, world.projectPath);
  for (const project of world?.knownProjects ?? []) add(`project:${pathKey(project.path)}`, project.name, project.path);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  for (const task of [...tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))) {
    let root = task;
    const seen = new Set([root.id]);
    while (root.parentId && byId.has(root.parentId) && !seen.has(root.parentId)) {
      root = byId.get(root.parentId)!;
      seen.add(root.id);
    }
    const path = task.projectPath || root.projectPath || world?.projectPath;
    const board = path
      ? add(`project:${pathKey(path)}`, path.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() || path, path)
      : add(`request:${root.id}`, root.title);
    board.tasks.push(task);
    const assigned = board.agents.get(task.assigneeId) ?? [];
    assigned.push(task);
    board.agents.set(task.assigneeId, assigned);
  }
  return [...boards.values()];
}
