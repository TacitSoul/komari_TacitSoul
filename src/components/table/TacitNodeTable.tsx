import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { MessageSquareText } from 'lucide-react';
import {
  createColumnHelper,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import dayjs from 'dayjs';
import type { NodeWithStatus } from '@/services/api';
import { FlagIcon } from '@/components/FlagIcon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAppConfig } from '@/hooks/useAppConfig';
import { useIsMobile } from '@/hooks/useIsMobile';
import { formatUptime, getRegionDisplayName } from '@/lib/utils';
import { parseTagList, type TagColor } from '@/lib/parseTags';
import { OsLogo } from '@/matrix/components/ui/OsLogo';
import { useMinuteClock } from '@/matrix/hooks/useClock';
import { usePingStoreVersion } from '@/matrix/hooks/usePingOverview';
import {
  readNodeLatestLatency,
  useLatencyFeed,
  useNodeLatency,
  type NodeLatencySummary,
} from '@/matrix/hooks/useNodeLatency';
import { useThemeSettings } from '@/matrix/hooks/useThemeSettings';
import { formatLatency, latencyHeatColor } from '@/matrix/utils/latencyScale';
import { canViewCosts } from '@/matrix/utils/themeSettings';
import { formatPriceLabel } from '@/components/cards/billing';
import { daysUntil, expireStatus, formatCompactRate, percentOf } from '@/components/cards/cardFormat';
import {
  LATENCY_BLOCKS,
  SEGMENTS,
  capacityTier,
  cpuTier,
  filledSegments,
  osArchLabel,
  trafficCell,
  type MetricTier,
} from './tableFormat';
import './tacit-table.css';

/*
 * tags), system + uptime, CPU / memory / disk as 10-segment bracketed bars, latency with history
 * blocks, bandwidth, traffic with its limit-type badge, expiry. Sorting (react-table) and window
 * virtualisation are kept from the base theme. Latency comes from the shared store, so the table,
 * cards and matrix agree; nodes without a probe show "not configured".
 */

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

interface RowOptions {
  showLatency: boolean;
  showPrice: boolean;
  isLoggedIn: boolean;
  now: number;
}

const segmentIndexes = Array.from({ length: SEGMENTS }, (_, i) => i);

function MetricBar({ pct, tier }: { pct: number; tier: MetricTier }) {
  const filled = filledSegments(pct);
  const tierClass = tier === 'normal' ? '' : ` is-${tier}`;
  return (
    <span className="ztable-metric">
      <span className={`ztable-metric-value${tierClass}`}>{Math.max(0, Math.min(100, pct)).toFixed(1)}%</span>
      <span className="ztable-track" aria-hidden>
        <span className="ztable-segments" style={{ gridTemplateColumns: `repeat(${SEGMENTS}, minmax(0, 1fr))` }}>
          {segmentIndexes.map((i) => (
            <span key={i} className={`ztable-seg${i < filled ? ` is-on${tierClass}` : ''}`} />
          ))}
        </span>
      </span>
    </span>
  );
}

function clock(ms: number | null) {
  return ms == null ? '' : dayjs(ms).format('HH:mm');
}

function LatencyCell({ uuid, online }: { uuid: string; online: boolean }) {
  const { t } = useTranslation();
  const latency: NodeLatencySummary = useNodeLatency(uuid, LATENCY_BLOCKS);
  if (!latency.configured) return <span className="ztable-dim">{t('mcard.notConfiguredShort')}</span>;
  if (!online) return <span className="ztable-dim">—</span>;
  if (latency.loading && latency.latest == null) return <span className="ztable-dim">{t('mcard.loading')}</span>;

  const value = latency.latest ?? latency.avgLatency;
  const withData = latency.buckets.filter((bucket) => bucket.value != null).length;
  const label = t('ztable.latencyHistory', { count: withData });
  return (
    <span
      className="ztable-metric ztable-blocks"
      title={latency.taskName ? `${latency.taskName} · ${t('mcard.lastHour')}` : t('mcard.lastHour')}
    >
      <span
        className="ztable-metric-value ztable-latency-value"
        style={value != null ? ({ '--tt-value': latencyHeatColor(value) } as CSSProperties) : undefined}
      >
        {formatLatency(value)}
      </span>
      <span className="ztable-track" role="img" aria-label={label}>
        <span className="ztable-segments" style={{ gridTemplateColumns: `repeat(${LATENCY_BLOCKS}, minmax(0, 1fr))` }}>
          {latency.buckets.map((bucket) => {
            const has = bucket.value != null;
            return (
              <span
                key={bucket.index}
                className="ztable-seg-slot"
                title={
                  has
                    ? `${clock(bucket.startAt)}–${clock(bucket.endAt)} · ${formatLatency(bucket.value)}${
                        bucket.loss ? ` · ${t('ztable.loss', { value: bucket.loss.toFixed(1) })}` : ''
                      }`
                    : undefined
                }
              >
                <span
                  className={`ztable-block${has ? ' has-data' : ''}`}
                  style={has ? ({ '--tt-block': latencyHeatColor(bucket.value) } as CSSProperties) : undefined}
                />
              </span>
            );
          })}
        </span>
      </span>
    </span>
  );
}

function TagLine({ tags, max = 2 }: { tags: string; max?: number }) {
  const list = parseTagList(tags);
  if (list.length === 0) return null;
  const shown = list.slice(0, max);
  const hidden = list.slice(max);
  return (
    <div className="ztable-tags">
      {shown.map((tag, index) => (
        <span key={`${index}-${tag.label}`} style={{ display: 'contents' }}>
          {index > 0 && (
            <span className="ztable-tag-sep" aria-hidden>
              /
            </span>
          )}
          <span
            className="ztable-tag"
            title={tag.label}
            style={tag.color ? ({ '--tt-tag': TAG_TONE[tag.color] } as CSSProperties) : undefined}
          >
            {tag.label}
          </span>
        </span>
      ))}
      {hidden.length > 0 && (
        <span className="ztable-tag-more" title={hidden.map((tag) => tag.label).join(' / ')}>
          +{hidden.length}
        </span>
      )}
    </div>
  );
}

function Remark({ node, isLoggedIn }: { node: NodeWithStatus; isLoggedIn: boolean }) {
  const { t } = useTranslation();
  const lines = [
    node.public_remark ? `${t('label.remark')}: ${node.public_remark}` : null,
    isLoggedIn && node.remark ? `${t('label.privateRemark')}: ${node.remark}` : null,
  ].filter((line): line is string => Boolean(line));
  if (lines.length === 0) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="ztable-remark"
          role="button"
          tabIndex={0}
          aria-label={t('label.remark')}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <MessageSquareText size={14} aria-hidden />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs whitespace-pre-line text-xs">
        {lines.join('\n')}
      </TooltipContent>
    </Tooltip>
  );
}

