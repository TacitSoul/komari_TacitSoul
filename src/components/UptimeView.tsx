import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { HudSpinner } from './HudSpinner';
import { UptimeSummary } from './uptime/UptimeSummary';
import { RegionFlag } from './RegionFlag';
import { apiService } from '@/services/api';
import type { NodeWithStatus } from '@/services/api';
import { cn } from '@/lib/utils';
import { useAppConfig } from '@/hooks/useAppConfig';
import {
  computeUptime,
  observableStart,
  needsUptimeRefresh,
  isCurrentUptimeRequest,
  summarizeUptime,
  hydrateUptimeMeasurements,
  sortUptimeNodes,
  buildUptimeRanges,
  type UptimeResult,
  type UptimeMeasurement,
  type UptimeSlot,
  type LoadRecord,
} from '@/lib/uptime-utils';

/* ──────────────────────────────────────────────────────────────
   Constants
   ────────────────────────────────────────────────────────────── */
/** SLO threshold — only used to color the avg pillar / row %. */
const SLO_THRESHOLD = 99.9;

/** Refresh histories at this cadence using one shared view timer. */
const NODE_REFRESH_INTERVAL = 2 * 60_000;

/** Stagger initial fetches to avoid network burst */
const FETCH_STAGGER_MS = 35;

/* ──────────────────────────────────────────────────────────────
   Date helpers
   ────────────────────────────────────────────────────────────── */
function formatTooltipDate(ts: number): string {
  const d = new Date(ts);
  return (
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  );
}

/* ──────────────────────────────────────────────────────────────
   Shared IntersectionObserver — one observer for all rows
   (was: N observers, one per row — wasteful at scale)
   ────────────────────────────────────────────────────────────── */
type VisibilityCb = (visible: boolean) => void;
const visibilityCallbacks = new WeakMap<Element, VisibilityCb>();
let sharedObserver: IntersectionObserver | null = null;

function getSharedObserver(): IntersectionObserver {
  if (sharedObserver) return sharedObserver;
  sharedObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const cb = visibilityCallbacks.get(entry.target);
        if (cb) cb(entry.isIntersecting);
      }
    },
    { rootMargin: '400px' },
  );
  return sharedObserver;
}

function useLazyVisible() {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = getSharedObserver();
    const cb: VisibilityCb = (visible) => {
      if (visible) {
        setIsVisible(true);
        observer.unobserve(el);
        visibilityCallbacks.delete(el);
      }
    };
    visibilityCallbacks.set(el, cb);
    observer.observe(el);
    return () => {
      observer.unobserve(el);
      visibilityCallbacks.delete(el);
    };
  }, []);

  return { ref, isVisible };
}

/* ──────────────────────────────────────────────────────────────
   Uptime Bar — slot list memoized; hover state lifted to a ref-less
   single tooltip overlay so hovering one slot does NOT re-render the
   other N-1 slots.
   ────────────────────────────────────────────────────────────── */
interface UptimeBarProps {
  slots: UptimeSlot[];
}

const UptimeBar = memo(function UptimeBar({ slots }: UptimeBarProps) {
  const { t } = useTranslation();
  const statusLabel = useCallback((status: UptimeSlot['status']) => t(
    status === 'online' ? 'uptime.slotOk' : status === 'offline' ? 'status.offline'
      : status === 'partial' ? 'uptime.slotDegraded' : 'uptime.slotNoData',
  ), [t]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ idx: number; left: number } | null>(null);

  // Render slot DOM only once per `slots` reference. Hover effects are pure CSS
  // (group-hover dimming), avoiding React re-renders on mouse move.
  const slotEls = useMemo(
    () => (
      <>
        <div className="uptime-bar uptime-cells">
          {slots.map((slot, i) => (
            <div
              key={i}
              data-idx={i}
              data-status={slot.status}
              role="img"
              aria-label={`${formatTooltipDate(slot.start)} ${statusLabel(slot.status)}`}
              className={cn('uptime-slot uptime-cell', `is-${slot.status}`)}
            />
          ))}
        </div>
      </>
    ),
    [slots, statusLabel],
  );

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains('uptime-slot')) {
      setTooltip(null);
      return;
    }
    const idxStr = target.dataset.idx;
    if (idxStr === undefined) return;
    const idx = Number(idxStr);
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const slotRect = target.getBoundingClientRect();
    const center = slotRect.left + slotRect.width / 2 - rect.left;
    setTooltip((prev) =>
      prev && prev.idx === idx && Math.abs(prev.left - center) < 0.5
        ? prev
        : { idx, left: center },
    );
  }, []);

  const onMouseLeave = useCallback(() => setTooltip(null), []);

  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
      {slotEls}
      {tooltip && slots[tooltip.idx] && (
        <div
          className="absolute -top-9 z-10 max-w-[calc(100vw-2rem)] px-2 py-1 rounded border border-border bg-popover text-xxs font-mono text-popover-foreground whitespace-nowrap pointer-events-none shadow-lg"
          style={{ left: `clamp(5rem, ${tooltip.left}px, calc(100% - 5rem))`, transform: 'translateX(-50%)' }}
        >
          {formatTooltipDate(slots[tooltip.idx].start)} — {statusLabel(slots[tooltip.idx].status)}
        </div>
      )}
    </div>
  );
});

