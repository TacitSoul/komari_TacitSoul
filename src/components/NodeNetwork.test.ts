import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NodeWithStatus } from '@/services/api';
import { NodeNetwork } from './NodeNetwork';
import { TooltipProvider } from './ui/tooltip';

const state = vi.hoisted(() => ({ privacy: false, loadError: null as string | null, loadLoading: false }));
vi.mock('@/lib/rpc2', () => ({ rpc2Client: { call: vi.fn() } }));
vi.mock('react-router-dom', () => ({ useParams: () => ({}), useNavigate: () => () => {} }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { count?: number }) => `${key}${options?.count ?? ''}` }),
}));
vi.mock('@/hooks/useAppConfig', () => ({
  useAppConfig: () => ({ recordPreserveTime: 720, pingRecordPreserveTime: 24, isLoggedIn: false }),
}));
vi.mock('@/hooks/usePrivacyMode', () => ({
  usePrivacyMode: () => ({ maskName: (_uuid: string, name: string) => state.privacy ? 'masked-node' : name }),
}));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('@/hooks/useAdaptiveLoadTimeRange', () => ({ useAdaptiveLoadTimeRange: () => ['realtime', () => {}] }));
vi.mock('@/hooks/useNodeRealtimeLoadRecords', () => ({
  useNodeRealtimeLoadRecords: () => ({ records: [], loading: state.loadLoading, error: state.loadError, refresh: () => {} }),
}));
vi.mock('@/components/metric-charts', () => ({
  ConnectionsLineChart: () => null,
  NetworkTrafficAreaChart: () => null,
  PingLatencyLineChart: () => createElement('span', null, 'chart.noPingData'),
}));

beforeEach(() => {
  state.privacy = false;
  state.loadError = null;
  state.loadLoading = false;
});

const render = (props = {}) => renderToStaticMarkup(createElement(
  TooltipProvider,
  null,
  createElement(NodeNetwork, { nodeUuid: 'node-1', ...props }),
));

describe('network ping section', () => {
  it('keeps the ping range picker and refresh visible when no ping samples exist', () => {
    const html = render();
    expect(html.match(/aria-label="chart.timeRange"/g)).toHaveLength(2);
    expect(html).toContain('chart.hours6');
    expect(html).toContain('chart.days1');
    expect(html.match(/aria-label="action.refresh"/g)).toHaveLength(2);
    expect(html).toContain('chart.noPingData');
  });

  it.each(['loading', 'error'])('keeps ping controls independent of load %s', kind => {
    state.loadLoading = kind === 'loading';
    state.loadError = kind === 'error' ? 'load failed' : null;
    const html = render();
    expect(html.match(/aria-label="chart.timeRange"/g)).toHaveLength(2);
    expect(html).toContain('chart.hours6');
    expect(html).toContain('chart.noPingData');
  });
});

describe('network breadcrumb privacy', () => {
  it('masks raw prop names at render time and restores them when privacy is disabled', () => {
    expect(render({ nodeName: 'private-server' })).toContain('private-server');
    state.privacy = true;
    const masked = render({ nodeName: 'private-server' });
    expect(masked).toContain('masked-node');
    expect(masked).not.toContain('private-server');
    state.privacy = false;
    expect(render({ nodeName: 'private-server' })).toContain('private-server');
  });

  it('also masks the current node name without caching a display name', () => {
    const node = { uuid: 'node-1', name: 'raw-node-name', status: 'offline' } as NodeWithStatus;
    expect(render({ node })).toContain('raw-node-name');
    state.privacy = true;
    expect(render({ node })).not.toContain('raw-node-name');
    expect(render({ node })).toContain('masked-node');
  });
});
