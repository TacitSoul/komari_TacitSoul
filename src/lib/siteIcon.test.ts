import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, root), 'utf8');
const iconHref = () => read('../index.html').match(/<link\s+rel="icon"\s+href="([^"]+)"/)?.[1];

describe('administrator-owned site icons', () => {
  it('exposes only the backend custom favicon, not a theme SVG override', () => {
    const html = read('../index.html');
    const icons = [...html.matchAll(/<link\s+rel="icon"[^>]+>/g)];
    expect(icons).toHaveLength(1);
    expect(iconHref()).toMatch(/^\/favicon\.ico\?v=/);
  });

  it('uses that same backend icon for the desktop and mobile header', () => {
    const app = read('App.tsx');
    expect(app).not.toContain('getBrandLogoDataUri');
    expect(app).toContain(`const logoSrc = '${iconHref()}';`);
    expect(app).toContain('logoSrc={logoSrc}');
    const header = read('components/layout/AppHeader.tsx');
    expect([...header.matchAll(/<img src=\{logoSrc\}/g)]).toHaveLength(2);
  });

  it('does not recolor or replace the administrator icon on appearance changes', () => {
    const provider = read('hooks/useTheme.tsx');
    expect(provider).not.toContain('getBrandLogoDataUri');
    expect(provider).not.toContain('link[rel~="icon"]');
    expect(provider).toContain("meta.setAttribute('content', themeColor)");
    expect(provider).toContain('publishAppliedAppearance(');
  });

  it('keeps mutable custom icons outside both Workbox inclusion paths', () => {
    const vite = read('../vite.config.ts');
    const included = vite.match(/includeAssets:\s*\[([^\]]*)\]/s)?.[1] ?? '';
    const ignored = vite.match(/globIgnores:\s*\[([^\]]*)\]/s)?.[1] ?? '';
    for (const name of ['favicon.ico', 'favicon.svg']) {
      expect(included).not.toContain(name);
      expect(ignored).toContain(`"${name}"`);
    }
  });
});
