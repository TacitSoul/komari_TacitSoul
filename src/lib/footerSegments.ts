/**
 * Separators of the footer's right-hand group.
 *
 * Each segment may carry a container-query drop priority (`footer-pri-N`, lower N drops first; null =
 * never dropped). A separator in front of segment `i` must be visible only while segment `i` AND at
 * least one segment before it are visible. Because a higher N stays visible on narrower bars, that is
 * exactly `min(own priority, highest earlier priority)`.
 */
export interface FooterSegmentPriority {
  /** Drop priority (1–9) or null when the segment is always shown. */
  pri: number | null;
}

/** Priority class number for the separator in front of `segments[index]`; null = always shown, undefined = no separator. */
export function separatorPriority(segments: readonly FooterSegmentPriority[], index: number): number | null | undefined {
  if (index <= 0 || index >= segments.length) return undefined;
  const rank = (pri: number | null) => (pri == null ? Number.POSITIVE_INFINITY : pri);
  let previous = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < index; i++) previous = Math.max(previous, rank(segments[i].pri));
  const value = Math.min(rank(segments[index].pri), previous);
  return Number.isFinite(value) ? value : null;
}
