import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp, ArrowDown, Cpu, Clock } from 'lucide-react';
import { WebSocketStatus } from '@/components/WebSocketStatus';
import { useAppConfig } from '@/hooks/useAppConfig';
import { formatSpeed, cn } from '@/lib/utils';
import { separatorPriority, type FooterSegmentPriority } from '@/lib/footerSegments';

const THEME_REPO_URL = 'https://github.com/TacitSoul/komari_TacitSoul';

function FooterSep({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex items-center self-center leading-none text-muted-foreground/30 select-none shrink-0',
        className,
      )}
    >
      |
    </span>
  );
}

function FooterLocalClock() {
  const { t } = useTranslation();
  const mobileRef = useRef<HTMLSpanElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const fullRef = useRef<HTMLSpanElement>(null);
  const tzRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const tick = () => {
      const d = new Date();
      const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      const timeShort = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      if (mobileRef.current) mobileRef.current.textContent = timeShort;
      if (timeRef.current) timeRef.current.textContent = time;
      if (fullRef.current) fullRef.current.textContent = `${date} ${time}`;
      if (tzRef.current) {
        try {
          const tz = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
            .formatToParts(d)
            .find(part => part.type === 'timeZoneName')?.value;
          tzRef.current.textContent = tz ?? t('hud.local');
        } catch {
          tzRef.current.textContent = t('hud.local');
        }
      }
    };
    tick();

    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (id != null) return;
      id = setInterval(tick, 1000);
    };
    const stop = () => {
      if (id == null) return;
      clearInterval(id);
      id = null;
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        tick();
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [t]);

  return (
    <>
      <div
        className="flex md:hidden items-center gap-1 font-metric tabular-nums text-muted-foreground/80 shrink-0 leading-none"
        title={t('hud.local')}
        aria-live="polite"
        aria-atomic="true"
      >
        <Clock className="h-3 w-3 shrink-0 text-muted-foreground/55" aria-hidden />
        <span ref={mobileRef} className="text-foreground/75 leading-none" />
      </div>
      <div
        className="hidden md:flex items-center gap-1.5 font-metric tabular-nums text-muted-foreground/80 shrink-0 leading-none footer-pri-9"
        aria-live="polite"
        aria-atomic="true"
      >
        <Clock className="h-3 w-3 shrink-0 text-muted-foreground/55" aria-hidden />
        <span
          ref={tzRef}
          className="font-mono uppercase tracking-wider text-muted-foreground/55 leading-none footer-pri-3"
        >
          {t('hud.local')}
        </span>
        <span ref={timeRef} className="text-foreground/75 leading-none" />
        <span ref={fullRef} className="hidden footer-pri-4 footer-clock-full text-foreground/75 leading-none" />
      </div>
    </>
  );
}

interface FooterFleetMetricsProps {
  avgCpu: number;
  totalUp: number;
  totalDown: number;
  className?: string;
}

function FooterFleetMetrics({ avgCpu, totalUp, totalDown, className }: FooterFleetMetricsProps) {
  const { t } = useTranslation();
  const cpuTone =
    avgCpu < 60 ? 'text-success' : avgCpu < 85 ? 'text-warning' : 'text-destructive';
  const upLabel = t('label.netUp');
  const downLabel = t('label.netDown');

  return (
    <div
      className={cn(
        'flex items-center gap-x-2 sm:gap-x-3 min-w-0 flex-nowrap leading-none',
        className,
      )}
      aria-label={`${t('hud.avgCpu')} ${avgCpu.toFixed(0)}%, ${upLabel} ${formatSpeed(totalUp)}, ${downLabel} ${formatSpeed(totalDown)}`}
    >
      <div className="flex items-center gap-1 sm:gap-1.5 shrink-0" title={t('hud.avgCpu')}>
        <Cpu className={cn('h-3 w-3 shrink-0 opacity-70', cpuTone)} aria-hidden />
        <span className={cn('font-metric tracking-normal normal-case', cpuTone)}>
          {avgCpu.toFixed(0)}%
        </span>
      </div>
      <div className="flex items-center gap-1 shrink-0 min-w-0 footer-pri-7" title={upLabel}>
        <ArrowUp className="h-3 w-3 text-success/80 shrink-0" aria-hidden />
        <span className="font-metric text-success tracking-normal normal-case">
          {formatSpeed(totalUp)}
        </span>
      </div>
      <div className="flex items-center gap-1 shrink-0 min-w-0 footer-pri-6" title={downLabel}>
        <ArrowDown className="h-3 w-3 text-primary/80 shrink-0" aria-hidden />
        <span className="font-metric text-primary tracking-normal normal-case">
          {formatSpeed(totalDown)}
        </span>
      </div>
    </div>
  );
}

