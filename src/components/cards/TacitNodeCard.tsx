import { memo, useCallback, useMemo, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ChartLine, Folder, MessageSquareText } from 'lucide-react';
import dayjs from 'dayjs';
import type { NodeWithStatus } from '@/services/api';
import { FlagIcon } from '@/components/FlagIcon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatUptime, getRegionDisplayName } from '@/lib/utils';
import { formatBytes } from '@/matrix/utils/format';
import { parseTagList, type TagColor } from '@/lib/parseTags';
import { OsLogo, resolveOsInfo } from '@/matrix/components/ui/OsLogo';
import { useMinuteClock } from '@/matrix/hooks/useClock';
import { useNodeLatency } from '@/matrix/hooks/useNodeLatency';
import { formatPriceLabel } from './billing';
import {
  daysUntil,
  expireStatus,
  expireTone,
  normalizeLimitType,
  percentOf,
  trafficBar,
  trafficUsed,
  usageStatus,
  type UsageStatus,
} from './cardFormat';
import { PingSummary } from './PingSummary';

/*
 *   header      flag + name · latency-chart button + OS logo
 *   resources   CPU (with load 1/5/15), memory, disk, traffic in a 2×2 grid of capsule bars
 *   ping        last-hour latency / packet-loss curves + live upload / download
 *   tags        node tags, group, remark (on hover), expiry and price chips
 *   offline     overlay with name, last-online time and tags; hover reveals the last snapshot
 */

export interface TacitCardOptions {
  /** Price chip visible (logged in, or the "show price to visitors" setting). */
  showPrice: boolean;
  /** Group chip on the card. */
  showGroup: boolean;
  /** 2×2 or single-column resource bars. */
  singleColumn: boolean;
  /** Upload / download coloured separately in the traffic hint. */
  splitTrafficColor: boolean;
  /** Logged-in visitors also see the private remark in the hover hint. */
  isLoggedIn: boolean;
}

const TAG_TONE: Record<TagColor, string> = {
  red: 'var(--tag-red-fg)',
  amber: 'var(--tag-amber-fg)',
  green: 'var(--tag-green-fg)',
  cyan: 'var(--tag-cyan-fg)',
  blue: 'var(--tag-blue-fg)',
  violet: 'var(--tag-violet-fg)',
  pink: 'var(--tag-pink-fg)',
  gray: 'var(--tag-gray-fg)',
};

const EXPIRE_TONE = {
  bad: 'var(--ts-status-error)',
  warn: 'var(--ts-status-warning)',
  ok: 'var(--ts-status-success)',
  muted: 'var(--muted-foreground)',
} as const;

interface Chip {
  key: string;
  text: string;
  color?: string;
  icon?: 'group' | 'remark';
  title?: string;
}

function Bar({ pct, status }: { pct: number; status: UsageStatus }) {
  return (
    <div className="mcard-bar" role="presentation">
      <div
        className={`mcard-bar-fill is-end is-${status}${pct > 0 ? ' is-min' : ''}`}
        style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
      />
    </div>
  );
}

function ChipList({ chips }: { chips: Chip[] }) {
  return (
    <span className="mcard-tags">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className={chip.color ? 'mcard-chip' : 'mcard-chip is-neutral'}
          style={chip.color ? ({ '--chip': chip.color } as CSSProperties) : undefined}
          title={chip.title ?? chip.text}
        >
          {chip.icon === 'group' && <Folder size={14} aria-hidden />}
          {chip.icon === 'remark' && <MessageSquareText size={14} aria-hidden />}
          <span>{chip.text}</span>
        </span>
      ))}
    </span>
  );
}