function NameCell({ node, isLoggedIn }: { node: NodeWithStatus; isLoggedIn: boolean }) {
  const { t } = useTranslation();
  const online = node.status === 'online';
  return (
    <div className="ztable-name">
      <div className="ztable-name-line">
        <FlagIcon region={node.region} size={14} className="ztable-flag" title={getRegionDisplayName(node.region) || undefined} />
        <span className="ztable-name-text" title={node.name}>
          {node.name}
        </span>
        {!online && <span className="ztable-offline-badge">▲ {t('mcard.offlineShort')}</span>}
        <Remark node={node} isLoggedIn={isLoggedIn} />
      </div>
      <TagLine tags={node.tags} />
    </div>
  );
}

function SystemCell({ node }: { node: NodeWithStatus }) {
  const { t } = useTranslation();
  const online = node.status === 'online';
  const uptime = online && node.stats ? formatUptime(node.stats.uptime, 'minute') : '—';
  return (
    <div className="ztable-sys">
      <span className="ztable-sys-line">
        <OsLogo value={node.os} size={16} />
        <span>{osArchLabel(node.os, node.arch)}</span>
      </span>
      <span className="ztable-caption">
        {t('ztable.uptime')}: {uptime}
      </span>
    </div>
  );
}

function TrafficValue({ node }: { node: NodeWithStatus }) {
  const stats = node.status === 'online' ? node.stats : node.lastStats;
  const cell = trafficCell(stats?.network.totalUp ?? 0, stats?.network.totalDown ?? 0, node.traffic_limit, node.traffic_limit_type);
  return (
    <span className="ztable-traffic">
      <span>{cell.text}</span>
      {cell.badge ? (
        <span className={`ztable-badge is-${cell.type}`}>{cell.badge}</span>
      ) : (
        <span className="ztable-badge is-unlimited">
          <span className="ztable-badge-inf">∞</span>
        </span>
      )}
    </span>
  );
}