interface AppFooterProps {
  avgCpu: number;
  cpuSampled: number;
  totalUp: number;
  totalDown: number;
  version: string;
  customFooter?: string;
  /** Hide the whole credit line — Powered by Komari Monitor, version, theme — leaving only the custom footer text. */
  hideCredit?: boolean;
  showFooterMetaOnMobile: boolean;
}

interface FooterSegment extends FooterSegmentPriority {
  key: string;
  node: ReactNode;
}

export function AppFooter({
  avgCpu,
  cpuSampled,
  totalUp,
  totalDown,
  version,
  customFooter,
  hideCredit = false,
  showFooterMetaOnMobile,
}: AppFooterProps) {
  const { t } = useTranslation();
  const appConfig = useAppConfig();
  const footerText = customFooter?.trim() ?? '';

  // Right-hand group, in display order. Credits drop first as the bar narrows (pri-2 / pri-1);
  // the site's own footer text is never dropped, it truncates instead (full text in the tooltip).
  const segments: FooterSegment[] = [];
  if (!hideCredit) {
    segments.push({
      key: 'powered',
      pri: 2,
      node: (
        <span className="footer-pri-2 leading-none shrink-0">
          {t('footer.poweredBy')}{' '}
          <a
            href="https://github.com/komari-monitor/komari"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            Komari Monitor
          </a>
        </span>
      ),
    });
  }
  if (!hideCredit && appConfig.isLoggedIn && version) {
    segments.push({
      key: 'version',
      pri: 2,
      node: (
        <span className="footer-pri-2 font-metric tabular-nums text-muted-foreground/60 leading-none shrink-0">
          {version}
        </span>
      ),
    });
  }
  if (!hideCredit) {
    segments.push({
      key: 'theme',
      pri: 1,
      node: (
        <span className="footer-pri-1 leading-none shrink-0">
          {t('footer.theme')}{' '}
          <a
            href={THEME_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground/80 hover:text-primary hover:underline"
          >
            Tacit Soul
          </a>
        </span>
      ),
    });
  }
  if (footerText) {
    segments.push({
      key: 'custom',
      pri: null,
      node: (
        <span className="footer-custom-text min-w-0 truncate text-muted-foreground/70 leading-normal" title={footerText}>
          {footerText}
        </span>
      ),
    });
  }

  const showMetaOnMobile = showFooterMetaOnMobile || Boolean(footerText);

  return (
    <footer className="app-footer sticky bottom-0 z-40 border-t border-border/50 bg-background/85 backdrop-blur-xl relative pb-safe">
      <div className="footer-neon-line" />
      <div className="site-footer-bar container mx-auto px-3 sm:px-4 py-1.5 sm:py-2">
        <div className="flex min-h-9 w-full items-center justify-between gap-x-3 flex-nowrap overflow-hidden text-xxs sm:text-xs font-mono leading-none text-muted-foreground">
          <div className="footer-status flex min-w-0 items-center gap-x-2 sm:gap-x-3 flex-nowrap overflow-hidden">
            <WebSocketStatus />
            <FooterSep />
            <FooterLocalClock />
            {cpuSampled > 0 && (
              <>
                <FooterSep className="footer-pri-8" />
                <FooterFleetMetrics
                  className="footer-pri-8 min-w-0 overflow-hidden"
                  avgCpu={avgCpu}
                  totalUp={totalUp}
                  totalDown={totalDown}
                />
              </>
            )}
          </div>
          {segments.length > 0 && (
            <div
              className={cn(
                'footer-meta flex min-w-0 items-center gap-x-2 flex-nowrap overflow-hidden',
                !showMetaOnMobile && 'hidden sm:flex',
              )}
            >
              {segments.map((segment, index) => {
                const sep = separatorPriority(segments, index);
                return (
                  <Fragment key={segment.key}>
                    {sep !== undefined && <FooterSep className={sep == null ? undefined : `footer-pri-${sep}`} />}
                    {segment.node}
                  </Fragment>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}
