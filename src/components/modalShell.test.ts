import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ChartModal } from './ChartModal';
import { AssetStatsPanel } from './AssetStatsPanel';

// Keep Radix's real dialog semantics, exposing portals for server-render assertions.
vi.mock('radix-ui', async importOriginal => {
  const original = await importOriginal<typeof import('radix-ui')>();
  return {
    ...original,
    Dialog: {
      ...original.Dialog,
      Portal: ({ children }: { children: ReactNode }) => children,
    },
  };
});
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/services/api', () => ({ apiService: {} }));

describe('modal shells', () => {
  it('gives ChartModal a modal dialog role and an associated node title', () => {
    const html = renderToStaticMarkup(createElement(ChartModal, {
      nodeUuid: 'node-1', nodeName: 'Test server', onClose: vi.fn(),
    }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    const titleId = html.match(/aria-labelledby="([^"]+)"/)?.[1];
    expect(titleId).toBeTruthy();
    expect(html).toContain(`id="${titleId}">Test server</span>`);
    expect(html).toContain('z-[100]');
    expect(html).toContain('h-svh sm:h-auto sm:rounded-lg');
  });

  it('associates AssetStatsPanel with its title and description', () => {
    const html = renderToStaticMarkup(createElement(AssetStatsPanel, { nodes: [], onClose: vi.fn() }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    const titleId = html.match(/aria-labelledby="([^"]+)"/)?.[1];
    const descriptionId = html.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(titleId).toBeTruthy();
    expect(descriptionId).toBeTruthy();
    expect(html).toContain(`id="${titleId}"`);
    expect(html).toContain(`id="${descriptionId}"`);
    expect(html).toContain('assetStats.title</h2>');
    expect(html).toContain('assetStats.subtitle</p>');
    expect(html).toContain('z-[100]');
  });
});
