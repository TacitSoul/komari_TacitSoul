import { useEffect, useLayoutEffect, useState, useRef, useCallback, useId, type MouseEvent, type ReactNode } from 'react';
import { motion, type PanInfo } from 'motion/react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { NodeWithStatus } from '@/services/api';
import { cn } from '@/lib/utils';

interface MobileFleetSheetProps {
  nodes: NodeWithStatus[];
  selectedNodeId: string | null;
  onClearSelection?: () => void;
  /** Whether a new roster selection should open the sheet. */
  autoExpandOnSelect?: boolean;
  children: ReactNode;
}

const SHEET_STATES = ['peek', 'half', 'open'] as const;
type SheetState = typeof SHEET_STATES[number];
const COMPACT_SHEET_STATES: readonly SheetState[] = ['peek', 'open'];
const MIN_HALF_STAGE_HEIGHT = 285; // The 60% cap needs room for a ~170px half sheet.
const SHEET_HEIGHT: Record<SheetState, string> = {
  peek: '8%',
  half: 'min(60%, clamp(170px, 32%, 216px))',
  open: '100%',
};

export function MobileFleetSheet({ nodes, selectedNodeId, onClearSelection, autoExpandOnSelect = true, children }: MobileFleetSheetProps) {
  const { t } = useTranslation();
  const contentId = useId();
  const [{ state, compact }, setSheet] = useState<{ state: SheetState; compact: boolean }>({ state: 'peek', compact: false });
  const lastSelectedRef = useRef<string | null>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const draggedRef = useRef(false);

  useLayoutEffect(() => {
    // Watch the fixed-height containing stage, not the animating drawer.
    const stage = sheetRef.current?.parentElement;
    if (!stage) return;
    const measure = () => {
      const compact = stage.clientHeight < MIN_HALF_STAGE_HEIGHT;
      setSheet(sheet => sheet.compact === compact ? sheet : {
        compact,
        state: compact && sheet.state === 'half' ? 'open' : sheet.state,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (autoExpandOnSelect && selectedNodeId && selectedNodeId !== lastSelectedRef.current) {
      setSheet(sheet => sheet.state === 'open' ? sheet : { ...sheet, state: 'open' });
    }
    lastSelectedRef.current = selectedNodeId;
  }, [selectedNodeId, autoExpandOnSelect]);

  const onlineCount = nodes.reduce((acc, n) => acc + (n.status === 'online' ? 1 : 0), 0);
  const offlineCount = nodes.length - onlineCount;

  const clearRosterSelection = useCallback(() => {
    if (selectedNodeId) onClearSelection?.();
  }, [selectedNodeId, onClearSelection]);

  const toggle = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    // A pointer release over the handle can click even after a drag.
    if (event.detail > 0 && draggedRef.current) return;
    clearRosterSelection();
    setSheet(({ state, compact }) => ({
      compact,
      state: state === 'peek' ? (compact ? 'open' : 'half') : state === 'half' ? 'open' : 'peek',
    }));
  }, [clearRosterSelection]);

  // One stop per drag. Prefer sustained displacement to release velocity.
  const onDragEnd = useCallback((_: unknown, info: PanInfo) => {
    const direction = Math.abs(info.offset.y) > 40 ? -Math.sign(info.offset.y)
      : Math.abs(info.velocity.y) > 300 ? -Math.sign(info.velocity.y) : 0;
    if (!direction || (direction < 0 ? state === 'peek' : state === 'open')) return;
    clearRosterSelection();
    setSheet(sheet => {
      const stops = sheet.compact ? COMPACT_SHEET_STATES : SHEET_STATES;
      const index = Math.max(0, Math.min(stops.length - 1, stops.indexOf(sheet.state) + direction));
      const state = stops[index];
      return state === sheet.state ? sheet : { ...sheet, state };
    });
  }, [state, clearRosterSelection]);

  const expanded = state !== 'peek';
  const isOpen = state === 'open';
  const actionLabel = t(isOpen ? 'fleet.collapseNodes' : state === 'half' ? 'fleet.expandList' : 'fleet.expandNodes');

  return (
    <section
      ref={sheetRef}
      aria-label={t('fleet.status')}
      data-fleet-sheet={state}
      data-fleet-compact={compact || undefined}
      className={cn(
        'absolute inset-x-0 bottom-0 z-40 lg:hidden flex flex-col overflow-hidden',
        'transition-[height] duration-200 ease-out motion-reduce:transition-none',
        'border-t border-border/60 rounded-t-2xl pb-safe hud-corners',
        expanded ? 'bg-card' : 'bg-card/92 backdrop-blur-md',
        'shadow-[0_-8px_32px_-8px_rgba(0,0,0,0.4)]',
      )}
      style={{
        height: SHEET_HEIGHT[state],
        minHeight: 'calc(45px + env(safe-area-inset-bottom, 0px))',
        maxHeight: 'min(100%, 100dvh)',
      }}
    >
      <span className="corner-bottom" />
      <div className="relative flex shrink-0 items-stretch">
        <span className="pointer-events-none absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-muted-foreground/40" aria-hidden />
        <motion.button
          type="button"
          ref={handleRef}
          onPointerDown={() => { draggedRef.current = false; }}
          onClick={toggle}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={0.15}
          onDragStart={() => { draggedRef.current = true; }}
          onDragEnd={onDragEnd}
          aria-expanded={expanded}
          aria-controls={contentId}
          className={cn(
            'flex flex-1 min-w-0 min-h-11 items-end px-3 pb-1.5 pt-3.5',
            'cursor-grab active:cursor-grabbing select-none touch-none',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset',
          )}
        >
          <span className="flex w-full items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-foreground">{actionLabel}</span>
            <span className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5">
              {!isOpen && (
                <>
                  <span className="tabular-nums text-success">{onlineCount} {t('status.on')}</span>
                  <span className="tabular-nums text-destructive">{offlineCount} {t('status.off')}</span>
                </>
              )}
              {isOpen
                ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                : <ChevronUp className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />}
            </span>
          </span>
        </motion.button>
        {state === 'half' && (
          <button
            type="button"
            onClick={() => {
              handleRef.current?.focus({ preventScroll: true });
              clearRosterSelection();
              setSheet(sheet => ({ ...sheet, state: 'peek' }));
            }}
            aria-label={t('fleet.collapseNodes')}
            title={t('fleet.collapseNodes')}
            className="grid min-h-11 w-11 shrink-0 place-items-center border-s border-border/60 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset"
          >
            <ChevronDown className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
      <div
        id={contentId}
        className={cn(
          'fleet-sheet-body flex-1 min-h-0 overflow-y-auto',
          expanded ? 'pointer-events-auto' : 'pointer-events-none opacity-0 invisible',
        )}
        aria-hidden={!expanded}
        inert={!expanded}
      >
        {children}
      </div>
    </section>
  );
}
