import { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from 'react';
import { createElement } from 'react';
import { apiService, type MetricDefinition, type UserInfo } from '@/services/api';
import { parseStoredTheme } from '@/hooks/useTheme';
import { clearOfflineCacheOnLogout } from '@/lib/offlineCache';

export interface ThemeConfig {
  default_view: 'globe' | 'grid' | 'matrix' | 'table' | 'uptime';
  enable_globe: boolean;
  /** Matrix view (large cards). */
  enable_matrix: boolean;
  /** Cluster status panel above the card / matrix / table views. */
  enable_cluster_panel: boolean;
  enable_uptime: boolean;
  /** Fleet asset / billing statistics panel in grid & table views. */
  enable_asset_stats: boolean;
  default_theme: 'deepspace' | 'clean' | 'auto';
  custom_footer: string;
  /** Hide the footer credit line (Powered by Komari Monitor · version · theme); only custom footer text remains. */
  hide_footer_credit: boolean;
  enable_privacy_mode: boolean;
  /** Name of the central hub node for globe-view arcs. Always the original
   *  (pre-privacy-mask) node name — the matching is done before names are
   *  replaced. Empty string disables arcs. */
  globe_hub_node: string;
  /** Default globe rotation behaviour. `dynamic` auto-rotates on load;
   *  `static` stays still until the viewer starts rotation via the on-page
   *  control (manual drag always works regardless). */
  globe_mode: 'dynamic' | 'static';
  /** When true, viewers with `prefers-reduced-motion: reduce` see a static
   *  globe (auto-rotation disabled, manual drag still works). When false
   *  (default), the globe always auto-rotates regardless of the visitor's
   *  system motion preference. */
  globe_respect_reduced_motion: boolean;
  /** Globe marker presentation tier. See `globe_marker_style` in
   *  komari-theme.json. */
  globe_marker_style: 'rich' | 'calm' | 'lite';
}

const defaultThemeConfig: ThemeConfig = {
  default_view: 'globe',
  enable_globe: true,
  enable_matrix: true,
  enable_cluster_panel: true,
  enable_uptime: true,
  enable_asset_stats: false,
  default_theme: 'clean',
  custom_footer: '',
  hide_footer_credit: false,
  enable_privacy_mode: false,
  globe_hub_node: '',
  globe_mode: 'dynamic',
  globe_respect_reduced_motion: false,
  globe_marker_style: 'rich',
};

/** `short` of this theme in komari-theme.json — also the key its settings are stored under. */
export const THEME_SHORT = 'TacitSoul';

export interface AppConfig {
  isLoggedIn: boolean;
  username: string;
  recordPreserveTime: number;   // hours, default 720
  pingRecordPreserveTime: number; // hours, default 48
  themeConfig: ThemeConfig;
  /** The stored theme settings record as the server returned it (all keys, unparsed).
   *  The reference only changes when the content does. */
  themeSettingsRaw: Record<string, unknown>;
  /** `short` of the theme the server currently serves. Settings may only be written when this
   *  equals THEME_SHORT — otherwise the record belongs to another theme (e.g. during development
   *  against an instance that runs a different theme). */
  serverTheme: string;
  loaded: boolean;
  /** Re-read public settings (after a save, or when the tab becomes visible again). */
  refresh: () => Promise<void>;
}

const EMPTY_SETTINGS: Record<string, unknown> = Object.freeze({}) as Record<string, unknown>;

const defaultConfig: AppConfig = {
  isLoggedIn: false,
  username: '',
  recordPreserveTime: 720,
  pingRecordPreserveTime: 48,
  themeConfig: defaultThemeConfig,
  themeSettingsRaw: EMPTY_SETTINGS,
  serverTheme: '',
  loaded: false,
  refresh: async () => {},
};

const AppConfigContext = createContext<AppConfig>(defaultConfig);

/** A failed auth check must not turn a known admin session into a logout. */
export function parseLoginState(userInfo: UserInfo | null): Partial<Pick<AppConfig, 'isLoggedIn' | 'username'>> {
  return userInfo ? { isLoggedIn: !!userInfo.logged_in, username: userInfo.username || '' } : {};
}

export function useAppConfig() {
  return useContext(AppConfigContext);
}

function positiveNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

const LOAD_METRIC_KEYS = new Set([
  'cpu.usage',
  'gpu.usage',
  'memory.used',
  'swap.used',
  'load.average',
  'disk.used',
  'net.in.rate',
  'net.out.rate',
  'net.total.up',
  'net.total.down',
  'traffic.up',
  'traffic.down',
  'process.count',
  'connections.tcp',
  'connections.udp',
]);

const PING_METRIC_KEYS = new Set(['ping.latency_ms', 'ping.loss']);

/**
 * Return a safe shared chart window for a group of metric definitions.
 * A shared selector must not advertise a range longer than the shortest
 * retained metric rendered by that selector.
 */
function getMetricRetentionHours(
  definitions: MetricDefinition[] | null | undefined,
  metricKeys: Set<string>,
): number | undefined {
  if (!definitions?.length) return undefined;

  const relevant = definitions
    .filter(definition => metricKeys.has(definition.name))
    .map(definition => definition.retention_days)
    .filter(value => Number.isFinite(value) && value >= 0);
  if (!relevant.length) return undefined;

  // A disabled metric has no usable history, but other panels may still have
  // data. Use the shortest positive policy for the shared selector.
  const positive = relevant.filter(value => value > 0);
  if (!positive.length) return 0;
  return Math.min(...positive) * 24;
}

/**
 * Prefer v1.4.3 per-metric policies, with the legacy public settings as a
 * fallback for older servers or when metric definitions are unavailable.
 */
export function parseHistoryRetentionFromPublicSettings(
  publicSettings: Record<string, unknown> | null,
  metricDefinitions?: MetricDefinition[] | null,
): Pick<AppConfig, 'recordPreserveTime' | 'pingRecordPreserveTime'> {
  const metricRetentionDays = positiveNumber(publicSettings?.metric_retention_days);
  const metricRetentionHours = metricRetentionDays ? metricRetentionDays * 24 : undefined;
  const loadMetricRetentionHours = getMetricRetentionHours(metricDefinitions, LOAD_METRIC_KEYS);
  const pingMetricRetentionHours = getMetricRetentionHours(metricDefinitions, PING_METRIC_KEYS);

  return {
    recordPreserveTime: loadMetricRetentionHours
      ?? metricRetentionHours
      ?? positiveNumber(publicSettings?.record_preserve_time)
      ?? defaultConfig.recordPreserveTime,
    pingRecordPreserveTime: pingMetricRetentionHours
      ?? metricRetentionHours
      ?? positiveNumber(publicSettings?.ping_record_preserve_time)
      ?? defaultConfig.pingRecordPreserveTime,
  };
}

/** The `theme_settings` record of a public-settings payload (object or JSON string), or {}. */
export function extractThemeSettingsRecord(
  publicSettings: Record<string, unknown> | null,
): Record<string, unknown> {
  const rawTs = publicSettings?.theme_settings;
  if (rawTs && typeof rawTs === 'object' && !Array.isArray(rawTs)) {
    return rawTs as Record<string, unknown>;
  }
  if (typeof rawTs === 'string' && rawTs.trim()) {
    try {
      const parsed = JSON.parse(rawTs);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // ignore — treated as no settings
    }
  }
  return {};
}

/** Parse the flat theme settings from a public-settings payload. */
export function parseThemeConfigFromPublicSettings(
  publicSettings: Record<string, unknown> | null,
): ThemeConfig {
  const tc: ThemeConfig = { ...defaultThemeConfig };
  if (!publicSettings) return tc;

  const themeSettings = extractThemeSettingsRecord(publicSettings);
  const pick = (key: string): unknown =>
    themeSettings[key] !== undefined ? themeSettings[key] : publicSettings[key];

  const dv = pick('default_view');
  if (typeof dv === 'string' && ['globe', 'matrix', 'grid', 'table', 'uptime'].includes(dv)) {
    tc.default_view = dv as ThemeConfig['default_view'];
  }
  const eg = pick('enable_globe');
  if (typeof eg === 'boolean') tc.enable_globe = eg;
  if (eg === 'true') tc.enable_globe = true;
  if (eg === 'false') tc.enable_globe = false;
  const em = pick('enable_matrix');
  if (typeof em === 'boolean') tc.enable_matrix = em;
  if (em === 'true') tc.enable_matrix = true;
  if (em === 'false') tc.enable_matrix = false;
  const ecp = pick('enable_cluster_panel');
  if (typeof ecp === 'boolean') tc.enable_cluster_panel = ecp;
  if (ecp === 'true') tc.enable_cluster_panel = true;
  if (ecp === 'false') tc.enable_cluster_panel = false;
  const eu = pick('enable_uptime');
  if (typeof eu === 'boolean') tc.enable_uptime = eu;
  if (eu === 'true') tc.enable_uptime = true;
  if (eu === 'false') tc.enable_uptime = false;
  const eas = pick('enable_asset_stats');
  if (typeof eas === 'boolean') tc.enable_asset_stats = eas;
  if (eas === 'true') tc.enable_asset_stats = true;
  if (eas === 'false') tc.enable_asset_stats = false;
  const dt = pick('default_theme');
  if (typeof dt === 'string') {
    // Legacy palette names from the base theme and Komari's own appearance values are accepted.
    const parsed = parseStoredTheme(dt);
    if (parsed) tc.default_theme = parsed;
  }
  const cf = pick('custom_footer');
  if (typeof cf === 'string') tc.custom_footer = cf;
  const hfc = pick('hide_footer_credit');
  if (typeof hfc === 'boolean') tc.hide_footer_credit = hfc;
  if (hfc === 'true') tc.hide_footer_credit = true;
  if (hfc === 'false') tc.hide_footer_credit = false;
  const epm = pick('enable_privacy_mode');
  if (typeof epm === 'boolean') tc.enable_privacy_mode = epm;
  if (epm === 'true') tc.enable_privacy_mode = true;
  if (epm === 'false') tc.enable_privacy_mode = false;
  const ghn = pick('globe_hub_node');
  if (typeof ghn === 'string') tc.globe_hub_node = ghn.trim();
  const ggm = pick('globe_mode');
  if (typeof ggm === 'string' && ['dynamic', 'static'].includes(ggm)) {
    tc.globe_mode = ggm as ThemeConfig['globe_mode'];
  }
  const grrm = pick('globe_respect_reduced_motion');
  if (typeof grrm === 'boolean') tc.globe_respect_reduced_motion = grrm;
  if (grrm === 'true') tc.globe_respect_reduced_motion = true;
  if (grrm === 'false') tc.globe_respect_reduced_motion = false;
  const gms = pick('globe_marker_style');
  if (typeof gms === 'string' && ['rich', 'calm', 'lite'].includes(gms)) {
    tc.globe_marker_style = gms as ThemeConfig['globe_marker_style'];
  }

  // Fallback: if default_view references a disabled view, pick first available
  if ((tc.default_view === 'globe' && !tc.enable_globe) ||
      (tc.default_view === 'matrix' && !tc.enable_matrix) ||
      (tc.default_view === 'uptime' && !tc.enable_uptime)) {
    const fallbackOrder: ThemeConfig['default_view'][] = ['grid', 'table', 'matrix', 'globe', 'uptime'];
    tc.default_view = fallbackOrder.find(v => {
      if (v === 'globe') return tc.enable_globe;
      if (v === 'matrix') return tc.enable_matrix;
      if (v === 'uptime') return tc.enable_uptime;
      return true; // grid & table always enabled
    }) ?? 'grid';
  }

  return tc;
}

export function AppConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig>(defaultConfig);
  const previousLoginRef = useRef(config.isLoggedIn);
  useEffect(() => {
    clearOfflineCacheOnLogout(previousLoginRef.current, config.isLoggedIn);
    previousLoginRef.current = config.isLoggedIn;
  }, [config.isLoggedIn]);
  const rawSettingsRef = useRef<{ signature: string; value: Record<string, unknown> }>({
    signature: '{}',
    value: EMPTY_SETTINGS,
  });

  const applyPublicSettings = useCallback((
    publicSettings: Record<string, unknown> | null,
    metricDefinitions: MetricDefinition[] | null = null,
    patch: Partial<Pick<AppConfig, 'isLoggedIn' | 'username'>> = {},
  ) => {
    // Development only: preview settings without saving them anywhere (sessionStorage, this tab).
    // Applied before parsing so it reaches both the base theme's keys and the raw record.
    if (import.meta.env.DEV && publicSettings) {
      try {
        const preview = sessionStorage.getItem('tacitsoul:dev-settings-preview');
        if (preview) {
          const merged = { ...extractThemeSettingsRecord(publicSettings), ...(JSON.parse(preview) as Record<string, unknown>) };
          publicSettings = { ...publicSettings, theme_settings: merged };
        }
      } catch {
        // ignore malformed preview
      }
    }
    const tc = parseThemeConfigFromPublicSettings(publicSettings);
    const historyRetention = parseHistoryRetentionFromPublicSettings(publicSettings, metricDefinitions);
    // Keep the raw record's identity stable across refreshes that changed nothing, so data
    // layers keyed on it (ping polling, matrix settings) do not restart on every tab focus.
    const raw = extractThemeSettingsRecord(publicSettings);
    const signature = JSON.stringify(raw);
    if (signature !== rawSettingsRef.current.signature) {
      rawSettingsRef.current = { signature, value: raw };
    }
    const themeSettingsRaw = rawSettingsRef.current.value;
    const serverTheme = typeof publicSettings?.theme === 'string' ? publicSettings.theme : '';
    setConfig(prev => ({
      ...prev,
      ...patch,
      themeConfig: tc,
      themeSettingsRaw,
      serverTheme,
      ...historyRetention,
      loaded: true,
    }));
  }, []);

  const refreshThemeConfig = useCallback(async () => {
    const [publicSettings, metricDefinitions, userInfo] = await Promise.all([
      apiService.getPublicSettings().catch(() => null),
      apiService.getMetricDefinitions().catch(() => []),
      apiService.getUserInfo().catch(() => null),
    ]);
    // An unavailable /api/me is not evidence of logout; keep the known session.
    const loginPatch = parseLoginState(userInfo);
    if (!publicSettings) {
      setConfig(prev => ({ ...prev, ...loginPatch }));
      return;
    }
    applyPublicSettings(publicSettings, metricDefinitions, loginPatch);
  }, [applyPublicSettings]);

  useEffect(() => {
    const init = async () => {
      try {
        const [userInfo, publicSettings, metricDefinitions] = await Promise.all([
          apiService.getUserInfo().catch(() => null),
          apiService.getPublicSettings().catch(() => null),
          apiService.getMetricDefinitions().catch(() => []),
        ]);
        applyPublicSettings(publicSettings, metricDefinitions, {
          isLoggedIn: !!userInfo?.logged_in,
          username: userInfo?.username || '',
        });
      } catch (e) {
        console.error('Failed to load app config:', e);
        setConfig(prev => ({ ...prev, loaded: true }));
      }
    };
    init();
  }, [applyPublicSettings]);

  /* Re-fetch theme settings when the tab becomes visible again so admin
   * panel changes (globe_marker_style, globe_mode, etc.) apply without a
   * hard reload. */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void refreshThemeConfig();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refreshThemeConfig]);

  const value = useMemo(() => ({ ...config, refresh: refreshThemeConfig }), [config, refreshThemeConfig]);

  return createElement(AppConfigContext.Provider, { value }, children);
}
