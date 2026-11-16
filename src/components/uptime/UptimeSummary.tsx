import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowDown01, CheckCircle2, RefreshCw } from 'lucide-react';
import type { NodeWithStatus } from '@/services/api';
import { summarizeUptime, type UptimeMeasurement } from '@/lib/uptime-utils';
import { cn, formatUptime } from '@/lib/utils';
import './uptime-summary.css';

/**
 * Availability summary at the top of the uptime view:
 *  - ring gauge with the fleet's average availability against the SLO target,
 *  - verdict + four equal-weight metrics (nodes at target, online now, downtime, last outage),
 *  - one fleet-wide timeline (per slot: how many nodes were down),
 *  - range switch, sort and refresh on the right of the title row.
 */
export interface UptimeSummaryProps {
  nodes: NodeWithStatus[];
  results: Map<string, UptimeMeasurement>;
  sloThreshold: number;
  ranges: Array<{ hours: number; label: string }>;
  rangeIdx: number;
  onRangeChange: (idx: number) => void;
  sortByUptime: boolean;
  onToggleSort: () => void;
  onRefresh: () => void;
  loading: boolean;
  loadProgress: number;
}

function toneFor(pct: number | null, slo: number): 'ok' | 'warn' | 'bad' | 'none' {
  if (pct === null) return 'none';
  if (pct >= slo) return 'ok';
  if (pct >= 95) return 'warn';
  return 'bad';
}

function formatSlotTime(ts: number, hours: number): string {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  return hours <= 24 ? `${hh}:00` : `${mm}-${dd} ${hh}:00`;
}

