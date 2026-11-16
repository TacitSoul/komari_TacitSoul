import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { FleetRatePoint } from '@/lib/fleetRateHistory';
import type { AppliedAppearance } from '@/hooks/useTheme';
import { formatByteRateLabel } from '@/matrix/utils/format';
import { niceRateCeiling } from '@/lib/rateScale';

/*
 * (no randomised seed points), and colours follow the palette.
 */

const PAD_LEFT = 50;
const PAD_RIGHT = 14;
const PAD_TOP = 6;
const PAD_BOTTOM = 18;

function withAlpha(color: string, alpha: number): string {
  const hex = color.trim().replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  if (!/^[\da-f]{6}$/i.test(full)) return color;
  const n = Number.parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function readToken(name: string, fallback: string) {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function clockTime(ms: number) {
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((v) => String(v).padStart(2, '0')).join(':');
}

export function RateChart({
  points,
  field,
  rate,
  appearance,
}: {
  points: FleetRatePoint[];
  field: 'up' | 'down';
  /** Live value shown in the header (same poll as the newest point). */
  rate: number;
  appearance: AppliedAppearance;
}) {
  const { t } = useTranslation();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hover, setHover] = useState<{ index: number; x: number } | null>(null);

  const color = useMemo(
    () => readToken(field === 'up' ? '--ts-traffic-up' : '--ts-traffic-down', field === 'up' ? '#3b82f6' : '#2f9e65'),
    // Tokens differ per palette; re-read once the new palette is applied.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [field, appearance],
  );
  const isDark = appearance === 'dark';
  const values = useMemo(() => points.map((p) => p[field]), [points, field]);
  const hoverIndex = hover && hover.index < points.length ? hover.index : null;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { width, height } = canvas.getBoundingClientRect();
    if (width === 0 || height === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const pw = Math.max(1, Math.round(width * dpr));
    const ph = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const plotW = width - PAD_LEFT - PAD_RIGHT;
    const plotH = height - PAD_TOP - PAD_BOTTOM;
    const maxVal = niceRateCeiling(Math.max(0, ...values));

    // Reference grid + y labels
    ctx.strokeStyle = 'rgba(140, 140, 140, 0.14)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.font = `10px ${getComputedStyle(canvas).fontFamily}`;
    ctx.fillStyle = 'rgba(140, 140, 140, 0.75)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 2; i++) {
      const y = PAD_TOP + (plotH / 2) * i;
      ctx.beginPath();
      ctx.moveTo(PAD_LEFT, y);
      ctx.lineTo(width - PAD_RIGHT, y);
      ctx.stroke();
      ctx.fillText(formatByteRateLabel(maxVal * (1 - i / 2)), PAD_LEFT - 5, y);
    }
    ctx.setLineDash([]);

    if (points.length === 0) return;

    // Time labels (first / middle / last sample)
    ctx.textBaseline = 'top';
    const first = points[0].time;
    const last = points[points.length - 1].time;
    const steps = points.length < 2 ? 0 : plotW < 200 ? 1 : 2;
    for (let i = 0; i <= steps; i++) {
      const x = steps === 0 ? width - PAD_RIGHT : PAD_LEFT + (plotW / steps) * i;
      ctx.textAlign = steps === 0 || i === steps ? 'right' : i === 0 ? 'left' : 'center';
      const time = steps === 0 ? last : first + ((last - first) / steps) * i;
      ctx.fillText(clockTime(time), x, height - PAD_BOTTOM + 4);
    }

    const xAt = (i: number) => (points.length < 2 ? PAD_LEFT + plotW : PAD_LEFT + (i / (points.length - 1)) * plotW);
    const yAt = (v: number) => PAD_TOP + plotH - (v / maxVal) * plotH;

    if (hoverIndex != null) {
      const hx = xAt(hoverIndex);
      ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.06)' : withAlpha(color, 0.25);
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') ctx.roundRect(hx - 9, PAD_TOP - 2, 18, plotH + 4, 5);
      else ctx.rect(hx - 9, PAD_TOP - 2, 18, plotH + 4);
      ctx.fill();
      ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.28)' : color;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(hx, PAD_TOP);
      ctx.lineTo(hx, PAD_TOP + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (points.length > 1) {
      const gradient = ctx.createLinearGradient(0, PAD_TOP, 0, PAD_TOP + plotH);
      gradient.addColorStop(0, withAlpha(color, 0.22));
      gradient.addColorStop(1, withAlpha(color, 0.01));
      ctx.beginPath();
      values.forEach((v, i) => (i === 0 ? ctx.moveTo(xAt(i), yAt(v)) : ctx.lineTo(xAt(i), yAt(v))));
      ctx.lineTo(PAD_LEFT + plotW, PAD_TOP + plotH);
      ctx.lineTo(PAD_LEFT, PAD_TOP + plotH);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();

      ctx.beginPath();
      values.forEach((v, i) => (i === 0 ? ctx.moveTo(xAt(i), yAt(v)) : ctx.lineTo(xAt(i), yAt(v))));
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    values.forEach((v, i) => {
      const hovered = hoverIndex === i;
      if (hovered) {
        ctx.beginPath();
        ctx.arc(xAt(i), yAt(v), 6.5, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(color, 0.25);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(xAt(i), yAt(v), hovered ? 3.3 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = hovered ? 2 : 1.5;
      ctx.stroke();
    });
  }, [color, hoverIndex, isDark, points, values]);

  useEffect(() => {
    const id = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(id);
  }, [draw]);

  useEffect(() => {
    const target = wrapRef.current;
    if (!target || typeof ResizeObserver === 'undefined') return;
    let frame: number | null = null;
    const observer = new ResizeObserver(() => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        draw();
      });
    });
    observer.observe(target);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [draw]);

  const onPointer = (event: PointerEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || points.length < 2) return;
    const rect = canvas.getBoundingClientRect();
    const plotW = rect.width - PAD_LEFT - PAD_RIGHT;
    if (plotW <= 0) return;
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left - PAD_LEFT) / plotW));
    const index = Math.round(ratio * (points.length - 1));
    setHover({ index, x: PAD_LEFT + (index / (points.length - 1)) * plotW });
  };

  const title = field === 'up' ? t('cluster.uploadNet') : t('cluster.downloadNet');
  const hovered = hoverIndex != null ? points[hoverIndex] : null;

  return (
    <div className="cluster-chart-card">
      <div className="cluster-chart-head">
        <div className="cluster-chart-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            {field === 'up' ? (
              <><path d="m18 15-6-6-6 6" /><path d="M12 9v12" /></>
            ) : (
              <><path d="m6 9 6 6 6-6" /><path d="M12 3v12" /></>
            )}
          </svg>
          <span>{title}</span>
        </div>
        <span className="cluster-chart-rate" style={{ color }}>
          {field === 'up' ? '↑' : '↓'} {formatByteRateLabel(rate)}
        </span>
      </div>
      <div
        ref={wrapRef}
        className="cluster-chart-canvas-wrap"
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={() => setHover(null)}
        onPointerCancel={() => setHover(null)}
      >
        <canvas
          ref={canvasRef}
          className="cluster-chart-canvas"
          role="img"
          aria-label={`${title} ${formatByteRateLabel(rate)}`}
        />
        {hovered && hover && (
          <div className="cluster-chart-tooltip" style={{ left: `clamp(60px, ${hover.x}px, calc(100% - 60px))` }}>
            <div className="cluster-chart-tooltip-time">{clockTime(hovered.time)}</div>
            <div className="cluster-chart-tooltip-row">
              <span className="cluster-chart-tooltip-label">
                <i style={{ background: color }} />
                {field === 'up' ? t('cluster.upload') : t('cluster.download')}
              </span>
              <span className="cluster-chart-tooltip-val" style={{ color }}>
                {formatByteRateLabel(hovered[field])}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
