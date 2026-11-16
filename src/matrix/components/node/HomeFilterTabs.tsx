import { Flag } from "@/matrix/components/ui/Flag";
import { SortableFilterRow } from "@/matrix/components/ui/SortableFilterRow";
import { HOME_ALL_GROUP, HOME_ALL_REGION, type HomeRegionOption } from "@/matrix/utils/homeNodes";
import { tsText } from "@/matrix/i18n/tsText";

export function GroupTabs({
  groups, selectedGroup, onSelectGroup, canReorder, onReorder,
}: {
  groups: string[];
  selectedGroup: string;
  onSelectGroup: (group: string) => void;
  canReorder: boolean;
  onReorder: (order: string[]) => void;
}) {
  return (
    <SortableFilterRow
      items={groups} selected={selectedGroup} onSelect={onSelectGroup}
      className="home-group-tabs" label={tsText("节点分组")}
      canReorder={canReorder} onReorder={onReorder} renderItem={(group) => group}
      leadingContent={
        <button
          type="button" aria-pressed={selectedGroup === HOME_ALL_GROUP}
          data-active={selectedGroup === HOME_ALL_GROUP ? "true" : "false"}
          onClick={() => onSelectGroup(HOME_ALL_GROUP)}
        >
          {tsText("全部")}
        </button>
      }
    />
  );
}

// 地区计数跟随分组筛选；排序保存时由全站地区顺序补齐未显示的地区。
export function RegionTabs({
  regions, selectedRegion, onSelectRegion, canReorder, onReorder,
}: {
  regions: HomeRegionOption[];
  selectedRegion: string;
  onSelectRegion: (region: string) => void;
  canReorder: boolean;
  onReorder: (order: string[]) => void;
}) {
  const counts = new Map(regions.map(({ code, count }) => [code, count]));
  return (
    <section className="home-region-bar" aria-label={tsText("地区筛选")}>
      <SortableFilterRow
        items={regions.map(({ code }) => code)} selected={selectedRegion}
        onSelect={(code) => onSelectRegion(selectedRegion === code ? HOME_ALL_REGION : code)}
        className="home-region-chips" itemClassName="home-region-chip" label={tsText("节点地区")}
        canReorder={canReorder} onReorder={onReorder}
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