/* ──────────────────────────────────────────────────────────────
   Single node row — list-row treatment
   ────────────────────────────────────────────────────────────── */
interface NodeRowProps {
  node: NodeWithStatus;
  uptime: UptimeResult | null;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}

const NodeRow = memo(function NodeRow({ node, uptime, loading, failed, onRetry }: NodeRowProps) {
  const { t } = useTranslation();
  const isOnline = node.status === 'online';
  const pct = uptime?.uptimePercent ?? null;
  const incidents = uptime?.offlineSlots ?? 0;

  const pctTone = pct === null ? 'is-none' : pct >= SLO_THRESHOLD ? 'is-ok' : pct >= 95 ? 'is-warn' : 'is-bad';

  return (
    <div data-node-uuid={node.uuid} className="uptime-row group relative px-3 py-2.5 sm:px-4 sm:py-3">
      <div className="flex flex-col gap-2">
        <Link to={`/node/${node.uuid}`} className="flex items-center gap-2 min-w-0 rounded focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2">
          <span className={cn('uptime-row-dot', isOnline ? 'is-online' : 'is-offline')} aria-hidden />
          <RegionFlag region={node.region} size="sm" />
          <span className="node-name min-w-0 flex-1 text-sm truncate group-hover:text-primary transition-colors">
            {node.name}
          </span>
          {node.group && <span className="uptime-row-group">{node.group}</span>}

          <span className="ml-auto flex shrink-0 items-center gap-2">
            {incidents > 0 && (
              <span className="hidden sm:inline-flex items-center gap-1 text-xxs font-metric font-bold text-destructive bg-destructive/10 border border-destructive/30 px-1.5 py-0.5 rounded">
                <AlertTriangle className="h-3 w-3" />
                {t('uptime.downSlots', { count: incidents })}
              </span>
            )}
            {loading && !uptime ? (
              <HudSpinner size="sm" className="text-muted-foreground" />
            ) : pct !== null ? (
              <span className={cn('uptime-row-pct', pctTone)}>
                {pct.toFixed(2)}%
              </span>
            ) : (
              <span className="text-xs font-mono text-muted-foreground">—</span>
            )}
            <ChevronRight className="uptime-row-chevron" aria-hidden />
          </span>
        </Link>

        {failed && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <span>{t(uptime ? 'uptime.stale' : 'uptime.loadFailed')}</span>
            <button type="button" className="rounded underline focus-visible:outline-2 focus-visible:outline-ring" onClick={onRetry} disabled={loading}>
              {t('action.retry')}
            </button>
          </div>
        )}

        <div className="relative pt-[3px]">
          {uptime ? (
            <UptimeBar slots={uptime.slots} />
          ) : loading ? (
            <div className="uptime-cells is-loading" />
          ) : (
            <div className="h-6 rounded bg-muted/10 flex items-center justify-center border border-dashed border-border/40">
              <span className="text-xs text-muted-foreground">{t('uptime.noData')}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

/* ──────────────────────────────────────────────────────────────
   Module-level history cache
   ────────────────────────────────────────────────────────────── */
interface NodeCache {
  records: LoadRecord[];
  result: UptimeResult;
  fetchedAt: number;
  failed: boolean;
}

interface IncrementalCache {
  nodes: Map<string, NodeCache>;
  rangeHours: number;
}

let _cache: IncrementalCache | null = null;

/* ──────────────────────────────────────────────────────────────
   Concurrency limiter — cap parallel fetches to N (avoid 50+ in flight)
   ────────────────────────────────────────────────────────────── */
const FETCH_CONCURRENCY = 6;
let _activeFetches = 0;
const _fetchQueue: Array<() => void> = [];

function acquireFetchSlot(): Promise<void> {
  if (_activeFetches < FETCH_CONCURRENCY) {
    _activeFetches++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    _fetchQueue.push(() => {
      _activeFetches++;
      resolve();
    });
  });
}

function releaseFetchSlot() {
  _activeFetches--;
  const next = _fetchQueue.shift();
  if (next) next();
}

/* ──────────────────────────────────────────────────────────────
   LazyNodeRow — fetches data only when scrolled into view
   ────────────────────────────────────────────────────────────── */
interface LazyNodeRowProps {
  node: NodeWithStatus;
  rangeHours: number;
  retentionHours: number;
  cache: IncrementalCache;
  now: number;
  onResult: (uuid: string, result: UptimeMeasurement) => void;
  forceKey: number;
  /** Index used for tiny initial-fetch stagger */
  indexHint: number;
}

const LazyNodeRow = memo(function LazyNodeRow({
  node,
  rangeHours,
  retentionHours,
  cache,
  now,
  onResult,
  forceKey,
  indexHint,
}: LazyNodeRowProps) {
  const { ref, isVisible } = useLazyVisible();
  const [history, setHistory] = useState<NodeCache | null>(() => cache.nodes.get(node.uuid) ?? null);
  const [failed, setFailed] = useState(() => history?.failed ?? false);
  const [loading, setLoading] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const lastForceKey = useRef(forceKey);
  const lastRetryKey = useRef(retryKey);
  const fetchDelay = useRef(Math.min(indexHint * FETCH_STAGGER_MS, 500));
  const uptime = useMemo(() => history ? failed ? history.result : computeUptime(
    history.records, rangeHours, observableStart(node.created_at, retentionHours, now), now,
  ) : null, [history, failed, rangeHours, node.created_at, retentionHours, now]);

  // Cache hydration is a measurement too; no parent mount effect may clear it afterwards.
  useEffect(() => {
    if (uptime || failed) onResult(node.uuid, { result: uptime, failed });
  }, [node.uuid, uptime, failed, onResult]);

  useEffect(() => {
    const isForceRefresh = forceKey !== lastForceKey.current || retryKey !== lastRetryKey.current;
    lastForceKey.current = forceKey;
    lastRetryKey.current = retryKey;

    if (!isVisible && !isForceRefresh) return;
    const cached = cache.nodes.get(node.uuid);
    if (!isForceRefresh && !needsUptimeRefresh(cached?.fetchedAt, cached?.failed ?? false, now, NODE_REFRESH_INTERVAL)) return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const isCurrent = () => isCurrentUptimeRequest(cache, _cache, cancelled);

    const doFetch = async () => {
      await acquireFetchSlot();
      if (!isCurrent()) {
        releaseFetchSlot();
        return;
      }

      setLoading(true);
      try {
        // Short delta requests use a different server bucket tier; never mix cadences.
        const data = await apiService.getLoadHistory(node.uuid, rangeHours, { loadType: 'cpu', throwOnError: true, deduplicate: false });
        if (!isCurrent()) return;
        if (!data) throw new Error('Missing load history response');
        const entry: NodeCache = {
          records: data.records as unknown as LoadRecord[],
          result: computeUptime(data.records as unknown as LoadRecord[], rangeHours, observableStart(node.created_at, retentionHours, now), now),
          fetchedAt: Date.now(),
          failed: false,
        };
        cache.nodes.set(node.uuid, entry);
        setHistory(entry);
        setFailed(false);
      } catch {
        if (!isCurrent()) return;
        if (cached) cache.nodes.set(node.uuid, { ...cached, failed: true });
        setFailed(true);
      } finally {
        releaseFetchSlot();
        if (isCurrent()) setLoading(false);
      }
    };

    // Stagger initial fetches a touch to spread network load smoothly
    const delay = !cached ? fetchDelay.current : 0;
    if (delay > 0) {
      timeoutId = setTimeout(doFetch, delay);
    } else {
      doFetch();
    }

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isVisible, forceKey, retryKey, node.uuid, node.created_at, retentionHours, rangeHours, cache, now]);

  return (
    <div ref={ref}>
      <NodeRow node={node} uptime={uptime} loading={loading} failed={failed} onRetry={() => setRetryKey(k => k + 1)} />
    </div>
  );
});

/* ══════════════════════════════════════════════════════════════
   UptimeView — main exported component
   ══════════════════════════════════════════════════════════════ */
interface UptimeViewProps {
  nodes: NodeWithStatus[];
}

type SortMode = 'weight' | 'uptime';

export function UptimeView({ nodes }: UptimeViewProps) {
  const { recordPreserveTime } = useAppConfig();

  const uptimeRanges = useMemo(
    () => buildUptimeRanges(recordPreserveTime),
    [recordPreserveTime],
  );

  const [rangeIdx, setRangeIdx] = useState(0);
  const range = uptimeRanges[Math.min(rangeIdx, uptimeRanges.length - 1)];

  return (
    <UptimeRangeView
      key={range.hours}
      nodes={nodes}
      rangeHours={range.hours}
      retentionHours={recordPreserveTime}
      uptimeRanges={uptimeRanges}
      rangeIdx={rangeIdx}
      onRangeChange={setRangeIdx}
    />
  );
}

interface UptimeRangeViewProps extends UptimeViewProps {
  rangeHours: number;
  retentionHours: number;
  uptimeRanges: Array<{ hours: number; label: string }>;
  rangeIdx: number;
  onRangeChange: (idx: number) => void;
}

function UptimeRangeView({ nodes, rangeHours, retentionHours, uptimeRanges, rangeIdx, onRangeChange }: UptimeRangeViewProps) {
  const [now, setNow] = useState(Date.now);
  const [cache, setCache] = useState<IncrementalCache>(() => {
    if (!_cache || _cache.rangeHours !== rangeHours) _cache = { nodes: new Map(), rangeHours };
    return _cache;
  });
  const [forceKey, setForceKey] = useState(0);
  const [sortMode, setSortMode] = useState<SortMode>('weight');

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), NODE_REFRESH_INTERVAL);
    return () => clearInterval(timer);
  }, []);

  /* ─── Batched result map ──────────────────────────────────────
     LazyNodeRow children call onResult; we accumulate in a ref and
     flush once per animation frame to avoid N state-updates → N
     parent re-renders during initial load. */
  const [resultMap, setResultMap] = useState(() => hydrateUptimeMeasurements(nodes, cache.nodes, rangeHours, retentionHours, now));
  const pendingResultsRef = useRef<Map<string, UptimeMeasurement>>(new Map());
  const frameRef = useRef<number | null>(null);

  const handleResult = useCallback((uuid: string, result: UptimeMeasurement) => {
    pendingResultsRef.current.set(uuid, result);
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const pending = pendingResultsRef.current;
      if (pending.size === 0) return;
      pendingResultsRef.current = new Map();
      setResultMap((prev) => {
        const next = new Map(prev);
        pending.forEach((v, k) => next.set(k, v));
        return next;
      });
    });
  }, []);

  // The keyed range view resets only when the range changes, never after child hydration.
  useEffect(() => {
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, []);

  const baseSortedNodes = useMemo(
    () => sortUptimeNodes(nodes),
    [nodes],
  );

  // Apply optional sort by uptime
  const visibleList = useMemo(() => {
    if (sortMode === 'weight') return baseSortedNodes;
    return [...baseSortedNodes].sort((a, b) => {
      const am = resultMap.get(a.uuid);
      const bm = resultMap.get(b.uuid);
      const ap = am?.failed ? 101 : am?.result?.uptimePercent ?? 101;
      const bp = bm?.failed ? 101 : bm?.result?.uptimePercent ?? 101;
      return ap - bp;
    });
  }, [baseSortedNodes, resultMap, sortMode]);

  const stats = useMemo(() => summarizeUptime(nodes.map(n => n.uuid), resultMap, SLO_THRESHOLD), [nodes, resultMap]);
  const loadedCount = stats.loaded;
  const isLoading = loadedCount === 0 && baseSortedNodes.length > 0;
  const loadProgress =
    baseSortedNodes.length > 0 ? loadedCount / baseSortedNodes.length : 1;

  const handleRefresh = useCallback(() => {
    // A new object invalidates every queued/in-flight request, while retaining stale data.
    const nextCache = { nodes: new Map(cache.nodes), rangeHours };
    _cache = nextCache;
    setCache(nextCache);
    setNow(Date.now());
    setForceKey((k) => k + 1);
  }, [cache, rangeHours]);

  return (
    <div className="space-y-4 sm:space-y-5 uptime-view">
      {/* ═══ Availability summary ═══ */}
      <UptimeSummary
        nodes={nodes}
        results={resultMap}
        sloThreshold={SLO_THRESHOLD}
        ranges={uptimeRanges}
        rangeIdx={rangeIdx}
        onRangeChange={onRangeChange}
        sortByUptime={sortMode === 'uptime'}
        onToggleSort={() => setSortMode((m) => (m === 'weight' ? 'uptime' : 'weight'))}
        onRefresh={handleRefresh}
        loading={isLoading}
        loadProgress={loadProgress}
      />

      {/* ═══ Node list — show ALL nodes by default ═══ */}
      {baseSortedNodes.length > 0 && (
        <div className="uptime-list">
          <div className="uptime-list-rows">
            {visibleList.map((n, i) => (
              <LazyNodeRow
                key={n.uuid}
                node={n}
                rangeHours={rangeHours}
                retentionHours={retentionHours}
                cache={cache}
                now={now}
                onResult={handleResult}
                forceKey={forceKey}
                indexHint={i}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
