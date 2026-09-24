/** Cosmetic unlocks per level. Levels never change what an agent can do. */
export interface LevelAccents {
  /** Lv 2+: a soft glowing halo ring under the body. */
  glowRing: boolean;
  /** Lv 3+: a second antenna. */
  secondAntenna: boolean;
  /** Lv 5+: a crown torus. */
  crown: boolean;
}

export function levelAccents(level: number): LevelAccents {
  return { glowRing: level >= 2, secondAntenna: level >= 3, crown: level >= 5 };
}
