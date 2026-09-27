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
