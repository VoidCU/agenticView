export type IdPrefix = "w" | "m" | "t" | "r" | "u" | "lim" | "gm";

/** Isomorphic id generator: `<prefix>_<8 hex>` using Web Crypto (Node 22 and browsers). */
export function newId(prefix: IdPrefix): string {
  const bytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(bytes);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `${prefix}_${hex}`;
}