function BillingCell({ node, options }: { node: NodeWithStatus; options: RowOptions }) {
  const { t } = useTranslation();
  const status = expireStatus(node.expired_at, options.now);
  const price = options.showPrice ? formatPriceLabel(node.price, node.currency, node.billing_cycle, t) : null;
  if (status === 'none') return <span className={price ? undefined : 'ztable-dim'}>{price ?? '—'}</span>;

  const urgent = status === 'expired' || status === 'critical';
  const main =
    status === 'expired'
      ? t('ztable.days', { count: 0 })
      : status === 'long_term'
        ? t('mcard.longTerm')
        : t('ztable.days', { count: daysUntil(node.expired_at, options.now) });
  return (
    <span className={`ztable-billing${urgent ? ' is-urgent' : ''}`} title={dayjs(node.expired_at).format('YYYY-MM-DD')}>
      <span>{main}</span>
      {price && <span>{price}</span>}
    </span>
  );
}

const columnHelper = createColumnHelper<NodeWithStatus>();

function usage(node: NodeWithStatus, kind: 'cpu' | 'ram' | 'disk'): number | undefined {
  if (node.status !== 'online' || !node.stats) return undefined;
  if (kind === 'cpu') return node.stats.cpu.usage;
  if (kind === 'ram') return percentOf(node.stats.ram.used, node.stats.ram.total || node.mem_total);
  return percentOf(node.stats.disk.used, node.stats.disk.total || node.disk_total);
}

function bandwidth(node: NodeWithStatus): number | undefined {
  if (node.status !== 'online' || !node.stats) return undefined;
  return node.stats.network.up + node.stats.network.down;
}

function expirySortValue(node: NodeWithStatus): number | undefined {
  const status = expireStatus(node.expired_at, Date.now());
  return status === 'none' ? undefined : dayjs(node.expired_at).valueOf();
}

function onRowKey(event: KeyboardEvent<HTMLElement>, open: () => void) {
  if (event.target !== event.currentTarget) return;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    open();
  }
}

const TableRow = memo(function TableRow({
  node,
  options,
  onOpen,
}: {
  node: NodeWithStatus;
  options: RowOptions;
  onOpen: (uuid: string) => void;
}) {
  const online = node.status === 'online';
  const cpu = usage(node, 'cpu');
  const ram = usage(node, 'ram');
  const disk = usage(node, 'disk');
  const open = () => onOpen(node.uuid);
  return (
    <tr
      data-node-uuid={node.uuid}
      className={`ztable-row${online ? '' : ' is-offline'}`}
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => onRowKey(event, open)}
    >
      <td>
        <NameCell node={node} isLoggedIn={options.isLoggedIn} />
      </td>
      <td>
        <SystemCell node={node} />
      </td>
      <td>{cpu != null ? <MetricBar pct={cpu} tier={cpuTier(cpu)} /> : '---'}</td>
      <td>{ram != null ? <MetricBar pct={ram} tier={capacityTier(ram)} /> : '---'}</td>
      <td>{disk != null ? <MetricBar pct={disk} tier={capacityTier(disk)} /> : '---'}</td>
      {options.showLatency && (
        <td>
          <LatencyCell uuid={node.uuid} online={online} />
        </td>
      )}
      <td>
        {online && node.stats ? (
          <span className="ztable-bw">
            <span>↓ {formatCompactRate(node.stats.network.down)}</span>
            <span>↑ {formatCompactRate(node.stats.network.up)}</span>
          </span>
        ) : (
          '---'
        )}
      </td>
      <td>{online ? <TrafficValue node={node} /> : '---'}</td>
      <td>
        <BillingCell node={node} options={options} />
      </td>
    </tr>
  );
});

