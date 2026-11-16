import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CircularGauge } from './CircularGauge';

function renderGauge(value: number | null) {
  return renderToStaticMarkup(createElement(CircularGauge, { label: 'RAM', value, icon: null, status: 'normal' }));
}

describe('CircularGauge unavailable usage', () => {
  it('shows a dash without a percent sign and uses an empty finite ring for unavailable telemetry', () => {
    const html = renderGauge(null);
    expect(html).toContain('>—</span>');
    expect(html).not.toContain('%');
    expect(html).not.toMatch(/NaN|Infinity/);
    const dasharray = html.match(/stroke-dasharray="([^"]+)"/)?.[1];
    expect(dasharray).toBeDefined();
    expect(html).toContain(`stroke-dashoffset="${dasharray}"`);
  });

  it('keeps real zero usage and ordinary percentages unchanged', () => {
    expect(renderGauge(0)).toContain('>0.0</span>');
    expect(renderGauge(12.5)).toContain('>12.5</span>');
    expect(renderGauge(12.5)).toContain('>%</span>');
  });
});
