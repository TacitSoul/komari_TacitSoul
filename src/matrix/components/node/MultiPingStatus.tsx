import { memo, useState } from "react";
import { clsx } from "clsx";
import { useMetricColorsVersion } from "@/matrix/hooks/useMetricColors";
import { usePreferences } from "@/matrix/hooks/usePreferences";
import type { HomepagePingDisplayLine } from "@/matrix/types/komari";
import { latencyHeatColor, lossHeatColor } from "@/matrix/utils/metricTone";
import { HealthBucketTooltip } from "./HealthBucketTooltip";
import { LatencyBars } from "./LatencyBars";
import { QualityBars } from "./QualityBars";
import { formatHealthBucketTooltip } from "./pingBucketText";
import { tsText } from "@/matrix/i18n/tsText";

type MultiPingStatusDensity = "large" | "compact";

/** Visible task label: without a trailing protocol / port note in brackets. */
export function shortTaskName(name: string): string {
  const short = name.replace(/\s*[（(][^（）()]*(?:TCP|UDP|ICMP|HTTP|PING)[^（）()]*[）)]\s*$/i, "").trim();
  return short || name;
}
type MultiPingMetric = "latency" | "loss";

const MultiPingMetricRow = memo(function MultiPingMetricRow({
  line,
  metric,
  density,
  redrawKey,
}: {
  line: HomepagePingDisplayLine;
  metric: MultiPingMetric;
  density: MultiPingStatusDensity;
  redrawKey: string;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const latencyColor = latencyHeatColor(line.lastValue);
  const lossColor = lossHeatColor(line.loss);
  const isLoading = line.loadState === "pending";
  const isError = line.loadState === "error";
  const isUnassigned = line.isAssigned === false;
  const staleError = isError && (line.lastValue != null || line.loss != null);
  const latencyLabel =
    isUnassigned
      ? tsText("后台未绑定")
      : isLoading && line.lastValue == null
      ? tsText("加载中")
      : isError && line.lastValue == null
        ? tsText("加载失败")
        : line.lastValue == null
          ? tsText("无样本")
          : `${Math.round(line.lastValue)}ms`;
  const lossLabel =
    isUnassigned
      ? tsText("后台未绑定")
      : isLoading && line.loss == null
      ? tsText("加载中")
      : isError && line.loss == null
        ? tsText("加载失败")
        : line.loss == null
          ? "—"
          : `${line.loss.toFixed(1)}%`;
  const hoveredBucket =
    hoveredIndex == null ? null : (line.buckets[hoveredIndex] ?? null);
  const tooltip = hoveredBucket
    ? formatHealthBucketTooltip(hoveredBucket, metric)
    : null;
  const chartHeight = density === "compact" ? 9 : 11;
  const value = metric === "latency" ? line.lastValue : line.loss;
  const valueColor = metric === "latency" ? latencyColor : lossColor;
  const unit = metric === "latency" ? "ms" : "%";
  const waiting = isLoading && value == null;
  const displayValue =
    waiting
      ? "..."
      : isError && value == null
        ? "!"
        : value == null
          ? "—"
          : metric === "latency"
            ? Math.round(value)
            : value.toFixed(1);
  return (
    <div
      className="multi-ping-metric-row"
      data-load-state={line.loadState ?? "ready"}
      data-assigned={line.isAssigned ? "true" : "false"}
      title={
        isUnassigned
          ? tsText("{0} · 后台未绑定该服务器", line.taskName)
          : tsText("{0} · 延迟 {1} · 丢包 {2}{3}", line.taskName, latencyLabel, lossLabel, staleError ? tsText(" · 刷新失败，显示上次数据") : "")
      }
    >
      <div
        className={clsx(
          "multi-ping-metric-head",
          metric === "loss" && "is-value-only",
        )}
      >
        {metric === "latency" && (
          <span className="multi-ping-name-wrap">
            <span className="multi-ping-name">{shortTaskName(line.taskName)}</span>
            {isUnassigned && <span className="multi-ping-unassigned">{tsText("未绑定")}</span>}
          </span>
        )}
        <strong
          className="multi-ping-value tabular"
          style={{
            color: value == null ? "var(--ts-text-tertiary)" : valueColor,
          }}
        >
          {displayValue}
          {value != null && <small>{unit}</small>}
        </strong>
      </div>
      <span className="multi-ping-buckets">
        {metric === "latency" ? (
          <LatencyBars
            buckets={line.buckets}
            redrawKey={redrawKey}
            height={chartHeight}
            onHoverIndex={setHoveredIndex}
          />
        ) : (
          <QualityBars
            buckets={line.buckets}
            redrawKey={redrawKey}
            height={chartHeight}
            onHoverIndex={setHoveredIndex}
          />
        )}
        <HealthBucketTooltip
          text={tooltip}
          index={hoveredIndex}
          count={line.buckets.length}
        />
      </span>
    </div>
  );
});

const MultiPingMetricColumn = memo(function MultiPingMetricColumn({
  lines,
  metric,
  density,
  redrawKey,
}: {
  lines: HomepagePingDisplayLine[];
  metric: MultiPingMetric;
  density: MultiPingStatusDensity;
  redrawKey: string;
}) {
  return (
    <div
      className="multi-ping-metric-column"
      aria-label={metric === "latency" ? tsText("延迟") : tsText("丢包")}
    >
      {lines.map((line) => (
        <MultiPingMetricRow
          key={line.taskId}
          line={line}
          metric={metric}
          density={density}
          redrawKey={redrawKey}
        />
      ))}
    </div>
  );
});

export const MultiPingStatus = memo(function MultiPingStatus({
  lines,
  density,
  className,
}: {
  lines: HomepagePingDisplayLine[];
  density: MultiPingStatusDensity;
  className?: string;
}) {
  const { resolvedAppearance } = usePreferences();
  const colorsVersion = useMetricColorsVersion();
  const redrawKey = `${resolvedAppearance}:${colorsVersion}`;

  return (
    <div
      className={clsx("multi-ping-status", `is-${density}`, className)}
      role="group"
      aria-label={tsText("三网延迟与丢包")}
    >
      <div className="multi-ping-columns">
        <MultiPingMetricColumn
          lines={lines}
          metric="latency"
          density={density}
          redrawKey={redrawKey}
        />
        <MultiPingMetricColumn
          lines={lines}
          metric="loss"
          density={density}
          redrawKey={redrawKey}
        />
      </div>
    </div>
  );
});
