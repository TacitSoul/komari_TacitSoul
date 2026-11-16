interface OrderableNode {
  uuid: string;
  weight?: unknown;
  created_at?: unknown;
}

/**
 * Match the native admin list: weight ascending, preserving the underlying
 * public:getNodesInformation array order within each equal-weight group.
 * Only UUID ranks are read from that array, never metadata or extra nodes.
 *
 * Missing/partial/unsupported order data cannot reconstruct the exact DB order.
 * Within a weight group, put unranked nodes after ranked ones, then order them
 * by finite creation time (invalid/missing last) and UUID. Invalid weights use
 * zero. Fixed per-node keys keep this fallback transitive even with mixed ranks.
 * Neither input collection nor its node objects is mutated.
 */
export function sortNodesByAdminOrder<T extends OrderableNode>(
  nodes: readonly T[],
  orderedNodes: unknown,
): T[] {
  const ranks = new Map<string, number>();
  if (Array.isArray(orderedNodes)) {
    orderedNodes.forEach((value, index) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      const uuid: unknown = (value as Record<string, unknown>).uuid;
      if (typeof uuid === 'string' && uuid.length > 0 && !ranks.has(uuid)) {
        ranks.set(uuid, index);
      }
    });
  }

  return nodes.map((node, index) => {
    const timestamp = typeof node.created_at === 'string' ? Date.parse(node.created_at) : NaN;
    return {
      node,
      index,
      weight: typeof node.weight === 'number' && Number.isFinite(node.weight) ? node.weight : 0,
      rank: ranks.get(node.uuid) ?? Number.MAX_SAFE_INTEGER,
      createdAt: Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER,
    };
  }).sort((a, b) =>
    a.weight - b.weight
    || a.rank - b.rank
    || a.createdAt - b.createdAt
    || (a.node.uuid < b.node.uuid ? -1 : a.node.uuid > b.node.uuid ? 1 : 0)
    || a.index - b.index,
  ).map(entry => entry.node);
}
