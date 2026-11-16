const NO_HIDDEN_NODES: ReadonlySet<string> = new Set<string>();

/**
 * The theme has a theme-level hidden-node list on top of Komari's own `hidden` flag.
 * This theme relies on Komari's flag only (the server already withholds hidden nodes from guests).
 */
export function useHiddenNodeUuids(): ReadonlySet<string> {
  return NO_HIDDEN_NODES;
}
