/**
 * Challenging an agent to rock-paper-scissors (walk-mode G, the agent menu, a click on a lounging
 * robot, the scoreboard). An agent that is idle or on a break pauses and plays (scene/engage.ts);
 * one that is busy on a task politely declines with a bubble instead of opening the popup.
 */
import type { GameRoundResult, Move, Task } from "@agenticview/shared";
import { useStore } from "./store";

export const RPS_BUSY_LINE = "After I ship this!";
/** How long an RPS emote bubble stays up. */
export const RPS_BUBBLE_MS = 2200;

/** True while the agent is actively running a task (running, or waiting on a permission/answer mid-run). */
export function agentOnTask(tasks: Record<string, Task> | Task[], agentId: string): boolean {
  const list = Array.isArray(tasks) ? tasks : Object.values(tasks);
  return list.some((t) => t.assigneeId === agentId && (t.status === "running" || t.status === "waiting"));
}

/** Show a short speech bubble over the robot (flagged so it also shows in walk mode). */
export function sayRps(agentId: string, text: string, now = Date.now()): void {
  useStore.setState((s) => ({ bubbles: { ...s.bubbles, [agentId]: { text, until: now + RPS_BUBBLE_MS, bonk: true } } }));
}

/**
 * The user challenged `agentId`. Returns true when the match popup should open; false when the
 * agent is busy on a task (it says so in a bubble instead).
 */
export function challengeRps(agentId: string, now = Date.now()): boolean {
  const s = useStore.getState();
  if (!s.agents[agentId]) return false;
  if (agentOnTask(s.tasks, agentId)) {
    sayRps(agentId, RPS_BUSY_LINE, now);
    return false;
  }
  return true;
}

const MOVE_LINE: Record<Move, string> = { rock: "Rock!", paper: "Paper!", scissors: "Scissors!" };

/** The agent's emote when its move is thrown. */
export function rpsThrowLine(r: Pick<GameRoundResult, "agentMove">): string {
  return MOVE_LINE[r.agentMove];
}

/** The agent's emote once the round is revealed (and, after the last round, the rematch offer). */
export function rpsResultLine(r: Pick<GameRoundResult, "winner" | "done" | "score">): string {
  if (r.done) return r.score.agent > r.score.you ? "GG! Rematch?" : r.score.you > r.score.agent ? "No way! Rematch?" : "Rematch?";
  if (r.winner === "agent") return "Gotcha!";
  if (r.winner === "you") return "No way!";
  return "Again!";
}
