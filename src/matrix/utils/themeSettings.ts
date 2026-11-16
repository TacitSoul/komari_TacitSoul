/**
 * Matrix-side view of the theme settings record.
 *
 * Only the keys the matrix card, latency layer and filter bars read are kept here.
 * Simulated latency is intentionally not part of this model.
 */
import { normalizeHomeGroupOrder, normalizeHomeRegionOrder } from "@/matrix/utils/homeNodes";
import {
  normalizeHomepageMultiPingNodeTaskIds,
  normalizeHomepageMultiPingTaskIds,
  normalizeHomepagePingTaskBindings,
  type HomepageMultiPingNodeTaskIds,
  type HomepagePingTaskBindings,
} from "@/matrix/utils/pingTasks";
import { normalizeTrafficResetDays } from "@/matrix/utils/trafficReset";

/** Card density of the home grid. Only "large" (the matrix card) exists in this theme. */
export type NodeViewMode = "large" | "compact" | "mini" | "list";

export interface ResolvedThemeSettings {
  /** Master switch for latency / packet-loss sections in every view. */
  showLatency: boolean;
  /** Single-line mode: ping task id → node UUIDs shown with that task. */
  homepagePingBindings: HomepagePingTaskBindings;
  /** Three-line mode on/off. Takes effect only with exactly three tasks selected. */
  enableHomepageMultiPing: boolean;
  homepageMultiPingTaskIds: number[];
  /** Per-node override of the three tasks. */
  homepageMultiPingNodeTaskIds: HomepageMultiPingNodeTaskIds;
  showGroupTabs: boolean;
  showRegionBar: boolean;
  homeGroupOrder: string[];
  homeRegionOrder: string[];
  /** Matrix card: group shown in the subtitle. */
  showCardGroup: boolean;
  /** Matrix card: TCP / UDP connection counters. */
  showConnections: boolean;
  /** Matrix card: today's-traffic popover button. */
  showTodayTrafficPopover: boolean;
  /** Price / renewal shown to visitors who are not logged in. */
  showCostsToGuests: boolean;
  /** Node UUID → day of month the traffic quota resets. */
  trafficResetDays: Record<string, number>;
}

export const DEFAULT_THEME_SETTINGS: ResolvedThemeSettings = {
  showLatency: true,
  homepagePingBindings: {},
  enableHomepageMultiPing: false,
  homepageMultiPingTaskIds: [],
  homepageMultiPingNodeTaskIds: {},
  showGroupTabs: true,
  showRegionBar: true,
  homeGroupOrder: [],
  homeRegionOrder: [],
  showCardGroup: true,
  showConnections: false,
  showTodayTrafficPopover: true,
  showCostsToGuests: true,
  trafficResetDays: {},
};

function enabledUnlessFalse(value: unknown) {
  return value !== false;
}

export function normalizeThemeSettings(
  settings: Record<string, unknown> | null | undefined,
): ResolvedThemeSettings {
  return {
    showLatency: enabledUnlessFalse(settings?.showLatency),
    homepagePingBindings: normalizeHomepagePingTaskBindings(settings?.homepagePingBindings),
    // The stored switch is kept as-is so the settings page can show and repair an incomplete
    // selection; consumers only enable three-line mode when exactly three tasks are present.
    enableHomepageMultiPing: settings?.enableHomepageMultiPing === true,
    homepageMultiPingTaskIds: normalizeHomepageMultiPingTaskIds(settings?.homepageMultiPingTaskIds),
    homepageMultiPingNodeTaskIds: normalizeHomepageMultiPingNodeTaskIds(
      settings?.homepageMultiPingNodeTaskIds,
    ),
    showGroupTabs: enabledUnlessFalse(settings?.showGroupTabs),
    showRegionBar: enabledUnlessFalse(settings?.showRegionBar),
    homeGroupOrder: normalizeHomeGroupOrder(settings?.homeGroupOrder),
    homeRegionOrder: normalizeHomeRegionOrder(settings?.homeRegionOrder),
    showCardGroup: enabledUnlessFalse(settings?.showCardGroup),
    showConnections: settings?.showConnections === true,
    showTodayTrafficPopover: enabledUnlessFalse(settings?.showTodayTrafficPopover),
    showCostsToGuests: enabledUnlessFalse(settings?.showCostsToGuests),
    trafficResetDays: normalizeTrafficResetDays(settings?.trafficResetDays),
  };
}

export function canViewCosts(
  settings: Pick<ResolvedThemeSettings, "showCostsToGuests">,
  loggedIn: boolean,
) {
  return loggedIn || settings.showCostsToGuests;
}
