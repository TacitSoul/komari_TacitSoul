import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { apiService } from '@/services/api';
import { useNodesContext } from '@/contexts/NodesContext';
import { createChartRequestGuard, mergeLoadRecords, nodeStatsToLoadRecord, nodeStatsToLoadRecords, type LoadRecord } from '@/lib/chart-utils';

const MAX_POINTS = 150;

export function useNodeRealtimeLoadRecords(uuid: string, enabled: boolean) {
  const { t } = useTranslation();
  const { nodes } = useNodesContext();
  const node = nodes.find(n => n.uuid === uuid);
  const [records, setRecords] = useState<LoadRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(createChartRequestGuard());

  const refresh = useCallback(async () => {
    if (!uuid || !enabled) return;
    const isCurrent = request.current.start();
    setLoading(true);
    setError(null);
    try {
      const stats = await apiService.getNodeRecentStats(uuid, { throwOnError: true });
      if (!isCurrent()) return;
      const next = nodeStatsToLoadRecords(stats);
      setRecords(prev => isCurrent() ? mergeLoadRecords(next, prev, MAX_POINTS) : prev);
    } catch {
      if (isCurrent()) setError(t('chart.fetchError'));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [uuid, enabled, t]);

  useEffect(() => {
    const guard = request.current;
    setRecords([]);
    setError(null);
    setLoading(false);
    if (enabled) refresh();
    return () => guard.invalidate();
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled || !node?.stats?.updated_at) return;
    const newRecord = nodeStatsToLoadRecord(node.stats);
    setRecords(prev => mergeLoadRecords(prev, [newRecord], MAX_POINTS));
  }, [enabled, uuid, node?.stats]);

  return { records, loading, error, refresh };
}
