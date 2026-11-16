import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MobileFleetSheet } from './MobileFleetSheet';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('mobile fleet sheet bounds', () => {
  it('keeps the complete peek handle above a safe-area-aware minimum and caps height to the stage and viewport', () => {
    const html = renderToStaticMarkup(createElement(MobileFleetSheet, {
      nodes: [], selectedNodeId: null, children: createElement('div', null, 'Fleet'),
    }));
    expect(html).toContain('height:8%');
    expect(html).toContain('min-height:calc(2.5rem + env(safe-area-inset-bottom, 0px))');
    expect(html).toContain('max-height:min(100%, 100dvh)');
    expect(html).toContain('flex-1 min-h-0 overflow-y-auto');
    expect(html).toContain('aria-hidden="true"');
  });
});
