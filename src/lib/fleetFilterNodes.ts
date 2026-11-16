import type { NodeWithStatus } from '@/services/api';
import { FLEET_ALL } from '@/lib/fleetFilter';
import { getDisplayRegionCode } from '@/matrix/utils/geo';
import { getHomeGroupLabel } from '@/matrix/utils/homeNodes';

type NodeLike = Pick<NodeWithStatus, 'group' | 'region'>;

/** Apply the shared group / region selection (card, matrix and table views). */
export function filterByGroupAndRegion<T extends NodeLike>(nodes: T[], group: string, region: string): T[] {
  if (group === FLEET_ALL && region === FLEET_ALL) return nodes;
  return nodes.filter(
    (node) =>
      (group === FLEET_ALL || getHomeGroupLabel(node.group ?? '') === group) &&
      (region === FLEET_ALL || getDisplayRegionCode(node.region) === region),
  );
}
