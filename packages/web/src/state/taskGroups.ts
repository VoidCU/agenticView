import type { Task, WorldInfo } from "@agenticview/shared";

export interface TaskBoardGroup {
  id: string;
  name: string;
  path?: string;
  tasks: Task[];
  agents: Map<string, Task[]>;
}

// Windows paths may arrive with either separator and varying drive/folder casing.
function pathKey(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-z]:/i.test(normalized) || normalized.startsWith("//") ? normalized.toLowerCase() : normalized;
}

export function groupTasksByBoard(tasks: Task[], world?: WorldInfo): TaskBoardGroup[] {
  const boards = new Map<string, TaskBoardGroup>();
  const add = (id: string, name: string, path?: string) => {
    if (!boards.has(id)) boards.set(id, { id, name, path, tasks: [], agents: new Map() });
    return boards.get(id)!;
  };
  if (world?.projectPath) add(`project:${pathKey(world.projectPath)}`, world.name, world.projectPath);
  for (const project of world?.knownProjects ?? []) add(`project:${pathKey(project.path)}`, project.name, project.path);
  const byId = new Map(tasks.map(task => [task.id, task]));
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
