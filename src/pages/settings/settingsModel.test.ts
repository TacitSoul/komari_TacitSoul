import { describe, expect, it } from 'vitest';
import {
  completeMultiPingTaskIds,
  draftFromSettings,
  draftSignature,
  mergeDraftIntoSettings,
  multiPingSlots,
  parseTrafficResetDay,
  updateMultiPingSlot,
  validateDraft,
} from './settingsModel';

describe('settings model', () => {
  it('reads and writes the footer credit switch', () => {
    expect(draftFromSettings({}).hide_footer_credit).toBe(false);
    expect(draftFromSettings({ hide_footer_credit: 'true' }).hide_footer_credit).toBe(true);
    const baseline = draftFromSettings({ custom_footer: 'ICP 123' });
    const { settings } = mergeDraftIntoSettings({ custom_footer: 'ICP 123', other: 1 }, { ...baseline, hide_footer_credit: true }, baseline);
    expect(settings).toEqual({ custom_footer: 'ICP 123', other: 1, hide_footer_credit: true });
  });

  it('fills defaults for an empty record', () => {
    const draft = draftFromSettings({});
    expect(draft.default_view).toBe('globe');
    expect(draft.enable_matrix).toBe(true);
    expect(draft.showLatency).toBe(true);
    expect(draft.enableHomepageMultiPing).toBe(false);
    expect(draft.homepagePingBindings).toEqual({});
    expect(draft.default_theme).toBe('clean');
    expect(draft.cardProgressLayout).toBe('2col');
    expect(draft.trafficSplitColor).toBe(true);
  });

  it('keeps card layout keys under their expected names', () => {
    const draft = draftFromSettings({ cardProgressLayout: '1col', trafficSplitColor: false });
    expect(draft.cardProgressLayout).toBe('1col');
    expect(draft.trafficSplitColor).toBe(false);
    expect(draftFromSettings({ cardProgressLayout: '3col' }).cardProgressLayout).toBe('2col');
  });

  it('accepts string booleans and legacy palette names written by other tools', () => {
    const draft = draftFromSettings({ enable_globe: 'false', default_theme: 'clean', default_view: 'matrix' });
    expect(draft.enable_globe).toBe(false);
    expect(draft.default_theme).toBe('clean');
    expect(draft.default_view).toBe('matrix');
  });

  it('keeps keys it does not manage when merging', () => {
    const { settings: merged } = mergeDraftIntoSettings(
      { someOtherThemeKey: 1, showLatency: true },
      draftFromSettings({ showLatency: false }),
      draftFromSettings({}),
    );
    expect(merged.someOtherThemeKey).toBe(1);
    expect(merged.showLatency).toBe(false);
  });

  it('never writes the simulated-latency switch', () => {
    const draft = draftFromSettings({ fakePingForUnbound: true });
    expect('fakePingForUnbound' in draft).toBe(false);
  });

  it('requires three distinct tasks in three-line mode', () => {
    const base = draftFromSettings({});
    expect(validateDraft({ ...base, enableHomepageMultiPing: true, homepageMultiPingTaskIds: [1, 2] })).toContain(
      'multiPingIncomplete',
    );
    expect(validateDraft({ ...base, enableHomepageMultiPing: true, homepageMultiPingTaskIds: [1, 2, 3] })).toEqual([]);
    expect(validateDraft({ ...base, enableHomepageMultiPing: false, homepageMultiPingTaskIds: [] })).toEqual([]);
  });

  it('signature ignores key order', () => {
    const a = draftFromSettings({ showLatency: false, enable_matrix: false });
    const b = { ...draftFromSettings({}), enable_matrix: false, showLatency: false };
    expect(draftSignature(a)).toBe(draftSignature(b));
  });

  it.each([
    { homepagePingBindings: { 1: ['node-a'] } },
    { homepageMultiPingNodeTaskIds: { 'node-a': [1, 2, 3] } },
    { trafficResetDays: { 'node-a': 2 } },
  ])('signature detects a nested-only change: %j', (change) => {
    const base = draftFromSettings({});
    expect(draftSignature({ ...base, ...change })).not.toBe(draftSignature(base));
  });

  it('signature sorts nested keys but preserves array order', () => {
    const a = draftFromSettings({ homepageMultiPingNodeTaskIds: { b: [1, 2, 3], a: [3, 2, 1] }, trafficResetDays: { b: 2, a: 1 } });
    const b = { ...a, homepageMultiPingNodeTaskIds: { a: [3, 2, 1], b: [1, 2, 3] }, trafficResetDays: { a: 1, b: 2 } };
    expect(draftSignature(a)).toBe(draftSignature(b));
    expect(draftSignature({ ...b, homepageMultiPingNodeTaskIds: { ...b.homepageMultiPingNodeTaskIds, a: [1, 2, 3] } })).not.toBe(draftSignature(a));
  });

  it('keeps another tab\'s unrelated change when saving the footer', () => {
    const baseline = draftFromSettings({});
    const { settings, conflicts } = mergeDraftIntoSettings(
      { showCostsToGuests: false, homeGroupOrder: ['b', 'a'], homeRegionOrder: ['US', 'CN'], futureSetting: { enabled: true } },
      { ...baseline, custom_footer: 'new footer' },
      baseline,
    );
    expect(settings).toEqual({
      showCostsToGuests: false, custom_footer: 'new footer', homeGroupOrder: ['b', 'a'],
      homeRegionOrder: ['US', 'CN'], futureSetting: { enabled: true },
    });
    expect(conflicts).toEqual([]);
  });

  it('merges reset days and multi-ping overrides per node, including removals', () => {
    const baseline = draftFromSettings({ trafficResetDays: { a: 1, b: 2 }, homepageMultiPingNodeTaskIds: { a: [1, 2, 3], b: [1, 2, 3] } });
    const edited = { ...baseline, trafficResetDays: { b: 2 }, homepageMultiPingNodeTaskIds: { a: [3, 2, 1], b: [1, 2, 3] } };
    const { settings, conflicts } = mergeDraftIntoSettings({
      trafficResetDays: { a: 1, b: 5, c: 8 },
      homepageMultiPingNodeTaskIds: { a: [1, 2, 3], b: [4, 5, 6], c: [7, 8, 9] },
    }, edited, baseline);
    expect(settings.trafficResetDays).toEqual({ b: 5, c: 8 });
    expect(settings.homepageMultiPingNodeTaskIds).toEqual({ a: [3, 2, 1], b: [4, 5, 6], c: [7, 8, 9] });
    expect(conflicts).toEqual([]);
  });

  it('merges single-line moves per node even when both admins edit the same task', () => {
    const baseline = draftFromSettings({ homepagePingBindings: { 1: ['a', 'b'] } });
    const edited = { ...baseline, homepagePingBindings: { 1: ['b'], 2: ['a'] } };
    const { settings, conflicts } = mergeDraftIntoSettings({ homepagePingBindings: { 1: ['a'], 3: ['b', 'c'] } }, edited, baseline);
    expect(settings.homepagePingBindings).toEqual({ 2: ['a'], 3: ['b', 'c'] });
    expect(conflicts).toEqual([]);
  });

  it('removes a single binding without removing another admin\'s addition', () => {
    const baseline = draftFromSettings({ homepagePingBindings: { 1: ['a'] } });
    const { settings } = mergeDraftIntoSettings({ homepagePingBindings: { 1: ['a', 'b'] } }, { ...baseline, homepagePingBindings: {} }, baseline);
    expect(settings.homepagePingBindings).toEqual({ 1: ['b'] });
  });

  it('uses local edits and reports conflicts only on edited fields or nodes', () => {
    const baseline = draftFromSettings({ custom_footer: 'old', trafficResetDays: { a: 1 }, homepagePingBindings: { 1: ['a'] }, homepageMultiPingNodeTaskIds: { a: [1, 2, 3] } });
    const edited = { ...baseline, custom_footer: 'mine', trafficResetDays: {}, homepagePingBindings: { 2: ['a'] }, homepageMultiPingNodeTaskIds: { a: [3, 2, 1] } };
    const { settings, conflicts } = mergeDraftIntoSettings({ custom_footer: 'theirs', trafficResetDays: { a: 3 }, homepagePingBindings: { 3: ['a'] }, homepageMultiPingNodeTaskIds: { a: [4, 5, 6] } }, edited, baseline);
    expect(settings.custom_footer).toBe('mine');
    expect(settings.trafficResetDays).toEqual({});
    expect(settings.homepagePingBindings).toEqual({ 2: ['a'] });
    expect(settings.homepageMultiPingNodeTaskIds).toEqual({ a: [3, 2, 1] });
    expect(conflicts).toEqual(['trafficResetDays.a', 'homepagePingBindings.a', 'homepageMultiPingNodeTaskIds.a', 'custom_footer']);
  });

  it('does not change raw settings or defaults when nothing was edited', () => {
    const current = { showLatency: 'false', futureSetting: 1 };
    const baseline = draftFromSettings({});
    expect(mergeDraftIntoSettings(current, baseline, baseline)).toEqual({ settings: current, conflicts: [] });
  });

  it('retains latest values when rebasing edits made during a save', () => {
    const snapshot = draftFromSettings({ custom_footer: 'first' });
    const inFlight = { ...snapshot, custom_footer: 'second' };
    const { settings } = mergeDraftIntoSettings({ ...snapshot, showCostsToGuests: false }, inFlight, snapshot);
    expect(settings.custom_footer).toBe('second');
    expect(settings.showCostsToGuests).toBe(false);
  });

  it('selecting line three first and clearing line one never shifts other slots', () => {
    const third = updateMultiPingSlot(multiPingSlots([]), 2, 7);
    expect(third).toEqual([null, null, 7]);
    expect(completeMultiPingTaskIds(third)).toEqual([]);
    const full = updateMultiPingSlot(updateMultiPingSlot(third, 1, 5), 0, 3);
    expect(completeMultiPingTaskIds(full)).toEqual([3, 5, 7]);
    expect(updateMultiPingSlot(full, 0, null)).toEqual([null, 5, 7]);
    expect(completeMultiPingTaskIds(updateMultiPingSlot(full, 0, null))).toEqual([]);
  });

  it.each([[1, 1, 2], [1, 2], [1, null, 3], [0, 2, 3], [1.5, 2, 3], [1, 2, Infinity], [1, 2, 3, 4]])('rejects incomplete or invalid line slots: %j', (...slots) => {
    expect(completeMultiPingTaskIds(slots)).toEqual([]);
  });

  it('never treats a sparse array as a complete selection', () => {
    const sparse = new Array<number>(3);
    sparse[0] = 1;
    sparse[2] = 3;
    expect(completeMultiPingTaskIds(sparse)).toEqual([]);
  });

  it.each([
    [{ homepageMultiPingTaskIds: [1, 2, 7] }, 'multiPingUnknownTasks'],
    [{ homepageMultiPingNodeTaskIds: { a: [1, 2, 7] } }, 'nodeMultiPingUnknownTasks'],
    [{ homepagePingBindings: { 7: ['a'] } }, 'pingBindingsUnknownTasks'],
  ] as const)('blocks deleted tasks in %j only after task data loads', (settings, problem) => {
    const draft = draftFromSettings(settings);
    expect(validateDraft(draft)).toEqual([]);
    expect(validateDraft(draft, new Set([1, 2, 3]))).toEqual([problem]);
    expect(validateDraft(draft, new Set([1, 2, 7]))).toEqual([]);
    expect(validateDraft(draft, new Set())).toContain(problem);
  });

  it.each(['1', '2', '10', '31', '02'])('accepts a whole traffic reset day: %s', (raw) => {
    expect(parseTrafficResetDay(raw)).toEqual({ valid: true, day: Number(raw) });
  });

  it('clears the reset-day override only on empty input', () => {
    expect(parseTrafficResetDay('')).toEqual({ valid: true, day: null });
  });

  it.each(['2.5', '1e1', '0', '32', '-1', '+2', ' ', ' 2', '2 ', '2\n', '2\r', 'NaN', 'Infinity', '2days'])('rejects reset day text without truncating or deleting: %s', (raw) => {
    expect(parseTrafficResetDay(raw)).toEqual({ valid: false });
  });
});