const ListItem = memo(function ListItem({
  node,
  options,
  onOpen,
}: {
  node: NodeWithStatus;
  options: RowOptions;
  onOpen: (uuid: string) => void;
}) {
  const { t } = useTranslation();
  const online = node.status === 'online';
  const cpu = usage(node, 'cpu');
  const ram = usage(node, 'ram');
  const disk = usage(node, 'disk');
  const open = () => onOpen(node.uuid);
  return (
    <div
      data-node-uuid={node.uuid}
      className={`ztable-item${online ? '' : ' is-offline'}`}
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => onRowKey(event, open)}
    >
      <div className="ztable-item-head">
        <NameCell node={node} isLoggedIn={options.isLoggedIn} />
        <BillingCell node={node} options={options} />
      </div>
      {online ? (
        <div className="ztable-item-metrics">
          <span className="ztable-item-metric">
            <span className="ztable-item-label">CPU</span>
            {cpu != null ? <MetricBar pct={cpu} tier={cpuTier(cpu)} /> : '---'}
          </span>
          <span className="ztable-item-metric">
            <span className="ztable-item-label">{t('mcard.memory')}</span>
            {ram != null ? <MetricBar pct={ram} tier={capacityTier(ram)} /> : '---'}
          </span>
          <span className="ztable-item-metric">
            <span className="ztable-item-label">{t('mcard.disk')}</span>
            {disk != null ? <MetricBar pct={disk} tier={capacityTier(disk)} /> : '---'}
          </span>
          {options.showLatency && (
            <span className="ztable-item-metric">
              <span className="ztable-item-label">{t('ztable.latency')}</span>
              <LatencyCell uuid={node.uuid} online={online} />
            </span>
          )}
        </div>
      ) : null}
      <div className="ztable-item-foot">
        <SystemCell node={node} />
        {online && node.stats && (
          <span className="ztable-bw">
            <span>↓ {formatCompactRate(node.stats.network.down)}</span>
            <span>↑ {formatCompactRate(node.stats.network.up)}</span>
          </span>
        )}
        {online && <TrafficValue node={node} />}
      </div>
    </div>
  );
});

