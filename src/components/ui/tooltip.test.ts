import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

vi.mock('radix-ui', async importOriginal => {
  const original = await importOriginal<typeof import('radix-ui')>();
  return {
    ...original,
    Tooltip: {
      ...original.Tooltip,
      Portal: ({ children }: { children: ReactNode }) => children,
    },
  };
});

describe('TooltipContent modal layer', () => {
  it('places both the content and arrow above the z-100 dialogs', () => {
    const html = renderToStaticMarkup(createElement(TooltipProvider, {
      children: createElement(Tooltip, { open: true },
        createElement(TooltipTrigger, {}, 'Hint'),
        createElement(TooltipContent, {}, 'Smoothing hint'),
      ),
    }));
    expect(html).toContain('data-slot="tooltip-content"');
    expect(html.match(/z-\[110\]/g)).toHaveLength(2);
    expect(html).not.toContain('z-50');
  });
});
