import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import type { NodeWithStatus } from '@/services/api';
import en from '@/locales/en.json';
import hans from '@/locales/zh-Hans.json';
import hant from '@/locales/zh-Hant.json';
import { ClusterStatusPanel } from './ClusterStatusPanel';

const viewport = vi.hoisted(() => ({ phone: true }));
vi.mock('@/matrix/hooks/useMediaQuery', () => ({ useMediaQuery: () => viewport.phone }));

const languages = [
  { lng: 'zh-Hans', resource: hans, expand: '展开趋势', online: '在线节点' },
  { lng: 'zh-Hant', resource: hant, expand: '展開趨勢', online: '線上節點' },
  { lng: 'en', resource: en, expand: 'Show trends', online: 'Nodes online' },
] as const;

type Language = typeof languages[number];

function node(uuid: string, status: 'online' | 'offline', up: number, down: number): NodeWithStatus {
  return {
    uuid, name: uuid, status, cpu_name: '', virtualization: '', arch: '', cpu_cores: 1,
    os: 'Linux', gpu_name: '', region: 'US', mem_total: 1, swap_total: 0, disk_total: 1,
    weight: 0, price: 0, billing_cycle: 30, currency: '', expired_at: '', group: '', tags: '',
    created_at: '', updated_at: '',
    stats: {
      cpu: { usage: 0 }, ram: { used: 0, total: 1 }, swap: { used: 0, total: 0 },
      disk: { used: 0, total: 1 }, network: { up, down, totalUp: 0, totalDown: 0 },
      load: { load1: 0, load5: 0, load15: 0 }, uptime: 1, process: 1,
      connections: { tcp: 0, udp: 0 }, message: '', updated_at: '',
    },
  };
}

async function panel(nodes: NodeWithStatus[], language: Language = languages[2], phone = true, onOpenAssetStats?: () => void) {
  viewport.phone = phone;
  const i18n = createInstance();
  await i18n.init({ lng: language.lng, fallbackLng: false, resources: { [language.lng]: { translation: language.resource } } });
  return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(ClusterStatusPanel, {
    nodes, onOpenAssetStats,
  })));
}

describe.each(languages)('phone cluster summary: $lng', (language) => {
  it('keeps the live summary visible and trend charts folded until requested', async () => {
    const html = await panel([node('first', 'online', 42, 77)], language);
    expect(html).toContain(language.expand);
    expect(html).toContain(language.online);
    expect(html).toMatch(/aria-expanded="false"[^>]*aria-controls="([^"]+)"/);
    const controls = html.match(/aria-controls="([^"]+)"/)?.[1];
    expect(html).toContain(`id="${controls}"`);
    expect(html).not.toContain('<canvas');
  });
});

it('counts offline nodes but excludes their stale bytes from live bandwidth', async () => {
  const html = await panel([node('first', 'online', 42, 77), node('old', 'offline', 999, 999)]);
  expect(html).toMatch(/>1<\/strong>\s*<small[^>]*>\/ 2<\/small>/);
  expect(html).toContain('1 offline');
  expect(html).toContain('119');
  expect(html).toContain('42 B/s');
  expect(html).toContain('77 B/s');
  expect(html).not.toContain('999');
});

it('does not report a healthy fleet or live rates for an empty list', async () => {
  const html = await panel([]);
  expect(html).toContain('No nodes yet');
  expect(html).not.toMatch(/is-healthy|0 B\/s/);
});

it('keeps the existing desktop charts visible without a phone toggle', async () => {
  const html = await panel([node('first', 'online', 42, 77)], languages[2], false);
  expect(html.match(/<canvas/g)).toHaveLength(2);
  expect(html).not.toContain('Show trends');
});

it('keeps the optional asset action available on the phone', async () => {
  const html = await panel([node('first', 'online', 42, 77)], languages[2], true, () => {});
  expect(html).toContain('class="cluster-action-btn"');
  expect(html).toContain(`aria-label="${en.assetStats.title}"`);
});
