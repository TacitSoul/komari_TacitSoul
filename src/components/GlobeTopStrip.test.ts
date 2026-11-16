import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { GlobeTopStrip } from './GlobeTopStrip';
import type { NodeWithStatus } from '@/services/api';
import en from '@/locales/en.json';
import hans from '@/locales/zh-Hans.json';
import hant from '@/locales/zh-Hant.json';

const languages = [
  { language: 'zh-Hans', resource: hans, title: '节点分布', regions: '1 个地区', healthy: '全部在线', pause: '暂停旋转', resume: '继续旋转', empty: '暂无节点' },
  { language: 'zh-Hant', resource: hant, title: '節點分佈', regions: '1 個地區', healthy: '全部線上', pause: '暫停旋轉', resume: '繼續旋轉', empty: '暫無節點' },
  { language: 'en', resource: en, title: 'Node distribution', regions: '1 region', healthy: 'All online', pause: 'Pause rotation', resume: 'Resume rotation', empty: 'No nodes yet' },
] as const;

function node(overrides: Partial<NodeWithStatus> = {}): NodeWithStatus {
  return {
    uuid: 'test-node', name: 'Server', cpu_name: '', virtualization: '', arch: '', cpu_cores: 2,
    os: 'Linux', gpu_name: '', region: 'US', mem_total: 100, swap_total: 0, disk_total: 100,
    weight: 0, price: 0, billing_cycle: 30, currency: '', expired_at: '', group: '', tags: '',
    created_at: '', updated_at: '', status: 'online', ...overrides,
  };
}

async function render(language: typeof languages[number], nodes: NodeWithStatus[], autoRotate = true) {
  const i18n = createInstance();
  await i18n.init({ lng: language.language, fallbackLng: false, resources: { [language.language]: { translation: language.resource } }, interpolation: { escapeValue: false } });
  return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(GlobeTopStrip, {
    nodes, autoRotate, onStartRotation: () => {}, onStopRotation: () => {},
  })));
}

describe.each(languages)('globe overview copy: $language', language => {
  it('uses a plain monitoring title, real region count and online state', async () => {
    const html = await render(language, [node()]);
    expect(html).toContain(`<h2 class="globe-top-strip-title">${language.title}</h2>`);
    expect(html).toContain(language.regions);
    expect(html).toContain(language.healthy);
    expect(html).toContain(language.pause);
    expect(html).not.toMatch(/MISSION OPS|Mission Ops|指挥中心|指揮中心|ALL NOMINAL|All Nominal|全部正常|║/);
  });

  it('keeps a clear resume action when rotation is paused', async () => {
    const html = await render(language, [node()], false);
    expect(html).toContain(`aria-label="${language.resume}"`);
    expect(html).toContain('data-rotation-state="paused"');
    expect(html).not.toContain(language.pause);
  });

  it('does not claim all nodes are online when the list is empty', async () => {
    const html = await render(language, []);
    expect(html).toContain(language.empty);
    expect(html).not.toContain(language.healthy);
    expect(html).not.toContain('is-healthy');
  });

  it('retains offline and load exceptions together, without decorative zero padding', async () => {
    const stats: NonNullable<NodeWithStatus['stats']> = {
      cpu: { usage: 96 }, ram: { used: 50, total: 100 }, swap: { used: 0, total: 0 },
      disk: { used: 0, total: 100 }, network: { up: 0, down: 0, totalUp: 0, totalDown: 0 },
      load: { load1: 0, load5: 0, load15: 0 }, uptime: 1, process: 1,
      connections: { tcp: 0, udp: 0 }, message: '', updated_at: '',
    };
    const html = await render(language, [node({ status: 'offline' }), node({ uuid: 'busy', stats })]);
    expect(html).toContain('is-offline');
    expect(html).toContain('is-critical');
    expect(html).not.toContain(language.healthy);
    expect(html).not.toContain('>01<');
    expect(html).toContain('role="status"');
  });
});

it('shows the real unmapped-node count rather than inventing a region', async () => {
  const html = await render(languages[0], [node({ region: 'UNKNOWN_REGION' })]);
  expect(html).toContain('1 台未定位');
  expect(html).not.toContain('1 个地区');
});

it('uses ordinary proportional UI typography without decorative animation utilities', async () => {
  const html = await render(languages[0], [node()]);
  expect(html).not.toMatch(/font-mono|font-display|uppercase|tracking-\[|animate-ping/);
});
