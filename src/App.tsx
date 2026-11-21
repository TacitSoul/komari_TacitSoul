import { lazy, Suspense, useState, useEffect, useCallback, useMemo } from 'react';
import { Routes, Route } from 'react-router-dom';
import { EffectsOverlay } from '@/components/EffectsOverlay';
import { Starfield } from '@/components/Starfield';
import { AppHeader } from '@/components/layout/AppHeader';
import { AppFooter } from '@/components/layout/AppFooter';
import { NodesContext } from '@/contexts/NodesContext';
import {
  ViewModeContext,
  getInitialViewMode,
  type ViewMode,
} from '@/contexts/ViewModeContext';
import { useNodes } from '@/hooks/useNodes';
import { useEffects } from '@/hooks/useEffects';
import { useAppConfig } from '@/hooks/useAppConfig';
import { useTheme } from '@/hooks/useTheme';
import { usePrivacyMode } from '@/hooks/usePrivacyMode';
import { useSiteMeta } from '@/hooks/useSiteMeta';
import { useFleetSummary } from '@/hooks/useFleetSummary';
import { pushFleetRate } from '@/lib/fleetRateHistory';
import { safeStorage } from '@/lib/safeStorage';
import { wsService } from '@/services/api';
import { Dashboard } from '@/pages/Dashboard';
import { NodeDetailPage } from '@/pages/NodeDetailPage';
import { NodeNetworkPage } from '@/pages/NodeNetworkPage';

const ThemeSettingsPage = lazy(() => import('@/pages/settings/ThemeSettingsPage'));

function App() {
  const [viewMode, setViewMode] = useState<ViewMode>(getInitialViewMode);

  const { nodes, loading, refreshNodes } = useNodes();
  const { activeEffects } = useEffects();
  const appConfig = useAppConfig();
  const { setDefaultTheme } = useTheme();
  const { maskNodes, setDefaultPrivacyMode } = usePrivacyMode();
  const { siteName, siteDescription, version } = useSiteMeta();
  const fleetSummary = useFleetSummary(nodes);

  const { themeConfig } = appConfig;
  // Keep the page logo in sync with Komari's administrator-uploaded favicon.
  const logoSrc = '/favicon.ico?v=1.0.1';

  useEffect(() => {
    if (!appConfig.loaded) return;
    setDefaultTheme(themeConfig.default_theme);
  }, [appConfig.loaded, themeConfig.default_theme, setDefaultTheme]);

  useEffect(() => {
    if (!appConfig.loaded) return;
    setDefaultPrivacyMode(themeConfig.enable_privacy_mode);
  }, [appConfig.loaded, themeConfig.enable_privacy_mode, setDefaultPrivacyMode]);

  const maskedNodes = useMemo(() => maskNodes(nodes), [maskNodes, nodes]);

  const hubNodeUuid = useMemo<string | null>(() => {
    const target = themeConfig.globe_hub_node?.trim().toLowerCase();
    if (!target) return null;
    const match = nodes.find(n => n.name.trim().toLowerCase() === target);
    return match?.uuid ?? null;
  }, [nodes, themeConfig.globe_hub_node]);

  const handleSetViewMode = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    safeStorage.set('nodeViewMode', mode);
  }, []);

  useEffect(() => {
    if (!appConfig.loaded) return;
    const savedView = safeStorage.get('nodeViewMode');
    const isViewEnabled = (v: ViewMode) => {
      if (v === 'globe') return themeConfig.enable_globe;
      if (v === 'uptime') return themeConfig.enable_uptime;
      if (v === 'matrix') return themeConfig.enable_matrix;
      return true;
    };
    if (!savedView) {
      setViewMode(themeConfig.default_view);
    } else if (!isViewEnabled(viewMode)) {
      handleSetViewMode(themeConfig.default_view);
    }
  }, [
    appConfig.loaded,
    themeConfig.default_view,
    themeConfig.enable_globe,
    themeConfig.enable_uptime,
    themeConfig.enable_matrix,
    viewMode,
    handleSetViewMode,
  ]);

  const { networkStats, avgCpu, cpuSampled, hasCriticalNode } = fleetSummary;

  // Cluster panel charts: one fleet-wide sample per live poll (never from the offline cache).
  useEffect(() => {
    if (!wsService.hasFreshData()) return;
    pushFleetRate(networkStats.totalUp, networkStats.totalDown);
  }, [networkStats.totalUp, networkStats.totalDown]);
  const showFooterMetaOnMobile = Boolean(appConfig.isLoggedIn && version);

  const nodesContextValue = useMemo(
    () => ({ nodes: maskedNodes, loading, refreshNodes, hubNodeUuid }),
    [maskedNodes, loading, refreshNodes, hubNodeUuid],
  );

  const viewModeContextValue = useMemo(
    () => ({ viewMode, setViewMode: handleSetViewMode }),
    [viewMode, handleSetViewMode],
  );

  return (
    <NodesContext.Provider value={nodesContextValue}>
        <ViewModeContext.Provider value={viewModeContextValue}>
          <div className="min-h-dvh flex flex-col text-foreground">
            <AppHeader
              siteName={siteName}
              siteDescription={siteDescription}
              logoSrc={logoSrc}
              hasCriticalNode={hasCriticalNode}
            />

            <main className="flex-1 container mx-auto px-3 sm:px-4 py-5 sm:py-7">
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/node/:uuid" element={<NodeDetailPage />} />
                <Route path="/node/:uuid/network" element={<NodeNetworkPage />} />
                <Route
                  path="/theme-settings"
                  element={
                    <Suspense fallback={null}>
                      <ThemeSettingsPage />
                    </Suspense>
                  }
                />
              </Routes>
            </main>

            <AppFooter
              avgCpu={avgCpu}
              cpuSampled={cpuSampled}
              totalUp={networkStats.totalUp}
              totalDown={networkStats.totalDown}
              version={version}
              customFooter={themeConfig.custom_footer}
              hideCredit={themeConfig.hide_footer_credit}
              showFooterMetaOnMobile={showFooterMetaOnMobile}
            />

            <Starfield />
            <EffectsOverlay activeEffects={activeEffects} />
          </div>
        </ViewModeContext.Provider>
    </NodesContext.Provider>
  );
}

export default App;
