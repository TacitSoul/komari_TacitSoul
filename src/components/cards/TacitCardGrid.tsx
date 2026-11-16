import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import type { NodeWithStatus } from '@/services/api';
import { useAppConfig } from '@/hooks/useAppConfig';
import { useLatencyFeed } from '@/matrix/hooks/useNodeLatency';
import { useThemeSettings } from '@/matrix/hooks/useThemeSettings';
import { canViewCosts } from '@/matrix/utils/themeSettings';
import { TacitNodeCard, type TacitCardOptions } from './TacitNodeCard';
import './tacit-card.css';

/**
 * The grid keeps cards at least 340 px wide (auto-fill) and caps at four columns. Its page is
 * full-width; this theme's content column is narrower, so the 340 px minimum decides the count.
 */
const MIN_CARD = 340;
const GAP = 16;

function columnsFor(width: number) {
  if (width < 640) return 1;
  return Math.min(4, Math.max(1, Math.floor((width + GAP) / (MIN_CARD + GAP))));
}

/**
 * Card view: cards for the given (filtered, sorted) nodes, virtualised by row.
 * `allNodes` keeps the shared latency store in step with the whole fleet.
 */
export default function TacitCardGrid({
  nodes,
  allNodes,
  onOpenChart,
}: {
  nodes: NodeWithStatus[];
  allNodes: NodeWithStatus[];
  onOpenChart?: (uuid: string, name: string) => void;
}) {
  useLatencyFeed(allNodes);
  const settings = useThemeSettings();
  const { isLoggedIn, themeSettingsRaw } = useAppConfig();

  const options = useMemo<TacitCardOptions>(
    () => ({
      showPrice: canViewCosts(settings, isLoggedIn),
      showGroup: settings.showCardGroup,
      singleColumn: themeSettingsRaw.cardProgressLayout === '1col',
      splitTrafficColor: themeSettingsRaw.trafficSplitColor !== false,
      isLoggedIn,
    }),
    [settings, isLoggedIn, themeSettingsRaw.cardProgressLayout, themeSettingsRaw.trafficSplitColor],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(1);
  const [scrollMargin, setScrollMargin] = useState(0);

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const next = columnsFor(el.offsetWidth);
    setCols((prev) => (prev === next ? prev : next));
    const top = el.getBoundingClientRect().top + window.scrollY;
    setScrollMargin((prev) => (prev === top ? prev : top));
  }, []);

  useEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (containerRef.current) observer.observe(containerRef.current);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  const rowCount = Math.ceil(nodes.length / cols);
  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => 330,
    overscan: 3,
    scrollMargin,
  });

  return (
    <div ref={containerRef} className="w-full">
      <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
        {virtualizer.getVirtualItems().map((row) => {
          const start = row.index * cols;
          return (
            <div
              key={row.key}
              ref={virtualizer.measureElement}
              data-index={row.index}
              className="absolute left-0 top-0 w-full pb-4"
              style={{ transform: `translateY(${row.start - scrollMargin}px)` }}
            >
              <div className="mcard-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                {nodes.slice(start, start + cols).map((node) => (
                  <TacitNodeCard key={node.uuid} node={node} options={options} onOpenChart={onOpenChart} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
