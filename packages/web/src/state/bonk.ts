/**
 * Bonk: a playful tap on an agent robot (walk mode E / click at close range, overview Alt+click).
 * Purely cosmetic and local: a squash-and-stretch wobble plus a short speech bubble with a
 * hardcoded line. Never calls a model or the server.
 */
import { useStore } from "./store";

export const BONK_LINES = ["Hey!", "I'm working!", "Ouch, boss.", "Careful!", "Back to it…"] as const;
/** Per-agent cooldown between bonks. */
export const BONK_COOLDOWN_MS = 2000;
/** Length of the wobble animation. */
export const BONK_ANIM_MS = 650;
/** How long the bubble stays up. */
export const BONK_BUBBLE_MS = 1800;
/** Walk mode: the agent must be this close (world units, horizontal) to be bonked. */
export const BONK_RANGE = 2;

/** agentId -> Date.now() of the last bonk. Read every frame by robots, so a plain Map (no store churn). */
const lastBonk = new Map<string, number>();

/** Time of the agent's last bonk, or -Infinity. Allocation-free; safe inside useFrame. */
export function bonkedAt(agentId: string): number {
  return lastBonk.get(agentId) ?? -Infinity;
}

/**
 * Bonk an agent. Returns the line it says, or undefined while on cooldown.
 * `rand` is injectable for tests.
 */
export function bonk(agentId: string, now = Date.now(), rand: () => number = Math.random): string | undefined {
  if (now - bonkedAt(agentId) < BONK_COOLDOWN_MS) return undefined;
  lastBonk.set(agentId, now);
  const line = BONK_LINES[Math.min(BONK_LINES.length - 1, Math.floor(rand() * BONK_LINES.length))]!;
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

/** Test helper. */
export function resetBonks() {
  lastBonk.clear();
}
