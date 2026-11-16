import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Progress } from './progress';

describe('Progress accessibility', () => {
  it('exposes the value and default maximum without changing the indicator', () => {
    const html = renderToStaticMarkup(createElement(Progress, { value: 35 }));
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="35"');
    expect(html).toContain('aria-valuemax="100"');
    expect(html).toContain('translateX(-65%)');
  });

  it('passes a custom maximum through and scales the indicator consistently', () => {
    const html = renderToStaticMarkup(createElement(Progress, { value: 50, max: 200 }));
    expect(html).toContain('aria-valuenow="50"');
    expect(html).toContain('aria-valuemax="200"');
    expect(html).toContain('translateX(-75%)');
  });

  it('distinguishes zero from an indeterminate value', () => {
    const zero = renderToStaticMarkup(createElement(Progress, { value: 0 }));
    const unknown = renderToStaticMarkup(createElement(Progress, { value: null }));
    expect(zero).toContain('aria-valuenow="0"');
    expect(unknown).not.toContain('aria-valuenow');
    expect(unknown).toContain('data-state="indeterminate"');
  });
});
