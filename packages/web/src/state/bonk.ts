/**
 * Bonk: a playful tap on an agent robot (walk mode E / click at close range, overview Alt+click).
 * Purely cosmetic and local: a squash-and-stretch wobble plus a short speech bubble with a
 * hardcoded line. Never calls a model or the server.
 */
import { agentStatus, useStore } from "./store";

export const BONK_LINES = ["Hey!", "I'm working!", "Ouch, boss.", "Careful!", "Back to it…"] as const;
/** Lines for an agent that is busy on a task. */
export const BONK_BUSY_LINES = ["Busy!", "Can't talk — shipping.", "Later, boss."] as const;
/** Per-agent cooldown between bonks. */
export const BONK_COOLDOWN_MS = 2000;
/** Length of the wobble animation. */
export const BONK_ANIM_MS = 650;
/** How long the bubble stays up. */
export const BONK_BUBBLE_MS = 1800;
/** Walk mode: the agent must be this close (world units, horizontal) to be bonked. */
export const BONK_RANGE = 2;
/** An idle agent looks at whoever bonked it for this long; a busy one only glances during the wobble. */
export const BONK_LOOK_MS = 1600;

/** Last playful interaction with an agent: a slap (bonk) or a greeting. */
export interface BonkState { at: number; busy: boolean; kind: "bonk" | "greet" }

/** agentId -> last bonk. Read every frame by robots, so a plain Map (no store churn); entries are reused. */
const lastBonk = new Map<string, BonkState>();

/** Time of the agent's last bonk, or -Infinity. Allocation-free; safe inside useFrame. */
export function bonkedAt(agentId: string): number {
  return lastBonk.get(agentId)?.at ?? -Infinity;
}

/** The agent's last bonk (the same object each time), or undefined. Allocation-free. */
export function bonkState(agentId: string): BonkState | undefined {
  return lastBonk.get(agentId);
}

/** True while the robot should turn to face whoever bonked it. */
export function bonkLooking(b: BonkState | undefined, now: number): boolean {
  if (!b) return false;
  const dt = now - b.at;
  return dt >= 0 && dt < (b.busy ? BONK_ANIM_MS : BONK_LOOK_MS);
}

/** Working states (thinking / editing) get the busy lines and turn straight back to the desk. */
export function isBusyAgent(agentId: string): boolean {
  const s = useStore.getState();
  const agent = s.agents[agentId];
  if (!agent) return false;
  const st = agentStatus(agent, Object.values(s.tasks), s.permissions, s.questions, s.feed[agentId] ?? []);
  return st === "thinking" || st === "editing";
}

/**
 * Bonk an agent. Returns the line it says, or undefined while on cooldown.
 * `rand` is injectable for tests.
 */
export function bonk(agentId: string, now = Date.now(), rand: () => number = Math.random, busy = isBusyAgent(agentId)): string | undefined {
  if (now - bonkedAt(agentId) < BONK_COOLDOWN_MS) return undefined;
  const prev = lastBonk.get(agentId);
  if (prev) { prev.at = now; prev.busy = busy; prev.kind = "bonk"; } else lastBonk.set(agentId, { at: now, busy, kind: "bonk" });
  const lines: readonly string[] = busy ? BONK_BUSY_LINES : BONK_LINES;
  const line = lines[Math.min(lines.length - 1, Math.floor(rand() * lines.length))]!;
  useStore.setState((s) => ({ bubbles: { ...s.bubbles, [agentId]: { text: line, until: now + BONK_BUBBLE_MS, bonk: true } } }));
  return line;
}

/**
 * Squash-and-stretch factor for the wobble: 0 outside the animation, else a damped oscillation in
 * [-1, 1]. Robots scale y by (1 - 0.22 f) and x/z by (1 + 0.14 f).
 */
export function bonkWobble(elapsedMs: number): number {
  if (!(elapsedMs >= 0) || elapsedMs >= BONK_ANIM_MS) return 0;
  const k = elapsedMs / BONK_ANIM_MS;
  return Math.sin(k * Math.PI * 3) * (1 - k) * (1 - k);
}


// ---- Greeting (walk mode H): a friendly wave, the agent nods and says hi ----

/** Replies from an idle agent. */
export const GREET_LINES = ["Hi!", "Hey boss!", "All good here."] as const;
/** Replies from an agent busy on a task: short, polite. */
export const GREET_BUSY_LINES = ["Hi! Busy, sorry.", "Hey — deep in a task.", "Hi boss, shipping!"] as const;
/** Walk mode: say hi from this close (a little farther than a slap). */
export const GREET_RANGE = 3;
/** Length of the agent's nod. */
export const GREET_NOD_MS = 700;

/**
 * Greet an agent. Shares the 2 s cooldown with bonk. Returns the reply, or undefined while on cooldown.
 * `rand` is injectable for tests.
 */
export function greet(agentId: string, now = Date.now(), rand: () => number = Math.random, busy = isBusyAgent(agentId)): string | undefined {
  if (now - bonkedAt(agentId) < BONK_COOLDOWN_MS) return undefined;
  const prev = lastBonk.get(agentId);
  if (prev) { prev.at = now; prev.busy = busy; prev.kind = "greet"; } else lastBonk.set(agentId, { at: now, busy, kind: "greet" });
  const lines: readonly string[] = busy ? GREET_BUSY_LINES : GREET_LINES;
  const line = lines[Math.min(lines.length - 1, Math.floor(rand() * lines.length))]!;
  useStore.setState((s) => ({ bubbles: { ...s.bubbles, [agentId]: { text: line, until: now + BONK_BUBBLE_MS, bonk: true, greet: true } } }));
  return line;
}

/** Nod for a greeting: 0 outside the animation, else a forward head dip in [0, 1] (two small nods). */
export function greetNod(elapsedMs: number): number {
  if (!(elapsedMs >= 0) || elapsedMs >= GREET_NOD_MS) return 0;
  const k = elapsedMs / GREET_NOD_MS;
  const s = Math.sin(k * Math.PI * 2);
  return s * s * (1 - k);
}

/** Squash-and-stretch for the agent's last interaction: the wobble after a slap, none after a greeting. */
export function interactionWobble(b: BonkState | undefined, now: number): number {
  return b && b.kind === "bonk" ? bonkWobble(now - b.at) : 0;
}

/** Nod for the agent's last interaction (greetings only). */
export function interactionNod(b: BonkState | undefined, now: number): number {
  return b && b.kind === "greet" ? greetNod(now - b.at) : 0;
}

/** Test helper. */
export function resetBonks() {
  lastBonk.clear();
}
