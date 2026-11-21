import { useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { labelFormatter as browserLabelFormatter } from '@/lib/chart-utils';

export type MetricChartLayoutMode = 'modal' | 'detail';

export function createMetricChartTimeFormatter(language?: string, withDate = false) {
  const isChinese = /^zh(?:-|$)/i.test(language ?? '');
  const locale = isChinese ? (/(?:Hant|TW|HK|MO)(?:-|$)/i.test(language ?? '') ? 'zh-TW' : 'zh-CN') : undefined;
  const options: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    ...(isChinese && { hourCycle: 'h23' as const }),
    ...(withDate && { month: '2-digit' as const, day: '2-digit' as const, second: '2-digit' as const }),
  };
  return (value: number | string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    // Resolve the local timezone at formatting time, not when this closure is created.
    return withDate ? date.toLocaleString(locale, options) : date.toLocaleTimeString(locale, options);
  };
}

export function useMetricChartAxes(
  mode: MetricChartLayoutMode,
  chartDataLength: number,
  isMobile: boolean,
) {
  const { i18n } = useTranslation();
  const language = mode === 'detail' ? i18n.resolvedLanguage ?? i18n.language : undefined;
  const formatTime = useMemo(() => createMetricChartTimeFormatter(language), [language]);
  const labelFormatter = useMemo(() => mode === 'detail'
    ? createMetricChartTimeFormatter(language, true) : browserLabelFormatter, [language, mode]);
  const margin = useMemo(() => {
    if (mode === 'modal') {
      return { top: 8, right: 8, bottom: 4, left: 8 };
    }
    return {
      top: 10,
      right: isMobile ? 4 : 16,
      bottom: isMobile ? 20 : 10,
      left: isMobile ? 4 : 16,
    };
  }, [mode, isMobile]);

  const timeFormatterDetail = useCallback(
    (value: number | string, index: number) => {
      if (!chartDataLength) return '';
      if (index === 0 || index === chartDataLength - 1 || (!isMobile && index === Math.floor(chartDataLength / 2))) {
        return formatTime(value);
      }
      return '';
    },
    [chartDataLength, formatTime, isMobile],
  );

  const xAxisProps = useMemo(() => {
    if (mode === 'modal') {
      return {
        dataKey: 'time' as const,
        tickLine: false,
        axisLine: false,
        tickFormatter: formatTime,
        interval: 'preserveStartEnd' as const,
        minTickGap: 60,
        tick: { fontSize: 10 },
        height: 28,
      };
    }
    const tickFont = isMobile ? 10 : 11;
    const height = isMobile ? 30 : 40;
    const minTickGap = isMobile ? 50 : 30;
    return {
      dataKey: 'time' as const,
      tickLine: false,
      axisLine: false,
      tickFormatter: timeFormatterDetail,
      interval: 'preserveStartEnd' as const,
      minTickGap,
      tick: { fontSize: tickFont },
      height,
    };
  }, [mode, isMobile, formatTime, timeFormatterDetail]);

  const yAxisConfig = useMemo(
    () => ({
      tick: { fontSize: isMobile ? 10 : 12, dx: -5 },
      width: isMobile ? 35 : 40,
    }),
    [isMobile],
  );

  const yPctProps = useMemo(() => {
    const base = {
      domain: [0, 100] as [number, number],
      tickLine: false,
      axisLine: false,
      unit: '%',
      allowDecimals: false,
    };
    if (mode === 'modal') {
      return { ...base, tick: { fontSize: 10 }, width: 38 };
    }
    return {
      ...base,
      orientation: 'left' as const,
      type: 'number' as const,
      tick: yAxisConfig.tick,
      width: yAxisConfig.width,
    };
  }, [mode, yAxisConfig]);

  const yPlainProps = useMemo(() => {
    if (mode === 'modal') {
      return { tickLine: false, axisLine: false, tick: { fontSize: 10 }, width: 38 };
    }
    return {
      tickLine: false,
      axisLine: false,
      orientation: 'left' as const,
      type: 'number' as const,
      tick: yAxisConfig.tick,
      width: yAxisConfig.width,
    };
  }, [mode, yAxisConfig]);

  return { margin, xAxisProps, yPctProps, yPlainProps, yAxisConfig, labelFormatter };
}