export const TacitNodeCard = memo(function TacitNodeCard({
  node,
  options,
  onOpenChart,
}: {
  node: NodeWithStatus;
  options: TacitCardOptions;
  onOpenChart?: (uuid: string, name: string) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const now = useMinuteClock();
  const latency = useNodeLatency(node.uuid);

  const online = node.status === 'online';
  // Offline nodes show their last snapshot (behind the overlay) — never fabricated numbers.
  const stats = online ? node.stats : node.lastStats;

  const cpu = stats?.cpu.usage ?? 0;
  const memTotal = stats?.ram.total || node.mem_total;
  const diskTotal = stats?.disk.total || node.disk_total;
  const memPct = percentOf(stats?.ram.used ?? 0, memTotal);
  const diskPct = percentOf(stats?.disk.used ?? 0, diskTotal);

  const up = stats?.network.totalUp ?? 0;
  const down = stats?.network.totalDown ?? 0;
  const limit = node.traffic_limit ?? 0;
  const limitType = normalizeLimitType(node.traffic_limit_type);
  const bar = trafficBar(up, down, limit, limitType);
  const hasLimit = limit > 0;

  const chips = useMemo<Chip[]>(() => {
    const list: Chip[] = parseTagList(node.tags).map((tag, index) => ({
      key: `tag-${index}`,
      text: tag.label,
      color: tag.color ? TAG_TONE[tag.color] : undefined,
    }));
    if (options.showGroup && node.group) list.push({ key: 'group', text: node.group, icon: 'group' });
    const status = expireStatus(node.expired_at, now);
    if (status !== 'none' && (node.price !== 0 || options.isLoggedIn)) {
      const color = EXPIRE_TONE[expireTone(status)];
      const text =
        status === 'expired'
          ? t('mcard.expired')
          : status === 'long_term'
            ? t('mcard.longTerm')
            : t('mcard.daysLeft', { count: daysUntil(node.expired_at, now) });
      list.push({ key: 'expiry', text, color, title: dayjs(node.expired_at).format('YYYY-MM-DD') });
    }
    if (options.showPrice) {
      const price = formatPriceLabel(node.price, node.currency, node.billing_cycle, t);
      if (price) list.push({ key: 'price', text: price, color: 'var(--primary)' });
    }
    return list;
  }, [node.tags, node.group, node.expired_at, node.price, node.currency, node.billing_cycle, options, now, t]);

  const os = resolveOsInfo(node.os);
  const detailLines = [
    `${os.name}${node.arch ? ` / ${node.arch}` : ''}${node.virtualization ? ` · ${node.virtualization}` : ''}`,
    node.cpu_name ? `${node.cpu_name}${node.cpu_cores ? ` (${node.cpu_cores}C)` : ''}` : null,
    online && stats ? `${t('label.uptime')}: ${formatUptime(stats.uptime, 'minute')}` : null,
    node.public_remark ? `${t('label.remark')}: ${node.public_remark}` : null,
    options.isLoggedIn && node.remark ? `${t('label.privateRemark')}: ${node.remark}` : null,
  ].filter((line): line is string => Boolean(line));

  const open = useCallback(() => navigate(`/node/${node.uuid}`), [navigate, node.uuid]);
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    },
    [open],
  );
  const openChart = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation();
      onOpenChart?.(node.uuid, node.name);
    },
    [node.name, node.uuid, onOpenChart],
  );

  const lastOnline = node.lastSeenAt ?? node.lastStats?.updated_at;
  const regionName = getRegionDisplayName(node.region) || undefined;

  return (
    <article
      data-node-uuid={node.uuid}
      className={`mcard ${online ? 'is-online' : 'is-offline'}`}
      role="link"
      tabIndex={0}
      aria-label={node.name}
      onClick={open}
      onKeyDown={onKeyDown}
    >
      <header className="mcard-head">
        <div className="mcard-identity">
          <FlagIcon region={node.region} size={22} className="mcard-flag" title={regionName} />
          <h3 className="mcard-name" title={node.name}>
            {node.name}
          </h3>
        </div>
        <div className="mcard-actions">
          {onOpenChart && (
            <button
              type="button"
              className="mcard-icon-btn"
              title={t('mcard.latencyChart')}
              aria-label={t('mcard.latencyChart')}
              onClick={openChart}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <ChartLine size={20} aria-hidden />
            </button>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="mcard-os" onClick={(event) => event.stopPropagation()}>
                <OsLogo value={node.os} size={26} />
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="mcard-tip max-w-xs text-xs">
              {detailLines.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </TooltipContent>
          </Tooltip>
        </div>
      </header>

      <div className="mcard-content">
        {!online && (
          <div className="mcard-offline" aria-hidden>
            <div className="mcard-offline-content">
              <div className="mcard-offline-title">
                <FlagIcon region={node.region} size={18} className="mcard-flag" />
                <span>{node.name}</span>
              </div>
              <strong>{t('mcard.offline')}</strong>
              <span className="mcard-num">
                {lastOnline
                  ? t('mcard.lastOnline', { time: dayjs(lastOnline).format('YYYY-MM-DD HH:mm:ss') })
                  : t('mcard.neverOnline')}
              </span>
              {chips.length > 0 && <ChipList chips={chips} />}
            </div>
          </div>
        )}

        <div className="mcard-body">
          <div className={`mcard-resources${options.singleColumn ? ' is-single' : ''}`}>
            <div className="mcard-res">
              <div className="mcard-res-head">
                <span className="mcard-label">CPU</span>
                <span className="mcard-num">{cpu.toFixed(1)}%</span>
              </div>
              <Bar pct={cpu} status={usageStatus(cpu)} />
              <span className="mcard-hint mcard-num" title={t('mcard.loadTitle')}>
                {stats
                  ? `${stats.load.load1.toFixed(2)}, ${stats.load.load5.toFixed(2)}, ${stats.load.load15.toFixed(2)}`
                  : '—'}
              </span>
            </div>

            <div className="mcard-res">
              <div className="mcard-res-head">
                <span className="mcard-label">{t('mcard.memory')}</span>
                <span className="mcard-num">{memPct.toFixed(1)}%</span>
              </div>
              <Bar pct={memPct} status={usageStatus(memPct)} />
              <span className="mcard-hint mcard-num">
                {formatBytes(stats?.ram.used ?? 0)} / {formatBytes(memTotal)}
              </span>
            </div>

            <div className="mcard-res">
              <div className="mcard-res-head">
                <span className="mcard-label">{t('mcard.disk')}</span>
                <span className="mcard-num">{diskPct.toFixed(1)}%</span>
              </div>
              <Bar pct={diskPct} status={usageStatus(diskPct)} />
              <span className="mcard-hint mcard-num">
                {formatBytes(stats?.disk.used ?? 0)} / {formatBytes(diskTotal)}
              </span>
            </div>

            <div className="mcard-res">
              <div className="mcard-res-head">
                <span className="mcard-label">{t('mcard.traffic')}</span>
                <span className="mcard-num">{hasLimit ? `${bar.totalPct.toFixed(1)}%` : '∞'}</span>
              </div>
              <div className="mcard-bar" role="presentation">
                {bar.dual ? (
                  <>
                    <div className={`mcard-bar-fill is-up${bar.upPct > 0 ? ' is-min' : ''}`} style={{ width: `${bar.upPct}%` }} />
                    <div
                      className={`mcard-bar-fill is-down is-end${bar.downPct > 0 ? ' is-min' : ''}`}
                      style={{ width: `${bar.downPct}%` }}
                    />
                  </>
                ) : (
                  <div
                    className={`mcard-bar-fill is-end is-${bar.singleColor}${bar.totalPct > 0 ? ' is-min' : ''}`}
                    style={{ width: `${bar.totalPct}%` }}
                  />
                )}
              </div>
              <span className="mcard-hint mcard-num">
                {hasLimit ? (
                  `${formatBytes(trafficUsed(up, down, limitType))} / ${formatBytes(limit)}`
                ) : (
                  <>
                    <span className={options.splitTrafficColor ? 'is-up' : undefined}>↑ {formatBytes(up)}</span>
                    <span className="mcard-split" />
                    <span className={options.splitTrafficColor ? 'is-down' : undefined}>↓ {formatBytes(down)}</span>
                  </>
                )}
              </span>
            </div>
          </div>

          <PingSummary latency={latency} up={online ? stats?.network.up ?? 0 : 0} down={online ? stats?.network.down ?? 0 : 0} />

          {chips.length > 0 && (
            <div className="mcard-row is-tags" aria-label={t('mcard.tags')}>
              <ChipList chips={chips} />
            </div>
          )}
        </div>
      </div>
    </article>
  );
});
