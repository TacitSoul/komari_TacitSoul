/** Widest measured name, rounded up with a small glyph-edge allowance. */
export function getFleetNameWidth(names: readonly string[], measure: (name: string) => number): number {
  let widest = 0;
  for (const name of names) {
    const width = measure(name);
    if (Number.isFinite(width) && width > widest) widest = width;
  }
  return widest > 0 ? Math.ceil(widest) + 2 : 0;
}