function SortHeader({
  label,
  sorted,
  onToggle,
}: {
  label: string;
  sorted: false | 'asc' | 'desc';
  onToggle?: (event: unknown) => void;
}) {
  return (
    <th scope="col" aria-sort={sorted ? (sorted === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={`ztable-sort${sorted ? ' is-active' : ''}`} onClick={onToggle}>
        {label}
        <span className="ztable-sort-mark" aria-hidden>
          {sorted ? ` ${sorted === 'asc' ? '▲' : '▼'}` : ' ·'}
        </span>
      </button>
    </th>
  );
}

export default function TacitNodeTable({ nodes, allNodes }: { nodes: NodeWithStatus[]; allNodes: NodeWithStatus[] }) {
  useLatencyFeed(allNodes);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const settings = useThemeSettings();
  const { isLoggedIn } = useAppConfig();
  const now = useMinuteClock();
  // The full table needs ≈1240 px of content width (a 1366 px screen); narrower screens get stacked rows.
  const stacked = useIsMobile(1366);
  const [sorting, setSorting] = useState<SortingState>([]);

  const options = useMemo<RowOptions>(
    () => ({
      showLatency: settings.showLatency,
      showPrice: canViewCosts(settings, isLoggedIn),
      isLoggedIn,
      now,
    }),
    [settings, isLoggedIn, now],
  );

  const sortingByLatency = sorting[0]?.id === 'latency';
  // Re-sort when latency data changes, but only while the table is sorted by latency.
  const pingVersion = usePingStoreVersion(sortingByLatency && settings.showLatency);

  const columns = useMemo(
    () => [
      columnHelper.accessor('name', { id: 'name', header: () => t('ztable.name') }),
      columnHelper.accessor((node) => osArchLabel(node.os, node.arch), { id: 'os', header: () => t('ztable.system') }),
      columnHelper.accessor((node) => usage(node, 'cpu'), { id: 'cpu', header: () => 'CPU', sortUndefined: 'last' }),
      columnHelper.accessor((node) => usage(node, 'ram'), { id: 'ram', header: () => t('mcard.memory'), sortUndefined: 'last' }),
      columnHelper.accessor((node) => usage(node, 'disk'), { id: 'disk', header: () => t('mcard.disk'), sortUndefined: 'last' }),
      ...(settings.showLatency
        ? [
            columnHelper.accessor((node) => (node.status === 'online' ? readNodeLatestLatency(node.uuid, settings) : undefined), {
              id: 'latency',
              header: () => t('ztable.latency'),
              sortUndefined: 'last',
            }),
          ]
        : []),
      columnHelper.accessor((node) => bandwidth(node), { id: 'bandwidth', header: () => t('ztable.bandwidth'), sortUndefined: 'last' }),
      columnHelper.accessor(
        (node) => {
          if (node.status !== 'online') return undefined;
          const stats = node.stats;
          return trafficCell(stats?.network.totalUp ?? 0, stats?.network.totalDown ?? 0, node.traffic_limit, node.traffic_limit_type)
            .sortValue;
        },
        { id: 'traffic', header: () => t('mcard.traffic'), sortUndefined: 'last' },
      ),
      columnHelper.accessor((node) => expirySortValue(node), { id: 'expiry', header: () => t('ztable.expiry'), sortUndefined: 'last' }),
    ],
    // pingVersion: rebuild accessors so a latency sort sees fresh values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings, t, pingVersion],
  );

  const table = useReactTable({
    data: nodes,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  const rows = table.getRowModel().rows;

  const bodyRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const updateScrollMargin = useCallback(() => {
    if (!bodyRef.current) return;
    const top = bodyRef.current.getBoundingClientRect().top + window.scrollY;
    setScrollMargin((prev) => (prev === top ? prev : top));
  }, []);
  useEffect(() => {
    updateScrollMargin();
    const observer = new ResizeObserver(updateScrollMargin);
    if (bodyRef.current) observer.observe(bodyRef.current);
    window.addEventListener('resize', updateScrollMargin);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateScrollMargin);
    };
  }, [updateScrollMargin]);

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => (stacked ? 168 : 66),
    overscan: stacked ? 5 : 10,
    scrollMargin,
  });
  useEffect(() => {
    virtualizer.measure();
  }, [stacked, virtualizer]);

  const items = virtualizer.getVirtualItems();
  const first = items[0];
  const last = items[items.length - 1];
  const topPad = first ? Math.max(0, first.start - scrollMargin) : 0;
  const bottomPad = last ? Math.max(0, virtualizer.getTotalSize() - (last.end - scrollMargin)) : 0;
  const openNode = useCallback((uuid: string) => navigate(`/node/${uuid}`), [navigate]);
  const colCount = table.getVisibleLeafColumns().length;

  return (
    <div className="ztable">
      <div ref={bodyRef}>
        {stacked ? (
          <div className="ztable-list">
            {topPad > 0 && <div aria-hidden style={{ height: topPad }} />}
            {items.map((item) => {
              const row = rows[item.index];
              if (!row) return null;
              return (
                <div key={row.id} ref={virtualizer.measureElement} data-index={item.index}>
                  <ListItem node={row.original} options={options} onOpen={openNode} />
                </div>
              );
            })}
            {bottomPad > 0 && <div aria-hidden style={{ height: bottomPad }} />}
            {rows.length === 0 && <div className="ztable-empty">{t('node.noNodesAvailable')}</div>}
          </div>
        ) : (
          <div className="ztable-scroll">
            <table>
              <thead>
                {table.getHeaderGroups().map((group) => (
                  <tr key={group.id}>
                    {group.headers.map((header) => (
                      <SortHeader
                        key={header.id}
                        label={String(
                          typeof header.column.columnDef.header === 'function'
                            ? header.column.columnDef.header(header.getContext())
                            : header.column.columnDef.header ?? '',
                        )}
                        sorted={header.column.getIsSorted()}
                        onToggle={header.column.getToggleSortingHandler()}
                      />
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {topPad > 0 && (
                  <tr aria-hidden>
                    <td colSpan={colCount} style={{ height: topPad, padding: 0 }} />
                  </tr>
                )}
                {items.map((item) => {
                  const row = rows[item.index];
                  if (!row) return null;
                  return <TableRow key={row.id} node={row.original} options={options} onOpen={openNode} />;
                })}
                {bottomPad > 0 && (
                  <tr aria-hidden>
                    <td colSpan={colCount} style={{ height: bottomPad, padding: 0 }} />
                  </tr>
                )}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={colCount} className="ztable-empty">
                      {t('node.noNodesAvailable')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
