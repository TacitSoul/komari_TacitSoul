/**
 * Settings model of the in-theme settings page.
 *
 * Every setting of the theme is edited here (the admin menu's theme entry redirects to this page).
 * Key spelling: the base theme's flat keys are snake_case, the keys that came
 * with the matrix layer are camelCase. Saving is read–merge–write: keys this page does not know about are
 * carried over untouched.
 */
import {
  normalizeHomepageMultiPingNodeTaskIds,
  normalizeHomepageMultiPingTaskIds,
  normalizeHomepagePingTaskBindings,
  HOMEPAGE_MULTI_PING_TASK_COUNT,
  type HomepageMultiPingNodeTaskIds,
  type HomepagePingTaskBindings,
} from '@/matrix/utils/pingTasks';
import { normalizeTrafficResetDays } from '@/matrix/utils/trafficReset';
import { parseStoredTheme } from '@/hooks/useTheme';

export type DefaultView = 'globe' | 'grid' | 'matrix' | 'table' | 'uptime';
export type GlobeMode = 'dynamic' | 'static';
export type GlobeMarkerStyle = 'rich' | 'calm' | 'lite';
export type DefaultTheme = 'clean' | 'deepspace' | 'auto';
export type CardProgressLayout = '2col' | '1col';

export interface SettingsDraft {
  // views
  default_view: DefaultView;
  enable_globe: boolean;
  enable_matrix: boolean;
  enable_uptime: boolean;
  default_theme: DefaultTheme;
  // overview
  enable_cluster_panel: boolean;
  showGroupTabs: boolean;
  showRegionBar: boolean;
  enable_asset_stats: boolean;
  // globe
  globe_hub_node: string;
  globe_mode: GlobeMode;
  globe_respect_reduced_motion: boolean;
  globe_marker_style: GlobeMarkerStyle;
  // cards (card view + matrix)
  cardProgressLayout: CardProgressLayout;
  trafficSplitColor: boolean;
  showCardGroup: boolean;
  showConnections: boolean;
  showTodayTrafficPopover: boolean;
  showCostsToGuests: boolean;
  trafficResetDays: Record<string, number>;
  // latency
  showLatency: boolean;
  homepagePingBindings: HomepagePingTaskBindings;
  enableHomepageMultiPing: boolean;
  homepageMultiPingTaskIds: number[];
  homepageMultiPingNodeTaskIds: HomepageMultiPingNodeTaskIds;
  // site
  enable_privacy_mode: boolean;
  custom_footer: string;
  hide_footer_credit: boolean;
}

export type BooleanSettingKey = {
  [K in keyof SettingsDraft]: SettingsDraft[K] extends boolean ? K : never;
}[keyof SettingsDraft];

const VIEWS: readonly DefaultView[] = ['globe', 'matrix', 'grid', 'table', 'uptime'];

function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function draftFromSettings(raw: Record<string, unknown>): SettingsDraft {
  return {
    default_view: oneOf(raw.default_view, VIEWS, 'globe'),
    enable_globe: bool(raw.enable_globe, true),
    enable_matrix: bool(raw.enable_matrix, true),
    enable_uptime: bool(raw.enable_uptime, true),
    default_theme: (typeof raw.default_theme === 'string' && parseStoredTheme(raw.default_theme)) || 'clean',
    enable_cluster_panel: bool(raw.enable_cluster_panel, true),
    showGroupTabs: bool(raw.showGroupTabs, true),
    showRegionBar: bool(raw.showRegionBar, true),
    enable_asset_stats: bool(raw.enable_asset_stats, false),
    globe_hub_node: typeof raw.globe_hub_node === 'string' ? raw.globe_hub_node.trim() : '',
    globe_mode: oneOf(raw.globe_mode, ['dynamic', 'static'] as const, 'dynamic'),
    globe_respect_reduced_motion: bool(raw.globe_respect_reduced_motion, false),
    globe_marker_style: oneOf(raw.globe_marker_style, ['rich', 'calm', 'lite'] as const, 'rich'),
    cardProgressLayout: oneOf(raw.cardProgressLayout, ['2col', '1col'] as const, '2col'),
    trafficSplitColor: bool(raw.trafficSplitColor, true),
    showCardGroup: bool(raw.showCardGroup, true),
    showConnections: bool(raw.showConnections, false),
    showTodayTrafficPopover: bool(raw.showTodayTrafficPopover, true),
    showCostsToGuests: bool(raw.showCostsToGuests, true),
    trafficResetDays: normalizeTrafficResetDays(raw.trafficResetDays),
    showLatency: bool(raw.showLatency, true),
    homepagePingBindings: normalizeHomepagePingTaskBindings(raw.homepagePingBindings),
    enableHomepageMultiPing: raw.enableHomepageMultiPing === true,
    homepageMultiPingTaskIds: normalizeHomepageMultiPingTaskIds(raw.homepageMultiPingTaskIds),
    homepageMultiPingNodeTaskIds: normalizeHomepageMultiPingNodeTaskIds(raw.homepageMultiPingNodeTaskIds),
    enable_privacy_mode: bool(raw.enable_privacy_mode, false),
    custom_footer: typeof raw.custom_footer === 'string' ? raw.custom_footer : '',
    hide_footer_credit: bool(raw.hide_footer_credit, false),
  };
}

export type SettingsProblem = 'multiPingIncomplete' | 'multiPingUnknownTasks' | 'nodeMultiPingUnknownTasks' | 'pingBindingsUnknownTasks' | 'resetDayInvalid';

