import { useMemo } from "react";
import { useAppConfig } from "@/hooks/useAppConfig";
import {
  DEFAULT_THEME_SETTINGS,
  normalizeThemeSettings,
  type ResolvedThemeSettings,
} from "@/matrix/utils/themeSettings";

const EMPTY_BINDINGS: ResolvedThemeSettings["homepagePingBindings"] = Object.freeze({});
const EMPTY_NODE_TASK_IDS: ResolvedThemeSettings["homepageMultiPingNodeTaskIds"] = Object.freeze({});
const EMPTY_TASK_IDS: number[] = [];

let cachedRaw: Record<string, unknown> | null = null;
let cachedResolved: ResolvedThemeSettings = DEFAULT_THEME_SETTINGS;

/**
 * Normalised settings, memoised on the raw record's identity (which the app config keeps stable
 * while the content is unchanged) — the latency poller restarts whenever these objects change.
 * With the latency master switch off, nothing is requested: bindings resolve to empty.
 */
function resolve(raw: Record<string, unknown>): ResolvedThemeSettings {
  if (raw === cachedRaw) return cachedResolved;
  const normalized = normalizeThemeSettings(raw);
  cachedRaw = raw;
  cachedResolved = normalized.showLatency
    ? normalized
    : {
        ...normalized,
        homepagePingBindings: EMPTY_BINDINGS,
        enableHomepageMultiPing: false,
        homepageMultiPingTaskIds: EMPTY_TASK_IDS,
        homepageMultiPingNodeTaskIds: EMPTY_NODE_TASK_IDS,
      };
  return cachedResolved;
}

export type ThemeSettingsState = ResolvedThemeSettings & {
  /** True once the server's settings arrived (or failed and defaults apply). */
  isReady: boolean;
  isLoading: boolean;
  isError: boolean;
};

export function useThemeSettings(): ThemeSettingsState {
  const { themeSettingsRaw, loaded } = useAppConfig();
  return useMemo(
    () => ({ ...resolve(themeSettingsRaw), isReady: loaded, isLoading: !loaded, isError: false }),
    [themeSettingsRaw, loaded],
  );
}
