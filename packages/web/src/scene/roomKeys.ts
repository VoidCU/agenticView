import type { Space } from "@agenticview/shared";

/**
 * Ordered list of space IDs for 1–9 keyboard shortcut.
 * Order: office first, then pods (by ring then id), then meeting, then lounge.
 */
export function viewOrder(spaces: Space[]): string[] {
  const kindRank = (kind: Space["kind"]): number => {
    switch (kind) {
      case "office":
        return 0;
      case "pod":
        return 1;
      case "meeting":
        return 2;
      case "lounge":
        return 3;
      default:
        return 4;
    }
  };
  return [...spaces]
    .sort((a, b) => {
      const kr = kindRank(a.kind) - kindRank(b.kind);
      if (kr !== 0) return kr;
      if (a.ring !== b.ring) return a.ring - b.ring;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .map((s) => s.id);
}

/**
 * Returns the space ID for a digit key "1"–"9", or undefined if out of range.
 * @param key - The key pressed (e.g. "1", "5", "9").
 * @param spaces - All spaces in the layout.
 */
export function keyToRoom(key: string, spaces: Space[]): string | undefined {
  const n = parseInt(key, 10);
  if (Number.isNaN(n) || n < 1 || n > 9) return undefined;
  const order = viewOrder(spaces);
  return order[n - 1];
}
