import { memo, useMemo, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Gauge, Wifi } from 'lucide-react';
import type { NodeLatencySummary } from '@/matrix/hooks/useNodeLatency';
import type { PingOverviewBucket } from '@/matrix/types/komari';
import { formatLatency, formatLoss, latencyHeatColor, lossHeatColor } from '@/matrix/utils/latencyScale';
import { formatCompactRate } from './cardFormat';

/*
 * Latency / loss / speed strip of the node card.
 * Values are the last hour from the shared latency store; colours follow the theme-wide scale.
 */

type Metric = 'latency' | 'loss';

const W = 96;
const H = 28;
const PAD_X = 4;
const PAD_Y = 4;

interface SparkPoint {
  x: number;
  y: number;
  title: string;
}

function clock(ms: number | null) {
  if (ms == null) return '';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function buildSparkline(buckets: PingOverviewBucket[], metric: Metric) {
  const values = buckets.map((b) => (metric === 'latency' ? b.value : b.loss));
  const finite = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (finite.length === 0) return null;
  // Keep a floor so small values do not fill the whole height.
  const top = Math.max(metric === 'latency' ? 220 : 10, Math.max(...finite) * 1.18);
  const graphW = W - PAD_X * 2;
  const graphH = H - PAD_Y * 2;
  const base = H - PAD_Y;
  const points: SparkPoint[] = [];
  values.forEach((value, index) => {
    if (value == null || !Number.isFinite(value)) return;
    const x = values.length === 1 ? W / 2 : PAD_X + (graphW / (values.length - 1)) * index;
    const y = base - Math.min(value / top, 1) * graphH;
    const bucket = buckets[index];
    const text = metric === 'latency' ? formatLatency(value) : formatLoss(value);
    points.push({ x, y, title: `${clock(bucket.startAt)}–${clock(bucket.endAt)} ${text}` });
  });
  const n = (v: number) => Number(v.toFixed(2));
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${n(p.x)} ${n(p.y)}`).join(' ');
  const first = points[0];
  const last = points[points.length - 1];
  const area = points.length > 1 ? `${line} L ${n(last.x)} ${base} L ${n(first.x)} ${base} Z` : '';
  return { line, area, points, last };
}

function Sparkline({ buckets, metric, label }: { buckets: PingOverviewBucket[]; metric: Metric; label: string }) {
  const data = useMemo(() => buildSparkline(buckets, metric), [buckets, metric]);
  return (
    <svg className="mcard-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <path className="mcard-spark-base" d={`M ${PAD_X} ${H - PAD_Y} H ${W - PAD_X}`} />
      {data?.area && <path className="mcard-spark-area" d={data.area} />}
      {data?.line && <path className="mcard-spark-line" d={data.line} />}
      {data?.last && <circle className="mcard-spark-dot" cx={data.last.x} cy={data.last.y} r={2} />}
      {data?.points.map((point, index) => (
        <circle key={index} className="mcard-spark-hit" cx={point.x} cy={point.y} r={6}>
          <title>{point.title}</title>
        </circle>
      ))}
    </svg>
  );
}

export const PingSummary = memo(function PingSummary({
  latency,
  up,
  down,
}: {
  latency: NodeLatencySummary;
  up: number;
  down: number;
}) {
  const { t } = useTranslation();

  const placeholder = !latency.configured
    ? t('mcard.notConfigured')
    : latency.loading
      ? t('mcard.loading')
      : latency.error
        ? t('mcard.loadFailed')
        : '—';

  const hasLatency = latency.avgLatency != null;
  const hasLoss = latency.loss != null;
  const latencyText = hasLatency ? formatLatency(latency.avgLatency) : placeholder;
  const lossText = hasLoss ? formatLoss(latency.loss) : placeholder;
  const prefix = latency.taskName ? `${latency.taskName} · ` : '';
  const latencyTitle = `${prefix}${hasLatency ? t('mcard.avgLatency', { value: latencyText }) : latencyText}`;
  const lossTitle = `${prefix}${hasLoss ? t('mcard.avgLoss', { value: lossText }) : lossText}`;
  const upText = formatCompactRate(up);
  const downText = formatCompactRate(down);
  const speedTitle = t('mcard.speedTitle', { up: upText, down: downText });

  return (
    <div className={`mcard-ping${latency.enabled ? '' : ' is-speed-only'}`}>
      {latency.enabled && (
        <>
          <section
            className={`mcard-ping-panel${hasLatency ? '' : ' is-empty'}`}
            style={hasLatency ? ({ '--tc-curve': latencyHeatColor(latency.avgLatency) } as CSSProperties) : undefined}
            title={latencyTitle}
          >
            <div className="mcard-ping-head">
              <span className="mcard-ping-icon" aria-hidden>
                <Gauge size={13} strokeWidth={2.2} />
              </span>
              <strong className="mcard-ping-value">{latencyText}</strong>
            </div>
            <Sparkline buckets={latency.buckets} metric="latency" label={`${latencyTitle} · ${t('mcard.lastHour')}`} />
          </section>
          <section
            className={`mcard-ping-panel${hasLoss ? '' : ' is-empty'}`}
            style={hasLoss ? ({ '--tc-curve': lossHeatColor(latency.loss) } as CSSProperties) : undefined}
            title={lossTitle}
          >
            <div className="mcard-ping-head">
              <span className="mcard-ping-icon" aria-hidden>
                <Wifi size={13} strokeWidth={2.2} />
              </span>
              <strong className="mcard-ping-value">{lossText}</strong>
            </div>
            <Sparkline buckets={latency.buckets} metric="loss" label={`${lossTitle} · ${t('mcard.lastHour')}`} />
          </section>
        </>
      )}
      <section className="mcard-ping-panel is-speed" title={speedTitle} aria-label={speedTitle}>
        <span className="mcard-speed is-up">
          <span className="mcard-ping-icon" aria-hidden>
            <ArrowUp size={13} strokeWidth={2.4} />
          </span>
          <strong>{upText}</strong>
        </span>
        <span className="mcard-speed is-down">
          <span className="mcard-ping-icon" aria-hidden>
            <ArrowDown size={13} strokeWidth={2.4} />
          </span>
          <strong>{downText}</strong>
        </span>
      </section>
    </div>
  );
});
