import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, root), 'utf8');
const variable = (css: string, name: string) => css.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim();

describe('shared monitoring typography', () => {
  it('puts genuine local Microsoft YaHei first, with explicit Chinese fallbacks', () => {
    const css = read('src/index.css');
    const family = variable(css, '--font-sans');
    expect(family).toMatch(/^"Microsoft YaHei",\s*"微软雅黑"/);
    expect(family).toContain('"PingFang SC"');
    expect(family).toContain('"Noto Sans CJK SC"');
    expect(variable(css, '--font-family-display')).toBe('var(--font-sans)');
  });

  it('uses the same UI family for legacy metric and HUD utility classes', () => {
    const css = read('src/index.css');
    const blocks = [...css.matchAll(/\.(?:font-mono|font-metric|type-hud-label|type-hud-label-sm|type-hud-column|type-metric-hero|type-metric-md|type-metric-lg|type-metric-xl)\s*\{([^}]+)\}/g)];
    expect(blocks.length).toBeGreaterThan(6);
    for (const [, body] of blocks) expect(variable(body, 'font-family')).toBe('var(--font-sans)');
  });

  it('routes matrix and numeric fonts to the same family rather than Inter', () => {
    const css = read('src/matrix/styles/tokens.css');
    expect(variable(css, '--ts-font-sans')).toBe('var(--font-sans)');
    expect(variable(css, '--ts-font-numeric')).toBe('var(--font-sans)');
  });

  it('removes hard-coded monospace overrides from fleet and table UI', () => {
    expect(read('src/components/fleet/fleet-panel.css')).not.toMatch(/font-family:\s*ui-monospace/);
    expect(variable(read('src/components/table/tacit-table.css'), '--tt-mono')).toBe('var(--font-sans)');
  });

  it('does not fetch competing Google or Inter webfonts', () => {
    expect(read('index.html')).not.toMatch(/fonts\.googleapis|fonts\.gstatic|Orbitron|IBM.Plex/);
    for (const name of ['src/components/cards/tacit-card.css', 'src/matrix/styles/card.css', 'src/matrix/styles/cluster.css']) {
      expect(read(name)).not.toContain('@fontsource-variable/inter');
    }
    expect(read('vite.config.ts')).not.toContain('google-fonts-webfonts');
  });

  it('keeps code-specific monospace separate without relabelling another font as YaHei', () => {
    const name = new URL('src/styles/monitor-ui.css', root);
    const css = existsSync(name) ? readFileSync(name, 'utf8') : '';
    expect(css).toContain('var(--font-code)');
    expect(css).toContain('pre');
    expect(css).toContain('code');
    expect(css).not.toMatch(/@font-face|https?:/);
  });

  it('defines shared surface and control styling for all five views', () => {
    const name = new URL('src/styles/monitor-ui.css', root);
    const css = existsSync(name) ? readFileSync(name, 'utf8') : '';
    for (const selector of ['.mcard', '.server-card', '.ztable', '.fleet-panel', '.uptime-summary', '.view-tabs']) expect(css).toContain(selector);
    expect(css).toContain('min-height: 44px');
    expect(css).not.toContain('!important');
    expect(read('src/main.tsx')).toContain("import './styles/monitor-ui.css'");
  });

  it('lets the bandwidth canvas labels inherit the same UI font without altering chart data', () => {
    const source = read('src/components/fleet/RateChart.tsx');
    expect(source).not.toContain('Inter Variable');
    expect(source).toContain('getComputedStyle(canvas).fontFamily');
  });

  it('reserves measured phone chrome space so the fleet peek row stays above the footer', () => {
    const css = read('src/styles/monitor-ui.css');
    expect(css).toMatch(/main \.globe-monitor-layout\s*\{\s*height:\s*calc\(100dvh - var\(--monitor-mobile-chrome, 9\.5rem\)\)/);
    expect(read('src/components/GlobeView.tsx')).toContain('globe-monitor-layout');
    const measure = read('src/components/layout/MonitorLayoutMetrics.tsx');
    expect(measure).toContain('ResizeObserver');
    expect(measure).toContain('padding.paddingBottom');
    expect(measure).not.toContain('getContext');
    expect(read('src/main.tsx')).toContain('<MonitorLayoutMetrics />');
  });

  it('keeps phone utilities beside the brand so view targets do not compete for one narrow row', () => {
    const source = read('src/components/layout/AppHeader.tsx');
    const first = source.indexOf('data-mobile-header');
    const second = source.indexOf('data-mobile-toolbar');
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
    expect(source.slice(first, second)).toContain('<HeaderUtilityControls layout="mobile" />');
    expect(source.slice(second)).not.toContain('<HeaderUtilityControls layout="mobile" />');
  });
});
