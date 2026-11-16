import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Landmark } from 'lucide-react';
import type { NodeWithStatus } from '@/services/api';
import { useAppliedAppearance } from '@/hooks/useTheme';
import { useFleetRateHistory } from '@/lib/fleetRateHistory';
import { formatByteRate } from '@/matrix/utils/format';
import { RateChart } from './RateChart';
import '@/matrix/styles/cluster.css';

/** From this many nodes on, one block per node gets too thin; a two-part bar is used instead. */
const SEAMLESS_FROM = 51;

/**
 * online rate with one block per node, and realtime total bandwidth with up / down charts.
 * Always describes the whole fleet (it ignores the group / region filter).
 */
export function ClusterStatusPanel({ nodes, onOpenAssetStats }: { nodes: NodeWithStatus[]; onOpenAssetStats?: () => void }) {
  const { t } = useTranslation();
  const appearance = useAppliedAppearance();
  const history = useFleetRateHistory();

  const summary = useMemo(() => {
    let online = 0;
    let up = 0;
    let down = 0;
    for (const node of nodes) {
      if (node.status !== 'online') continue;
      online += 1;
      up += node.stats?.network.up ?? 0;
      down += node.stats?.network.down ?? 0;
    }
    // Online first, then offline; every block is a real node.
    const blocks = [...nodes].sort((a, b) => Number(b.status === 'online') - Number(a.status === 'online'));
    return { total: nodes.length, online, offline: nodes.length - online, up, down, blocks };
  }, [nodes]);

  const { total, online, offline, up, down, blocks } = summary;
  const onlinePct = total > 0 ? (online / total) * 100 : 0;
  const healthy = total > 0 && offline === 0;
  const totalRate = formatByteRate(up + down);

  return (
    <section className="cluster-panel" aria-labelledby="cluster-panel-title">
      <header className="cluster-head">
        <div className="cluster-title-wrap">
          <h2 id="cluster-panel-title" className="cluster-title">
            <Activity size={17} aria-hidden />
            <span>{t('cluster.title')}</span>
          </h2>
          <p className="cluster-subtitle">{t('cluster.subtitle')}</p>
        </div>
        <div className="cluster-head-actions">
          {onOpenAssetStats && (
            <button type="button" className="cluster-action-btn" onClick={onOpenAssetStats} title={t('assetStats.title')}>
              <Landmark size={13} aria-hidden />
              <span>{t('assetStats.short')}</span>
            </button>
          )}
          <span className={`cluster-pill ${healthy ? 'is-healthy' : 'is-warning'}`}>
            <span className="cluster-dot" />
            {total === 0
              ? t('cluster.notConnected')
              : healthy
                ? t('cluster.healthy')
                : t('cluster.hasOffline', { count: offline })}
          </span>
        </div>
      </header>

      <div className="cluster-body">
        <div className="cluster-section">
          <div className="cluster-section-header">
            <div className="cluster-figure">
              <span className="cluster-big-num">{onlinePct.toFixed(0)}%</span>
              <span className="cluster-unit">{t('cluster.onlineRate')}</span>
            </div>
            <div className="cluster-tag-box">
              <span className="cluster-tag-label">{t('cluster.offlineServers')}</span>
              <span className="cluster-tag-val">{t('cluster.units', { count: offline })}</span>
            </div>
          </div>

          {total >= SEAMLESS_FROM ? (
            <div
              className="cluster-seamless"
              role="progressbar"
              aria-valuenow={Math.round(onlinePct)}
              aria-valuemin={0}
              aria-valuemax={100}
              title={`${t('status.online')} ${online} · ${t('status.offline')} ${offline}`}
            >
              <div className="cluster-seamless-segment is-online" style={{ width: `${onlinePct}%` }} />
              {offline > 0 && (
                <div className="cluster-seamless-segment is-offline" style={{ width: `${(offline / total) * 100}%` }} />
              )}
            </div>
          ) : (
            <div className="cluster-blocks" role="list" aria-label={t('cluster.nodes')}>
              {total > 0 ? (
                blocks.map((node) => {
                  const isOnline = node.status === 'online';
                  return (
                    <span
                      key={node.uuid}
                      role="listitem"
                      className={`cluster-block ${isOnline ? 'is-online' : 'is-offline'}`}
                      title={`${node.name} · ${isOnline ? t('status.online') : t('status.offline')}`}
                    />
                  );
                })
              ) : (
                <span className="cluster-block is-unknown" />
              )}
            </div>
          )}

          <div className="cluster-section-footer">
            <span>{t('cluster.onlineCount', { count: online })}</span>
            <span>{t('cluster.totalCount', { count: total })}</span>
          </div>
        </div>

        <div className="cluster-section cluster-network">
          <div className="cluster-section-header">
            <div className="cluster-figure">
              <span className="cluster-big-num">{totalRate.value}</span>
              <span className="cluster-unit">
                {totalRate.unit} {t('cluster.totalBandwidth')}
              </span>
            </div>
          </div>
          <div className="cluster-charts">
            <RateChart points={history} field="up" rate={up} appearance={appearance} />
            <RateChart points={history} field="down" rate={down} appearance={appearance} />
          </div>
        </div>
      </div>
    </section>
  );
}
