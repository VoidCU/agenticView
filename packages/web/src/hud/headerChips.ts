import type { Provider, ProviderStatus } from "@agenticview/shared";

/** Chips shown in the header before the rest collapse into "+N more". */
export const MAX_HEADER_CHIPS = 4;

/**
 * Split provider statuses for the header: sorted by the user's provider order (unlisted ones keep
 * their server order, after the listed ones), the first `max` visible and the rest behind "+N more".
 */
export function splitHeaderChips(
  providers: readonly ProviderStatus[],
  order: readonly Provider[] | undefined,
  max: number = MAX_HEADER_CHIPS,
): { all: ProviderStatus[]; visible: ProviderStatus[]; hidden: ProviderStatus[] } {
  const rank = new Map<string, number>((order ?? []).map((p, i) => [p, i]));
  const all = providers
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (rank.get(a.p.provider) ?? order?.length ?? 0) - (rank.get(b.p.provider) ?? order?.length ?? 0) || a.i - b.i)
    .map((x) => x.p);
  if (all.length <= max) return { all, visible: all, hidden: [] };
  return { all, visible: all.slice(0, max), hidden: all.slice(max) };
}

/** Rough pixel width of a compact header chip (dot, label, padding; "limited" tag when limited). */
export function estimateChipWidth(label: string, limited = false): number {
  return 30 + Math.ceil(label.length * 6.8) + (limited ? 46 : 0);
}

/**
 * How many chips fit in `width` px next to a "+N more" chip (never more than `max`, at least 1).
 * `width` 0/unknown (not laid out yet, or tests) = `max`.
 */
export function chipsThatFit(labels: { label: string; limited?: boolean }[], width: number, max: number = MAX_HEADER_CHIPS, gap = 6, moreWidth = 78): number {
  if (!width || width <= 0) return Math.min(max, labels.length);
  const all = labels.reduce((w, l, i) => w + estimateChipWidth(l.label, l.limited) + (i ? gap : 0), 0);
  if (labels.length <= max && all <= width) return labels.length;
  let used = moreWidth;
  let n = 0;
  for (const l of labels.slice(0, max)) {
    const w = estimateChipWidth(l.label, l.limited) + gap;
    if (used + w > width) break;
    used += w;
    n++;
  }
  return Math.max(1, n);
}
