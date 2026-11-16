import { useCallback, useEffect, useMemo } from 'react';
import type { NodeWithStatus } from '@/services/api';
import { FLEET_ALL, setFleetGroup, setFleetRegion, useFleetFilter } from '@/lib/fleetFilter';
import { useHomeFilterOrder } from '@/matrix/hooks/useHomeFilterOrder';
import { useMediaQuery } from '@/matrix/hooks/useMediaQuery';
import { useThemeSettings } from '@/matrix/hooks/useThemeSettings';
import {
  dedupeGroupLabels,
  getHomeGroupLabel,
  getHomeRegionOptions,
  sortHomeGroupOptions,
} from '@/matrix/utils/homeNodes';
import { MOBILE_VIEWPORT_QUERY } from '@/matrix/utils/mediaQuery';
import { GroupTabs, RegionTabs } from './FilterTabs';
import '@/matrix/styles/filters.css';

/**
 * Group tabs + region bar, shared by the card, matrix and table views.
 * `nodes` is the full (unfiltered) list; the selection lives in `fleetFilter`.
 */
export function FleetFilterBars({ nodes }: { nodes: NodeWithStatus[] }) {
  const settings = useThemeSettings();
  const { group, region } = useFleetFilter();
  const order = useHomeFilterOrder();
  const isMobile = useMediaQuery(MOBILE_VIEWPORT_QUERY, true);
  const canReorder = order.canReorder && !isMobile;

  const groupOrder = order.optimistic.homeGroupOrder ?? settings.homeGroupOrder;
  const regionOrder = order.optimistic.homeRegionOrder ?? settings.homeRegionOrder;

  const groupOptions = useMemo(
    () => sortHomeGroupOptions(dedupeGroupLabels(nodes.map((node) => node.group)), groupOrder),
    [nodes, groupOrder],
  );
  const groupNodes = useMemo(
    () => (group === FLEET_ALL ? nodes : nodes.filter((node) => getHomeGroupLabel(node.group ?? '') === group)),
    [nodes, group],
  );
  // Region counts follow the selected group.
  const regionOptions = useMemo(() => getHomeRegionOptions(groupNodes, regionOrder), [groupNodes, regionOrder]);
  const availableRegions = useMemo(() => getHomeRegionOptions(nodes).map(({ code }) => code), [nodes]);

  const showGroups = settings.isReady && settings.showGroupTabs && groupOptions.length > 0;
  // A single region is no filter at all.
  const showRegions = settings.isReady && settings.showRegionBar && regionOptions.length > 1;

  useEffect(() => {
    if (group !== FLEET_ALL && (!showGroups || !groupOptions.includes(group))) setFleetGroup(FLEET_ALL);
  }, [group, groupOptions, showGroups]);

  useEffect(() => {
    if (region !== FLEET_ALL && (!showRegions || !regionOptions.some((option) => option.code === region))) {
      setFleetRegion(FLEET_ALL);
    }
  }, [region, regionOptions, showRegions]);

  const { reorder } = order;
  const reorderGroups = useCallback(
    (visibleOrder: string[]) => reorder({ field: 'homeGroupOrder', visibleOrder, availableOrder: groupOptions }),
    [reorder, groupOptions],
  );
  const reorderRegions = useCallback(
    (visibleOrder: string[]) => reorder({ field: 'homeRegionOrder', visibleOrder, availableOrder: availableRegions }),
    [reorder, availableRegions],
  );

  if (!showGroups && !showRegions) return null;

  return (
    <div className="fleet-filter-bars">
      <span className="sr-only" role="status">{order.status}</span>
      {order.errorMessage && (
        <div className="home-filter-order-error" role="alert">{order.errorMessage}</div>
      )}
      {showGroups && (
        <GroupTabs
          groups={groupOptions}
          selectedGroup={group}
          onSelectGroup={setFleetGroup}
          canReorder={canReorder}
          onReorder={reorderGroups}
        />
      )}
      {showRegions && (
        <RegionTabs
          regions={regionOptions}
          selectedRegion={region}
          onSelectRegion={setFleetRegion}
          canReorder={canReorder}
          onReorder={reorderRegions}
        />
      )}
    </div>
  );
}
