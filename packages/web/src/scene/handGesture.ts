/**
 * First-person hand for walk mode: a quick slap (E / click on an agent within reach) and a friendly
 * wave (H). Pure animation math, no React or three imports: the renderer (WalkHand.tsx) samples
 * handPose() every frame into a reused object and hides the hand mesh when idle.
 *
 * Camera-space coordinates: +x right, +y up, -z forward. The walk camera's near plane is 0.5, so the
 * hand lives at about 0.7 in front of the eye.
 */

export type HandGesture = "slap" | "wave";

/** Whole slap: wind-up from off-screen, strike, recover. */
export const SLAP_MS = 300;
/** The strike lands at this point of the slap (the agent's wobble starts here). */
export const SLAP_HIT_MS = 130;
/** Whole wave: raise, three waggles, lower. */
export const WAVE_MS = 900;

export interface HandPose {
  visible: boolean;
  x: number;
  y: number;
  z: number;
  /** Euler angles (radians), camera space. */
  rx: number;
  ry: number;
  rz: number;
  /** Uniform scale (impact pulse on the slap's hit frame). */
  scale: number;
}

/** The one active gesture (module state, reused; no allocation per trigger). `pin` (tests and screenshots only) freezes the gesture at that many ms. */
export const handState: { gesture: HandGesture | null; start: number; pin: number | null } = { gesture: null, start: -Infinity, pin: null };

/** Start a gesture now (restarts one already playing). */
export function triggerHand(gesture: HandGesture, now: number): void {
  handState.gesture = gesture;
  handState.start = now;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** Rest pose (off-screen, lower right), also the start and end of every gesture. */
const REST = { x: 0.42, y: -0.4, z: -0.72 };

/**
 * Sample the hand at `elapsedMs` into `out` (returned). Outside the gesture the hand is invisible.
 */
export function handPose(gesture: HandGesture | null, elapsedMs: number, out: HandPose): HandPose {
  out.visible = false;
  out.scale = 1;
  out.rx = 0;
  out.ry = 0;
  out.rz = 0;
  out.x = REST.x;
  out.y = REST.y;
  out.z = REST.z;
  if (!gesture || !(elapsedMs >= 0)) return out;
  if (gesture === "slap") {
    if (elapsedMs >= SLAP_MS) return out;
    out.visible = true;
    // Strike: rest -> centre (palm first, swinging right to left); then recover back out.
    const HIT = { x: 0.03, y: -0.08, z: -0.74 };
    if (elapsedMs <= SLAP_HIT_MS) {
      const k = smooth(clamp01(elapsedMs / SLAP_HIT_MS));
      out.x = lerp(REST.x, HIT.x, k);
      out.y = lerp(REST.y, HIT.y, k);
      out.z = lerp(REST.z, HIT.z, k);
      out.rz = lerp(-0.9, 0.25, k); // tilted back while winding up, square on at impact
      out.ry = lerp(-0.5, 0.15, k);
    } else {
      const k = smooth(clamp01((elapsedMs - SLAP_HIT_MS) / (SLAP_MS - SLAP_HIT_MS)));
      // Follow-through a little to the left, then drop away.
      out.x = lerp(HIT.x - 0.08 * Math.sin(k * Math.PI), REST.x, k);
      out.y = lerp(HIT.y, REST.y, k);
      out.z = HIT.z;
      out.rz = lerp(0.25, -0.6, k);
      out.ry = 0.15;
    }
    // Impact pulse: a quick swell centred on the hit frame.
    const d = (elapsedMs - SLAP_HIT_MS) / 45;
    out.scale = 1 + 0.22 * Math.exp(-d * d);
    return out;
  }
  if (elapsedMs >= WAVE_MS) return out;
  out.visible = true;
  // Raise (0-20%), waggle (20-80%), lower (80-100%).
  const k = elapsedMs / WAVE_MS;
  const up = k < 0.2 ? smooth(k / 0.2) : k > 0.8 ? smooth((1 - k) / 0.2) : 1;
  out.x = lerp(REST.x, 0.2, up);
  out.y = lerp(REST.y, -0.08, up);
  out.z = -0.74;
  // Palm to the viewer's front, fingers up; three side-to-side waggles about the wrist.
  out.rz = Math.sin(clamp01((k - 0.15) / 0.7) * Math.PI * 6) * 0.42 * up;
  out.rx = -0.15 * up;
  return out;
}
