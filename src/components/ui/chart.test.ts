import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ChartContainer, ChartLegendContent } from './chart';

// ResponsiveContainer needs layout measurements; the legend itself does not.
vi.mock('recharts', async importOriginal => ({
  ...await importOriginal<typeof import('recharts')>(),
  ResponsiveContainer: ({ children }: { children: ReactNode }) => children,
}));

function renderLegend(props: Partial<Parameters<typeof ChartLegendContent>[0]> = {}) {
  return renderToStaticMarkup(createElement(ChartContainer, {
    config: { cpu: { label: 'CPU' }, ram: { label: 'Memory' } },
    children: createElement(ChartLegendContent, {
      payload: [
        { dataKey: 'cpu', value: 'cpu', color: 'red' },
        { dataKey: 'ram', value: 'ram', color: 'blue' },
      ],
      ...props,
    }),
  }));
}

describe('ChartLegendContent keyboard access', () => {
  it('renders interactive entries as native buttons with pressed state and a focus ring', () => {
    const html = renderLegend({ onClick: vi.fn(), inactiveDataKeys: { ram: true } });
    expect(html.match(/<button /g)).toHaveLength(2);
    expect(html).toContain('type="button" aria-pressed="true"');
    expect(html).toContain('type="button" aria-pressed="false"');
    expect(html).toContain('focus-visible:ring-2');
    expect(html).toContain('bg-transparent');
    expect(html).toContain('Memory</span></button>');
  });

  it('treats either an onClick handler or an inactive map as interactive', () => {
    expect(renderLegend({ onClick: vi.fn() })).toContain('<button ');
    expect(renderLegend({ inactiveDataKeys: {} })).toContain('<button ');
  });

  it('keeps noninteractive legends as plain elements', () => {
    const html = renderLegend();
    expect(html).not.toContain('<button');
    expect(html).not.toContain('aria-pressed');
    expect(html).toContain('CPU</span></div>');
  });
});
