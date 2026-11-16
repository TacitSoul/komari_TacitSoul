import { useTranslation } from 'react-i18next';
import { Flag } from '@/matrix/components/ui/Flag';
import { SortableFilterRow } from '@/matrix/components/ui/SortableFilterRow';
import { FLEET_ALL } from '@/lib/fleetFilter';
import type { HomeRegionOption } from '@/matrix/utils/homeNodes';

/**
 * groups first ("All" + one tab per group), then flag + region code + node count.
 * Region counts follow the selected group. Logged-in admins can long-press to reorder.
 */
export function GroupTabs({
  groups,
  selectedGroup,
  onSelectGroup,
  canReorder,
  onReorder,
}: {
  groups: string[];
  selectedGroup: string;
  onSelectGroup: (group: string) => void;
  canReorder: boolean;
  onReorder: (order: string[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <SortableFilterRow
      items={groups}
      selected={selectedGroup}
      onSelect={onSelectGroup}
      className="home-group-tabs"
      label={t('fleetFilter.groups')}
      canReorder={canReorder}
      onReorder={onReorder}
      renderItem={(group) => group}
      leadingContent={
        <button
          type="button"
          aria-pressed={selectedGroup === FLEET_ALL}
          data-active={selectedGroup === FLEET_ALL ? 'true' : 'false'}
          onClick={() => onSelectGroup(FLEET_ALL)}
        >
          {t('fleetFilter.all')}
        </button>
      }
    />
  );
}

export function RegionTabs({
  regions,
  selectedRegion,
  onSelectRegion,
  canReorder,
  onReorder,
}: {
  regions: HomeRegionOption[];
  selectedRegion: string;
  onSelectRegion: (region: string) => void;
  canReorder: boolean;
  onReorder: (order: string[]) => void;
}) {
  const { t } = useTranslation();
  const counts = new Map(regions.map(({ code, count }) => [code, count]));
  return (
    <section className="home-region-bar" aria-label={t('fleetFilter.regions')}>
      <SortableFilterRow
        items={regions.map(({ code }) => code)}
        selected={selectedRegion}
        onSelect={(code) => onSelectRegion(selectedRegion === code ? FLEET_ALL : code)}
        className="home-region-chips"
        itemClassName="home-region-chip"
        label={t('fleetFilter.regions')}
        canReorder={canReorder}
        onReorder={onReorder}
        renderItem={(code) => (
          <>
            <Flag region={code} size={14} />
            <span className="home-region-chip-code">{code}</span>
            <span className="home-region-chip-count">{counts.get(code)}</span>
          </>
        )}
      />
    </section>
  );
}
