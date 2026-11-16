import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Pause, Play, WifiOff } from 'lucide-react';
import type { NodeWithStatus } from '@/services/api';
import { computeGlobeFleetStats } from '@/lib/globeFleetStats';
import { countUnmappedNodes } from '@/components/earth/earthRegions';

interface GlobeTopStripProps {
  nodes: NodeWithStatus[];
  autoRotate: boolean;
  onStartRotation: () => void;
  onStopRotation: () => void;
}

/** A compact monitoring header; globe rendering and rotation live in GlobeView. */
export const GlobeTopStrip = memo(function GlobeTopStrip({
  nodes,
  autoRotate,
  onStartRotation,
  onStopRotation,
}: GlobeTopStripProps) {
  const { t } = useTranslation();
  const stats = useMemo(() => computeGlobeFleetStats(nodes), [nodes]);
  const unmappedCount = useMemo(() => countUnmappedNodes(nodes), [nodes]);
  const rotationLabel = t(autoRotate ? 'hud.stopRotation' : 'hud.startRotation');

  return (
    <div className="globe-top-strip">
      <h2 className="globe-top-strip-title">{t('hud.overviewTitle')}</h2>

      <div className="globe-top-strip-details">
        {stats.regionCount > 0 && (
          <span className="globe-top-strip-regions">
            {t('hud.overviewRegions', { count: stats.regionCount })}
          </span>
        )}
        {unmappedCount > 0 && (
          <span className="globe-top-strip-status is-unmapped" role="status">
            {t('hud.overviewUnmapped', { count: unmappedCount })}
          </span>
        )}
        {stats.offline > 0 && (
          <span className="globe-top-strip-status is-offline" role="status">
            <WifiOff className="size-3" aria-hidden />
            {t('hud.overviewOffline', { count: stats.offline })}
          </span>
        )}
        {stats.critical > 0 && (
          <span className="globe-top-strip-status is-critical" role="status">
            <AlertTriangle className="size-3" aria-hidden />
            {t('hud.overviewCritical', { count: stats.critical })}
          </span>
        )}
        {nodes.length > 0 && stats.critical === 0 && stats.offline === 0 && (
          <span className="globe-top-strip-status is-healthy" role="status">
            <span className="globe-top-strip-status-dot" aria-hidden />
            {t('hud.overviewHealthy')}
          </span>
        )}
        {nodes.length === 0 && (
          <span className="globe-top-strip-status is-empty">{t('hud.overviewEmpty')}</span>
        )}
      </div>

      <button
        type="button"
        onClick={autoRotate ? onStopRotation : onStartRotation}
        className="globe-rotation-btn"
        data-rotation-state={autoRotate ? 'running' : 'paused'}
        aria-label={rotationLabel}
      >
        {autoRotate ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
        <span>{rotationLabel}</span>
      </button>
    </div>
  );
});
