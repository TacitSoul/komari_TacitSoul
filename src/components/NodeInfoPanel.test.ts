import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { NodeWithStatus } from '@/services/api';
import { NodeInfoPanel } from './NodeInfoPanel';

vi.mock('@/hooks/useAppConfig', () => ({ useAppConfig: () => ({ isLoggedIn: false }) }));
vi.mock('@/matrix/hooks/useMediaQuery', () => ({ useMediaQuery: () => true }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function renderMobileLoad(load1: number) {
  const node = {
    uuid: 'viewport-fixture', name: 'fixture', status: 'online', cpu_cores: 80, price: -1,
    stats: {
      cpu: { usage: 1 }, ram: { used: 5, total: 10 }, disk: { used: 40, total: 100 }, swap: { used: 0, total: 0 },
      network: { up: 1, down: 2, totalUp: 3, totalDown: 4 }, load: { load1, load5: 110, load15: 100 },
      uptime: 3600, process: 2,
    },
  } as NodeWithStatus;
  return renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(TooltipProvider, null, createElement(NodeInfoPanel, { node }))));
}

describe('mobile load severity', () => {
  it.each([{ value: 120, tone: 'text-destructive' }, { value: 100, tone: 'text-warning' }])(
    'keeps $tone on the visible minute readout at $value', ({ value, tone }) => {
      const cls = renderMobileLoad(value).match(new RegExp(`<div class="(type-metric-md[^"]*)">${value.toFixed(2).replace('.', '\\.')}</div>`))?.[1];
      expect(cls?.split(/\s+/)).toContain(tone);
    },
  );
});
