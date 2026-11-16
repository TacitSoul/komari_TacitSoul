import { lazy, Suspense, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { HudSpinner } from './HudSpinner';
import { Landmark } from 'lucide-react';
import type { NodeWithStatus } from '@/services/api';
import { useAppConfig } from '@/hooks/useAppConfig';
import { AssetStatsPanel } from './AssetStatsPanel';
import { ClusterStatusPanel } from './fleet/ClusterStatusPanel';
import { FleetFilterBars } from './fleet/FleetFilterBars';
import { filterByGroupAndRegion } from '@/lib/fleetFilterNodes';
import { useFleetFilter } from '@/lib/fleetFilter';

const MatrixGrid = lazy(() => import('@/matrix/MatrixGrid'));
const TacitCardGrid = lazy(() => import('@/components/cards/TacitCardGrid'));
const TacitNodeTable = lazy(() => import('@/components/table/TacitNodeTable'));

interface NodeListProps {
  nodes?: NodeWithStatus[];
  loading?: boolean;
  defaultView?: 'grid' | 'matrix' | 'table';
  /** Opens the chart modal on the latency tab (card view's chart button). */
  onOpenChart?: (uuid: string, name: string) => void;
}

export function NodeList({ nodes = [], loading = false, defaultView = 'grid', onOpenChart }: NodeListProps) {
  const { t } = useTranslation();
  const { isLoggedIn, themeConfig } = useAppConfig();
  const showAssetStats = themeConfig.enable_asset_stats && isLoggedIn;
  const [assetStatsOpen, setAssetStatsOpen] = useState(false);
  const fleetFilter = useFleetFilter();

  // Group tabs + region bar only filter the canonical backend-ordered list.
  // Do not introduce a second tie-break after the API has restored admin order.
  const sortedNodes = useMemo(
    () => filterByGroupAndRegion(nodes, fleetFilter.group, fleetFilter.region),
    [nodes, fleetFilter.group, fleetFilter.region],
  );
  const matrixUuids = useMemo(() => sortedNodes.map(node => node.uuid), [sortedNodes]);
  const skeletonCardWidths = [58, 74, 66, 82, 62, 70];

  if (loading) {
    return (
      <div className="space-y-4 sm:space-y-5">
        {/* Skeleton card grid */}
        <div className="relative">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl border border-border/50 bg-card/80 backdrop-blur-xl overflow-hidden hud-corners relative"
                style={{ animationDelay: `${i * 120}ms` }}
              >
                {/* Skeleton header */}
                <div className="flex items-center gap-2.5 px-3 py-2 border-b border-border/30 bg-muted/10">
                  <div className="w-2 h-2 rounded-full bg-muted/40 motion-safe:animate-pulse" />
                  <div className="h-3.5 rounded bg-muted/25 motion-safe:animate-pulse" style={{ width: `${skeletonCardWidths[i % skeletonCardWidths.length]}%` }} />
                </div>
                {/* Skeleton content */}
                <div className="px-3 py-3 space-y-2.5">
                  {/* Gauge bars */}
                  {[0.7, 0.5, 0.6].map((w, j) => (
                    <div key={j} className="space-y-1">
                      <div className="flex justify-between">
                        <div className="h-2.5 w-8 rounded bg-muted/20 motion-safe:animate-pulse" />
                        <div className="h-2.5 w-10 rounded bg-muted/20 motion-safe:animate-pulse" />
                      </div>
                      <div className="h-1.5 rounded-full bg-muted/15 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary/15 motion-safe:animate-pulse hud-skeleton-bar"
                          style={{ width: `${w * 100}%`, animationDelay: `${(i * 3 + j) * 150}ms` }}
                        />
                      </div>
                    </div>
                  ))}
                  {/* Data cells */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 pt-1">
                    {[0, 1, 2, 3].map(j => (
                      <div key={j} className="text-center p-1.5 rounded bg-muted/10 border border-border/15">
                        <div className="h-2 w-6 mx-auto rounded bg-muted/20 motion-safe:animate-pulse mb-1" />
                        <div className="h-3 w-10 mx-auto rounded bg-muted/15 motion-safe:animate-pulse" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Center spinner overlay */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-background/60 backdrop-blur-sm rounded-2xl p-6">
              <HudSpinner size="lg" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      {themeConfig.enable_cluster_panel && nodes.length > 0 && (
        <ClusterStatusPanel nodes={nodes} onOpenAssetStats={showAssetStats ? () => setAssetStatsOpen(true) : undefined} />
      )}
      {!themeConfig.enable_cluster_panel && showAssetStats && (
        <div className="flex justify-end">
          <button type="button" onClick={() => setAssetStatsOpen(true)} className="cluster-action-btn" title={t('assetStats.title')}>
            <Landmark className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{t('assetStats.short')}</span>
          </button>
        </div>
      )}
      <FleetFilterBars nodes={nodes} />

      {/* Node list content */}
      {nodes.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 rounded-lg border border-dashed border-border/50 bg-card/80 backdrop-blur-xl px-4 text-center">
          <div className="flex flex-col items-center gap-2 max-w-sm">
            <span className="text-sm font-display font-bold text-muted-foreground/60 uppercase tracking-widest no-signal-pulse">{t('hud.noSignal')}</span>
            <div className="text-xs text-muted-foreground">{t('node.noNodesAvailable')}</div>
            <div className="text-xs text-muted-foreground/60">{t('node.addFromAdmin')}</div>
          </div>
        </div>
      ) : (
        <Suspense fallback={<div className="h-64" aria-busy />}>
          {defaultView === 'grid' ? (
            <TacitCardGrid nodes={sortedNodes} allNodes={nodes} onOpenChart={onOpenChart} />
          ) : defaultView === 'matrix' ? (
            <MatrixGrid nodes={nodes} uuids={matrixUuids} />
          ) : (
            <TacitNodeTable nodes={sortedNodes} allNodes={nodes} />
          )}
        </Suspense>
      )}
      {assetStatsOpen && (
        <AssetStatsPanel nodes={nodes} onClose={() => setAssetStatsOpen(false)} />
      )}
    </div>
  );
}
