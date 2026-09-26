import { z } from "zod";
import { isTerminal, planOffice, type Agent, type BrainstormParticipant, type Placement, type Task } from "@agenticview/shared";
import type { BridgeTool } from "../runtimes/types.js";
import { resolveAssignmentTarget, type ManagerToolContext } from "./tools.js";
import { moveWorker } from "./officeTools.js";

interface Participant { agent: Agent; task: Task; previous: Placement }
interface Session {
  participants: Participant[];
  skipped: { name: string; reason: string }[];
  completion: Promise<void>;
  error?: string;
}

function toParticipants(participants: Participant[], tasks: Map<string, Task>): BrainstormParticipant[] {
  return participants.map((p) => {
    const t = tasks.get(p.task.id) ?? p.task;
    return { agentId: p.agent.id, name: p.agent.name, answer: t.result ?? undefined, done: isTerminal(t.status) };
  });
}

/** Same-topic calls in a manager turn reuse the run, including after a bounded wait. */
export function brainstormTool(ctx: ManagerToolContext): BridgeTool {
  const sessions = new Map<string, Promise<Session>>();

  function emitUpdate(topic: string, session: Session, taskMap: Map<string, Task>, complete: boolean): void {
    if (!ctx.emitBrainstorm) return;
    ctx.emitBrainstorm({
      type: "brainstorm.updated",
      managerId: ctx.managerId,
      requestTaskId: ctx.requestTask.id,
      topic,
      participants: toParticipants(session.participants, taskMap),
      skipped: session.skipped.map(s => ({ agentId: "", name: s.name, reason: s.reason })),
      complete,
      error: session.error,
    });
  }

  async function begin(topic: string, refs: string[]): Promise<Session> {
    const agents = await ctx.registry.list();
    const tasks = await ctx.tasks.list();
    const plan = planOffice(agents);
    const session: Session = { participants: [], skipped: [], completion: Promise.resolve() };
    const workers = agents.filter(a => a.role === "worker");
    for (const ref of refs) {
      if (!workers.some(a => a.id === ref || a.name.toLowerCase() === ref.trim().toLowerCase())) {
        session.skipped.push({ name: ref, reason: "unknown worker" });
      }
    }
    for (const agent of workers) {
      const busy = tasks.some(t => t.assigneeId === agent.id && !isTerminal(t.status));
      if (busy) {
        session.skipped.push({ name: agent.name, reason: "busy" });
        continue;
      }
      const target = resolveAssignmentTarget(ctx, agent, ctx.requestTask.projectPath || undefined);
      const problem = !target.ok ? target.error : await ctx.checkProvider(agent) ?? await ctx.sessionConflict?.(agent);
      if (problem || !target.ok) {
        session.skipped.push({ name: agent.name, reason: problem || "no target project" });
        continue;
      }
      const previous = plan.placements[agent.id];
      if (!previous) {
        session.skipped.push({ name: agent.name, reason: "no office seat" });
        continue;
      }
      const task = await ctx.tasks.create({
        kind: "work", title: `Brainstorm: ${topic}`,
        description: `Give your expert view on ${topic} from your specialty in 5-10 bullet points; do not edit files or run commands.`,
        createdBy: ctx.managerId, assigneeId: agent.id, parentId: ctx.requestTask.id,
        projectPath: target.projectPath, readOnly: true,
      });
      session.participants.push({ agent, task, previous });
    }
    // Pin before anyone moves so returning to an auto-assigned seat does not displace a peer.
    for (const a of await ctx.registry.pinPlacements()) ctx.emitAgent(a);
    // Emit initial started event.
    const initMap = new Map(session.participants.map(p => [p.task.id, p.task]));
    emitUpdate(topic, session, initMap, false);
    session.completion = conduct(topic, session).catch(async e => {
      session.error = (e as Error).message;
      for (const p of session.participants) await ctx.cancelTask?.(p.task.id);
    });
    return session;
  }

  async function conduct(topic: string, session: Session): Promise<void> {
    const pending = [...session.participants];
    const finishedAgents = new Set<string>();
    while (pending.length) {
      const parent = await ctx.tasks.get(ctx.requestTask.id);
      if (parent && isTerminal(parent.status)) {
        for (const p of pending) {
          const t = await ctx.tasks.get(p.task.id);
          if (t && !isTerminal(t.status)) await ctx.tasks.transition(t.id, "cancelled");
        }
        return;
      }
      const agents = await ctx.registry.list();
      const plan = planOffice(agents);
      const meeting = plan.spaces.find(s => s.id === "meeting")!;
      const pendingIds = new Set(pending.map(p => p.agent.id));
      const occupied = agents.filter(a => !pendingIds.has(a.id) && !finishedAgents.has(a.id) && plan.placements[a.id]?.space === meeting.id).length;
      const capacity = meeting.seats - occupied;
      if (capacity <= 0) {
        for (const p of pending) {
          session.skipped.push({ name: p.agent.name, reason: "Meeting Room is full" });
          await ctx.tasks.transition(p.task.id, "cancelled");
        }
        return;
      }
      // Workers already in the meeting room must join this batch first.
      pending.sort((a, b) => Number(plan.placements[b.agent.id]?.space === "meeting") - Number(plan.placements[a.agent.id]?.space === "meeting"));
      const batch = pending.splice(0, capacity);
      const moved: Participant[] = [];
      try {
        for (const p of batch) {
          const current = await ctx.registry.list();
          const seats = planOffice(current).placements;
          const taken = new Set(current.filter(a => a.id !== p.agent.id && seats[a.id]?.space === "meeting").map(a => seats[a.id]!.seat));
          const free = Array.from({ length: meeting.seats }, (_, i) => i).find(i => !taken.has(i));
          // Completed participants may lend their meeting desk to a later batch; the return swap restores them.
          const lender = current.find(a => finishedAgents.has(a.id) && seats[a.id]?.space === "meeting");
          const out = await moveWorker(ctx, p.agent.id, "meeting", free ?? (lender && seats[lender.id]!.seat));
          if (out.startsWith("ERROR:")) throw new Error(out);
          moved.push(p);
        }
        for (const p of batch) {
          const t = await ctx.tasks.get(p.task.id);
          if (t && !isTerminal(t.status)) ctx.startTask(t.id);
        }
        await Promise.all(batch.map(p => ctx.awaitTask(p.task.id)));
        for (const p of batch) finishedAgents.add(p.agent.id);
        // Emit progress after each batch completes.
        const allTasks = await ctx.tasks.list();
        const taskMap = new Map(allTasks.map(t => [t.id, t]));
        emitUpdate(topic, session, taskMap, pending.length === 0);
      } finally {
        for (const p of moved) {
          if (await ctx.registry.get(p.agent.id)) await moveWorker(ctx, p.agent.id, p.previous.space, p.previous.seat);
        }
      }
    }
  }

  return {
    name: "brainstorm",
    description: "Collect every idle worker's expert view, plus named participants (busy workers are skipped). Workers meet in batches if needed, then return to their seats. Repeat the same topic to continue a bounded wait; do not finish your request while stillRunning is nonempty.",
    schema: {
      topic: z.string().trim().min(1).max(2000),
      participants: z.array(z.string().trim().min(1)).optional(),
      maxWaitSeconds: z.number().int().min(1).max(30).optional().describe("Wait budget per call, default 20 seconds; repeat the same topic to continue"),
    },
    handler: async args => {
      const topic = z.string().trim().min(1).max(2000).parse(args.topic);
      let entry = sessions.get(topic);
      if (!entry) {
        entry = begin(topic, (args.participants as string[] | undefined) ?? []);
        sessions.set(topic, entry);
      }
      const session = await entry;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const seconds = z.number().int().min(1).max(30).parse(args.maxWaitSeconds ?? 20);
        const complete = await Promise.race([
          session.completion.then(() => true),
          new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), seconds * 1000); }),
        ]);
        const current = await Promise.all(session.participants.map(async p => ({ ...p, task: await ctx.tasks.get(p.task.id) ?? p.task })));
        return JSON.stringify({
          topic, complete, skipped: session.skipped, error: session.error,
          answers: current.filter(p => isTerminal(p.task.status)).map(p => ({
            name: p.agent.name, specialty: p.agent.specialty, taskId: p.task.id,
            status: p.task.status, answer: p.task.result, error: p.task.error,
          })),
          stillRunning: current.filter(p => !isTerminal(p.task.status)).map(p => ({ id: p.task.id, name: p.agent.name, status: p.task.status })),
          ...(!complete ? { message: "Call brainstorm again with the same topic to continue waiting and collect the restored-seat summary." } : {}),
        });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
