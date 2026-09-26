/**
 * Lounge-break scheduling for idle workers.
 *
 * Pure functions (breakSeat, breakDuration, updateBreaks) are exported for unit tests.
 * The React hook (useLoungeBreaks) wraps them for use in the scene.
 */

import { useEffect, useRef, useState } from "react";
import type { Agent, Task } from "@agenticview/shared";

/** A worker currently relaxing in the lounge. */
export interface LoungeBreak {
  spaceId: "lounge";
  seat: number;
  /** Wall-clock ms when this break ends. */
  until: number;
  /** The task id that triggered this break (used as part of the seed). */
  taskId: string;
}

/** FNV-1a 32-bit – fast deterministic hash with no imports. */
function fnv32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

export const BREAK_MIN_MS = 30_000;
export const BREAK_MAX_MS = 90_000;

/** Deterministic lounge seat for an agent/task pair (0–3). */
export function breakSeat(agentId: string, taskId: string): number {
  return fnv32(agentId + "\x00seat\x00" + taskId) % 4;
}

/** Deterministic break duration in ms (30 – 90 s). */
export function breakDuration(agentId: string, taskId: string): number {
  return BREAK_MIN_MS + (fnv32(agentId + "\x00dur\x00" + taskId) % (BREAK_MAX_MS - BREAK_MIN_MS + 1));
}

/** Read the revive phase added by Nova (graceful: field may not exist yet). */
export function agentRevivePhase(agent: Agent): "fainted" | "reviving" | "done" | undefined {
  return (agent as Agent & { revive?: { phase: "fainted" | "reviving" | "done" } }).revive?.phase;
}

/**
 * Mutates `breaks` in place and updates `prevStatuses` for the next diff.
 * Injectable `now` makes this fully unit-testable.
 *
 * Rules:
 * - Expired breaks are removed.
 * - Breaks are cancelled when the agent gets a new active task or enters faint state.
 * - When loungeEnabled and a task transitions to terminal (done/failed/cancelled),
 *   the worker gets a break for a deterministic 30–90 s duration.
 */
export function updateBreaks(
  breaks: Map<string, LoungeBreak>,
  agents: Record<string, Agent>,
  tasks: Record<string, Task>,
  prevStatuses: Map<string, Task["status"]>,
  loungeEnabled: boolean,
  now: number,
): void {
  // Purge expired or superseded breaks
  for (const [id, b] of breaks) {
    if (b.until <= now) { breaks.delete(id); continue; }
    const agent = agents[id];
    if (!agent) { breaks.delete(id); continue; }
    const phase = agentRevivePhase(agent);
    if (phase === "fainted" || phase === "reviving") { breaks.delete(id); continue; }
    const hasActive = Object.values(tasks).some(
      (t) => t.assigneeId === id && (t.status === "running" || t.status === "assigned" || t.status === "waiting"),
    );
    if (hasActive) breaks.delete(id);
  }

  if (loungeEnabled) {
    for (const t of Object.values(tasks)) {
      if (!t.assigneeId) continue;
      const prev = prevStatuses.get(t.id);
      const terminal = t.status === "done" || t.status === "failed" || t.status === "cancelled";
      const prevTerminal = prev === "done" || prev === "failed" || prev === "cancelled";
      // Only trigger on the transition into terminal, not on subsequent renders
      if (!terminal || prevTerminal || prev === undefined) continue;

      const agentId = t.assigneeId;
      const agent = agents[agentId];
      if (!agent || agent.role !== "worker") continue;
      if (breaks.has(agentId)) continue;

      const phase = agentRevivePhase(agent);
      if (phase === "fainted" || phase === "reviving") continue;

      const hasActive = Object.values(tasks).some(
        (t2) => t2.assigneeId === agentId && (t2.status === "running" || t2.status === "assigned" || t2.status === "waiting"),
      );
      if (hasActive) continue;

      // Pick a seat; avoid conflicts with agents already on break
      const preferred = breakSeat(agentId, t.id);
      const taken = new Set([...breaks.values()].map((b) => b.seat));
      let seat = preferred;
      for (let i = 1; taken.has(seat) && i < 4; i++) seat = (preferred + i) % 4;

      breaks.set(agentId, { spaceId: "lounge", seat, until: now + breakDuration(agentId, t.id), taskId: t.id });
    }
  }

  // Update previous statuses for next call
  prevStatuses.clear();
  for (const t of Object.values(tasks)) prevStatuses.set(t.id, t.status);
}

/** React hook: returns the current map of agentId → LoungeBreak. */
export function useLoungeBreaks(
  agents: Record<string, Agent>,
  tasks: Record<string, Task>,
  loungeEnabled: boolean,
): Map<string, LoungeBreak> {
  const breaksRef = useRef(new Map<string, LoungeBreak>());
  const prevStatuses = useRef(new Map<string, Task["status"]>());
  const [snapshot, setSnapshot] = useState(() => new Map<string, LoungeBreak>());

  // Re-evaluate whenever agents/tasks/settings change
  useEffect(() => {
    updateBreaks(breaksRef.current, agents, tasks, prevStatuses.current, loungeEnabled, Date.now());
    setSnapshot(new Map(breaksRef.current));
  // prevStatuses is a stable ref, not a reactive dep
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, tasks, loungeEnabled]);

  // Timer: expire breaks that have run their duration
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [k, b] of breaksRef.current) {
        if (b.until <= now) { breaksRef.current.delete(k); changed = true; }
      }
      if (changed) setSnapshot(new Map(breaksRef.current));
    }, 5000);
    return () => clearInterval(id);
  }, []);

  return snapshot;
}