/** Problems that block saving. */
export function validateDraft(draft: SettingsDraft, knownTaskIds?: ReadonlySet<number>): SettingsProblem[] {
  const problems: SettingsProblem[] = [];
  if (draft.enableHomepageMultiPing) {
    const ids = draft.homepageMultiPingTaskIds;
    if (completeMultiPingTaskIds(ids).length !== HOMEPAGE_MULTI_PING_TASK_COUNT) {
      problems.push('multiPingIncomplete');
    }
  }
  if (knownTaskIds) {
    if (draft.homepageMultiPingTaskIds.some((id) => !knownTaskIds.has(id))) problems.push('multiPingUnknownTasks');
    if (Object.values(draft.homepageMultiPingNodeTaskIds).some((ids) => ids.some((id) => !knownTaskIds.has(id)))) {
      problems.push('nodeMultiPingUnknownTasks');
    }
    if (Object.keys(draft.homepagePingBindings).some((id) => !knownTaskIds.has(Number(id)))) {
      problems.push('pingBindingsUnknownTasks');
    }
  }
  return problems;
}

/** Keep blank line positions in the editor; only complete selections enter the draft. */
export function multiPingSlots(ids: readonly number[]): (number | null)[] {
  return Array.from({ length: HOMEPAGE_MULTI_PING_TASK_COUNT }, (_, slot) => ids[slot] ?? null);
}

export function updateMultiPingSlot(slots: readonly (number | null)[], slot: number, id: number | null): (number | null)[] {
  return Array.from({ length: HOMEPAGE_MULTI_PING_TASK_COUNT }, (_, index) => index === slot ? id : slots[index] ?? null);
}

export function completeMultiPingTaskIds(slots: readonly (number | null)[]): number[] {
  if (slots.length !== HOMEPAGE_MULTI_PING_TASK_COUNT || new Set(slots).size !== slots.length) return [];
  const ids = Array.from(slots);
  return ids.every((id): id is number => id !== null && Number.isSafeInteger(id) && id > 0) ? ids : [];
}

export function parseTrafficResetDay(raw: string): { valid: true; day: number | null } | { valid: false } {
  if (raw === '') return { valid: true, day: null };
  if (!/^\d+$/.test(raw) || raw.trim() !== raw) return { valid: false };
  const day = Number(raw);
  return Number.isInteger(day) && day >= 1 && day <= 31 ? { valid: true, day } : { valid: false };
}

function stableSerialize(value: unknown): string | undefined {
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const object = entry as Record<string, unknown>;
      return Object.fromEntries(Object.keys(object).sort().map((key) => [key, object[key]]));
    }
    return entry;
  });
}

const PER_KEY_SETTINGS = new Set<keyof SettingsDraft>([
  'trafficResetDays', 'homepageMultiPingNodeTaskIds',
]);

function bindingsByNode(bindings: HomepagePingTaskBindings): Record<string, string[]> {
  const nodes: Record<string, string[]> = {};
  for (const task of Object.keys(bindings).sort()) {
    for (const uuid of bindings[task]) (nodes[uuid] ??= []).push(task);
  }
  return nodes;
}

/** Three-way merge: untouched fields and inner keys always come from the latest record. */
export function mergeDraftIntoSettings(
  current: Record<string, unknown>,
  draft: SettingsDraft,
  baseline: SettingsDraft,
): { settings: Record<string, unknown>; conflicts: string[] } {
  const settings = { ...current };
  const latest = draftFromSettings(current);
  const conflicts: string[] = [];
  for (const key of Object.keys(draft) as (keyof SettingsDraft)[]) {
    if (stableSerialize(draft[key]) === stableSerialize(baseline[key])) continue;
    if (key === 'homepagePingBindings') {
      // Bindings are stored by task, but editing moves a node across tasks atomically.
      const before = bindingsByNode(baseline.homepagePingBindings);
      const edited = bindingsByNode(draft.homepagePingBindings);
      const server = bindingsByNode(latest.homepagePingBindings);
      const next = { ...server };
      for (const uuid of new Set([...Object.keys(before), ...Object.keys(edited)])) {
        if (stableSerialize(edited[uuid]) === stableSerialize(before[uuid])) continue;
        if (stableSerialize(server[uuid]) !== stableSerialize(before[uuid])) conflicts.push(`${key}.${uuid}`);
        if (Object.hasOwn(edited, uuid)) next[uuid] = edited[uuid];
        else delete next[uuid];
      }
      const bindings: HomepagePingTaskBindings = {};
      for (const [uuid, tasks] of Object.entries(next)) {
        for (const task of tasks) (bindings[task] ??= []).push(uuid);
      }
      settings[key] = bindings;
      continue;
    }
    if (PER_KEY_SETTINGS.has(key)) {
      const before = baseline[key] as Record<string, unknown>;
      const edited = draft[key] as Record<string, unknown>;
      const server = latest[key] as Record<string, unknown>;
      const raw = current[key];
      const next = { ...(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) } as Record<string, unknown>;
      for (const innerKey of new Set([...Object.keys(before), ...Object.keys(edited)])) {
        if (stableSerialize(edited[innerKey]) === stableSerialize(before[innerKey])) continue;
        if (stableSerialize(server[innerKey]) !== stableSerialize(before[innerKey])) conflicts.push(`${key}.${innerKey}`);
        if (Object.hasOwn(edited, innerKey)) next[innerKey] = edited[innerKey];
        else delete next[innerKey];
      }
      settings[key] = next;
    } else {
      if (stableSerialize(latest[key]) !== stableSerialize(baseline[key])) conflicts.push(key);
      settings[key] = draft[key];
    }
  }
  return { settings, conflicts };
}

/** Stable signature for "unsaved changes" detection. */
export function draftSignature(draft: SettingsDraft): string {
  return stableSerialize(draft)!;
}