export const UptimeSummary = memo(function UptimeSummary({
  nodes,
  results,
  sloThreshold,
  ranges,
  rangeIdx,
  onRangeChange,
  sortByUptime,
  onToggleSort,
  onRefresh,
  loading,
  loadProgress,
}: UptimeSummaryProps) {
  const { t } = useTranslation();
  const range = ranges[Math.min(rangeIdx, ranges.length - 1)];

  const stats = useMemo(() => summarizeUptime(nodes.map(n => n.uuid), results, sloThreshold), [nodes, results, sloThreshold]);

  const online = useMemo(() => nodes.filter((n) => n.status === 'online').length, [nodes]);
  const total = nodes.length;
  const tone = loading && stats.avg === null ? 'none' : toneFor(stats.avg, sloThreshold);
  const pct = stats.avg ?? 0;
  // Ring: 0–100 % mapped onto the circumference; the SLO target as a tick.
  const R = 52;
  const C = 2 * Math.PI * R;
  const filled = stats.avg === null ? 0 : Math.max(0, Math.min(1, pct / 100));

  const verdict =
    stats.avg === null
      ? loading
        ? t('uptime.loading')
        : t('uptime.noDataAvailable')
      : tone === 'ok'
        ? t('uptime.allSystemsOperational')
        : t('uptime.degradedPerformance');

  const lastIncidentText =
    stats.lastIncident === null
      ? t('uptime.lastIncidentNone')
      : formatUptime(Math.max(60, (Date.now() - stats.lastIncident) / 1000), 'minute', 1);

  return (
    <section className={cn('uptime-summary', `is-${tone}`)} aria-labelledby="uptime-summary-title">
      {loadProgress < 1 && total > 0 && (
        <div className="uptime-summary-progress" style={{ width: `${loadProgress * 100}%` }} aria-hidden />
      )}

      <div className="uptime-summary-main">
        {/* gauge */}
        <div className="uptime-gauge" role="img" aria-label={`${t('uptime.availability')} ${stats.avg === null ? '—' : pct.toFixed(2) + '%'}`}>
          <svg viewBox="0 0 128 128" aria-hidden>
            <circle className="uptime-gauge-track" cx="64" cy="64" r={R} />
            <circle
              className="uptime-gauge-fill"
              cx="64"
              cy="64"
              r={R}
              strokeDasharray={`${filled * C} ${C}`}
              transform="rotate(-90 64 64)"
            />
            {/* target notch, only while below target (at 100 % it would sit on the ring's seam) */}
            {stats.avg !== null && pct < sloThreshold && (
              <line
                className="uptime-gauge-tick"
                x1="64"
                y1="2"
                x2="64"
                y2="8"
                transform={`rotate(${(sloThreshold / 100) * 360} 64 64)`}
              />
            )}
          </svg>
          <div className="uptime-gauge-center">
            <span className="uptime-gauge-value">
              {stats.avg === null ? '—' : pct >= 99.995 ? '100' : pct.toFixed(2)}
              {stats.avg !== null && <small>%</small>}
            </span>
            <span className="uptime-gauge-caption">
              <span>{t('uptime.availability')}</span>
              <span>{range.label}</span>
            </span>
          </div>
        </div>

        {/* verdict + metrics */}
        <div className="uptime-summary-body">
          <div className="uptime-summary-head">
            <div className="uptime-summary-verdict">
              <span className="uptime-gauge-inline" aria-hidden>
                <svg viewBox="0 0 128 128">
                  <circle className="uptime-gauge-track" cx="64" cy="64" r={R} />
                  <circle className="uptime-gauge-fill" cx="64" cy="64" r={R} strokeDasharray={`${filled * C} ${C}`} transform="rotate(-90 64 64)" />
                </svg>
                <span>{stats.avg === null ? '—' : pct >= 99.995 ? '100%' : `${pct.toFixed(1)}%`}</span>
              </span>
              <span className="uptime-verdict-icon" aria-hidden>
                {tone === 'ok' ? <CheckCircle2 size={18} /> : tone === 'none' ? <RefreshCw size={16} className={loading ? 'motion-safe:animate-spin' : ''} /> : <AlertTriangle size={18} />}
              </span>
              <div className="min-w-0">
                <h2 id="uptime-summary-title" className="uptime-verdict-title">{verdict}</h2>
                <p className="uptime-verdict-sub">
                  {t('uptime.target')} {sloThreshold}% ·{' '}
                  {stats.loaded < total ? t('uptime.loadingProgress', { loaded: stats.loaded, total }) : t('uptime.monitor')}
                </p>
                {stats.failed > 0 && (
                  <p className="uptime-verdict-sub" role="status">
                    {t('uptime.failedNodes', { count: stats.failed })}{' '}
                    <button type="button" className="rounded underline focus-visible:outline-2 focus-visible:outline-ring" onClick={onRefresh}>
                      {t('action.retry')}
                    </button>
                  </p>
                )}
              </div>
            </div>

            <div className="uptime-summary-controls">
              <div className="uptime-range" role="radiogroup" aria-label={t('uptime.monitor')}>
                {ranges.map((r, idx) => (
                  <button
                    key={r.label}
                    type="button"
                    role="radio"
                    aria-checked={idx === rangeIdx}
                    className={cn(idx === rangeIdx && 'is-active')}
                    onClick={() => onRangeChange(idx)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className={cn('uptime-icon-btn', sortByUptime && 'is-active')}
                onClick={onToggleSort}
                aria-pressed={sortByUptime}
                title={sortByUptime ? t('uptime.sortByWeight') : t('uptime.sortByUptime')}
              >
                <ArrowDown01 size={15} />
              </button>
              <button type="button" className="uptime-icon-btn" onClick={onRefresh} title={t('action.refresh')}>
                <RefreshCw size={14} className={loading ? 'motion-safe:animate-spin' : ''} />
              </button>
            </div>
          </div>

          <dl className="uptime-metrics">
            <div className="uptime-metric">
              <dt>{t('uptime.healthyNodes')}</dt>
              <dd>
                <strong>{stats.atTarget}</strong>
                <span>/ {stats.measured}</span>
              </dd>
            </div>
            <div className="uptime-metric">
              <dt>{t('uptime.online')}</dt>
              <dd className={online < total ? 'is-bad' : undefined}>
                <strong>{online}</strong>
                <span>/ {total}</span>
              </dd>
            </div>
            <div className="uptime-metric">
              <dt>{t('uptime.downtime')}</dt>
              <dd className={stats.downtimeHours > 0 ? 'is-bad' : 'is-empty'}>
                <strong>{stats.downtimeHours > 0 ? formatUptime(stats.downtimeHours * 3600, 'hour', 2) : t('uptime.downtimeNone')}</strong>
              </dd>
            </div>
            <div className="uptime-metric">
              <dt>{t('uptime.lastIncident')}</dt>
              <dd className={stats.lastIncident === null ? 'is-empty' : undefined}>
                <strong>{lastIncidentText}</strong>
              </dd>
            </div>
          </dl>

          {/* fleet timeline: one cell per slot, coloured by how much of the fleet was down */}
          <div className="uptime-fleet">
            <div className="uptime-fleet-label">
              <span>{t('uptime.fleetTimeline')}</span>
              {/* one entry per cell state the bar can show */}
              <span className="uptime-fleet-legend">
                <span><i className="is-ok" />{t('uptime.slotOk')}</span>
                <span><i className="is-partial" />{t('uptime.legendPartial')}</span>
                <span><i className="is-bad" />{t('uptime.legendOffline')}</span>
                <span><i className="is-none" />{t('uptime.slotNoData')}</span>
              </span>
            </div>
            <div className="uptime-fleet-bar">
              {stats.fleet.length > 0
                ? stats.fleet.map((cell) => {
                    const state = cell.total === 0 ? 'none' : cell.down === 0 ? 'ok' : cell.down >= cell.total && !cell.partial ? 'bad' : 'partial';
                    const label =
                      cell.total === 0
                        ? t('uptime.slotNoData')
                        : cell.down === 0
                          ? t('uptime.slotOk')
                          : t('uptime.slotPartial', { down: cell.down, total: cell.total });
                    return (
                      <span
                        key={cell.start}
                        className={`uptime-fleet-cell is-${state}`}
                        title={`${formatSlotTime(cell.start, range.hours)} · ${label}`}
                      />
                    );
                  })
                : Array.from({ length: 24 }).map((_, i) => <span key={i} className="uptime-fleet-cell is-none" />)}
            </div>
            <div className="uptime-fleet-axis" aria-hidden>
              <span>{stats.fleet.length > 0 ? formatSlotTime(stats.fleet[0].start, range.hours) : ''}</span>
              <span>{t('time.now')}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
});
