import { describe, expect, it } from 'vitest';
import { sortNodesByAdminOrder } from './nodeOrder';

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length === 0) return [[]];
  return values.flatMap((value, index) =>
    permutations(values.filter((_, other) => other !== index)).map(rest => [value, ...rest]),
  );
}

describe('sortNodesByAdminOrder', () => {
  it('sorts ascending by weight, keeping backend ranks within each equal-weight group', () => {
    const nodes = [
      { uuid: 'a', weight: 5 },
      { uuid: 'b', weight: -2 },
      { uuid: 'c', weight: 0 },
      { uuid: 'd', weight: -2 },
      { uuid: 'e', weight: 5 },
      { uuid: 'f', weight: 0 },
    ];
    const order = ['e', 'f', 'd', 'c', 'b', 'a'].map(uuid => ({ uuid }));

    expect(sortNodesByAdminOrder(nodes, order).map(node => node.uuid))
      .toEqual(['d', 'b', 'f', 'c', 'e', 'a']);
  });

  it('places unranked nodes after ranked peers, then uses creation time and UUID as fixed fallback keys', () => {
    const nodes = [
      { uuid: 'unknown-late', weight: 0, created_at: '2030-01-01T00:00:00Z' },
      { uuid: 'known-late', weight: 0, created_at: '2040-01-01T00:00:00Z' },
      { uuid: 'unknown-early', weight: 0, created_at: '1970-01-01T00:00:00Z' },
      { uuid: 'known-early', weight: 0, created_at: '1960-01-01T00:00:00Z' },
      { uuid: 'unknown-invalid', weight: 0, created_at: 'not a date' },
      { uuid: 'unknown-same-z', weight: 0, created_at: '2001-01-01T00:00:00Z' },
      { uuid: 'unknown-same-a', weight: 0, created_at: '2001-01-01T08:00:00+08:00' },
    ];
    const order = [{ uuid: 'known-early' }, { uuid: 'known-late' }];

    expect(sortNodesByAdminOrder(nodes, order).map(node => node.uuid)).toEqual([
      'known-early', 'known-late', 'unknown-early', 'unknown-same-a',
      'unknown-same-z', 'unknown-late', 'unknown-invalid',
    ]);
  });

  it.each([
    { label: 'missing', order: undefined },
    { label: 'null', order: null },
    { label: 'empty', order: [] },
    { label: 'object map', order: { z: { uuid: 'z' }, a: { uuid: 'a' } } },
    { label: 'error envelope', order: { error: { code: -32601 } } },
    { label: 'string', order: 'not an array' },
    { label: 'invalid entries', order: [null, false, 42, '', [], {}, { uuid: null }, { uuid: 1 }, { uuid: '' }] },
  ])('uses a deterministic fallback for $label order data', ({ order }) => {
    const nodes = [
      { uuid: 'z', weight: 0, created_at: '2026-01-01T00:00:00Z' },
      { uuid: 'a', weight: 0, created_at: '2026-01-01T00:00:00Z' },
      { uuid: 'old', weight: 0, created_at: '2001-01-01T00:00:00Z' },
    ];
    for (const input of permutations(nodes)) {
      expect(sortNodesByAdminOrder(input, order).map(node => node.uuid)).toEqual(['old', 'a', 'z']);
    }
  });

  it('ignores invalid UUID entries and keeps the first occurrence of a duplicate UUID', () => {
    const nodes = [{ uuid: 'a', weight: 0 }, { uuid: 'b', weight: 0 }];
    const order = [
      null, {}, [], 'a', { uuid: 12 }, { uuid: '' }, { uuid: '  ' },
      { uuid: 'b' }, { uuid: 'not-authorized' }, { uuid: 'a' }, { uuid: 'b' },
    ];
    expect(sortNodesByAdminOrder(nodes, order)).toEqual([nodes[1], nodes[0]]);
  });

  it('does not trim or otherwise repair a mismatched order UUID', () => {
    const nodes = [
      { uuid: 'a', weight: 0, created_at: '2026-01-01T00:00:00Z' },
      { uuid: 'b', weight: 0, created_at: '2025-01-01T00:00:00Z' },
    ];
    expect(sortNodesByAdminOrder(nodes, [{ uuid: ' a ' }]).map(node => node.uuid)).toEqual(['b', 'a']);
  });

  it.each([undefined, null, NaN, Infinity, -Infinity, '-100', false])(
    'treats a non-finite or non-number weight %s as zero without changing metadata', weight => {
      const invalid = Object.freeze({ uuid: 'invalid', weight });
      const nodes = [
        { uuid: 'positive', weight: 1 }, invalid, { uuid: 'negative', weight: -1 }, { uuid: 'zero', weight: 0 },
      ];
      const order = ['positive', 'zero', 'invalid', 'negative'].map(uuid => ({ uuid }));
      expect(sortNodesByAdminOrder(nodes, order).map(node => node.uuid))
        .toEqual(['negative', 'zero', 'invalid', 'positive']);
      expect(invalid.weight).toBe(weight);
    },
  );

  it('handles extreme finite weights without a NaN comparison', () => {
    const nodes = [
      { uuid: 'high', weight: Number.MAX_VALUE },
      { uuid: 'zero', weight: 0 },
      { uuid: 'low', weight: -Number.MAX_VALUE },
    ];
    expect(sortNodesByAdminOrder(nodes, []).map(node => node.uuid)).toEqual(['low', 'zero', 'high']);
  });

  it('orders missing or invalid timestamps last without substituting the current time', () => {
    const nodes = [
      { uuid: 'bad-z', created_at: '+999999-01-01T00:00:00Z' },
      { uuid: 'bad-f', created_at: 'invalid' },
      { uuid: 'bad-e', created_at: Infinity },
      { uuid: 'bad-d', created_at: 0 },
      { uuid: 'bad-c', created_at: '' },
      { uuid: 'bad-b', created_at: null },
      { uuid: 'bad-a' },
      { uuid: 'future', created_at: '9999-12-31T23:59:59Z' },
      { uuid: 'epoch', created_at: '1970-01-01T00:00:00Z' },
    ];
    expect(sortNodesByAdminOrder(nodes, undefined).map(node => node.uuid)).toEqual([
      'epoch', 'future', 'bad-a', 'bad-b', 'bad-c', 'bad-d', 'bad-e', 'bad-f', 'bad-z',
    ]);
  });

  it('keeps mixed ranked/unranked ordering transitive across every input permutation', () => {
    const nodes = [
      { uuid: 'rank-0', weight: 0, created_at: '2040-01-01T00:00:00Z' },
      { uuid: 'rank-1', weight: 0, created_at: '1960-01-01T00:00:00Z' },
      { uuid: 'unknown-between', weight: 0, created_at: '2000-01-01T00:00:00Z' },
      { uuid: 'unknown-old', weight: 0, created_at: '1950-01-01T00:00:00Z' },
      { uuid: 'unknown-invalid', weight: 0, created_at: 'invalid' },
      { uuid: 'negative-unranked', weight: -1 },
    ];
    const order = [{ uuid: 'rank-0' }, { uuid: 'rank-1' }];
    for (const input of permutations(nodes)) {
      expect(sortNodesByAdminOrder(input, order).map(node => node.uuid)).toEqual([
        'negative-unranked', 'rank-0', 'rank-1', 'unknown-old', 'unknown-between', 'unknown-invalid',
      ]);
    }
  });

  it('returns a new collection while retaining original objects and leaving both inputs immutable', () => {
    const a = Object.freeze({ uuid: 'a', name: 'Duplicate name', weight: 0, created_at: '2020-01-01' });
    const b = Object.freeze({ uuid: 'b', name: 'Duplicate name', weight: 0, created_at: '2026-01-01' });
    const nodes = Object.freeze([a, b]);
    const order = Object.freeze([Object.freeze({ uuid: 'b' }), Object.freeze({ uuid: 'a' })]);
    const result = sortNodesByAdminOrder(nodes, order);
    expect(result).not.toBe(nodes);
    expect(result[0]).toBe(b);
    expect(result[1]).toBe(a);
    expect(nodes).toEqual([a, b]);
    expect(order).toEqual([{ uuid: 'b' }, { uuid: 'a' }]);
  });

  it('retains stable input order for identical final keys instead of dropping duplicate primary entries', () => {
    const a = { uuid: 'same', weight: 0, name: 'First' };
    const b = { uuid: 'same', weight: 0, name: 'Second' };
    expect(sortNodesByAdminOrder([a, b], [])).toEqual([a, b]);
  });

  it('does not import any nodes from the order source when the authorized collection is empty', () => {
    expect(sortNodesByAdminOrder([], [{ uuid: 'extra', name: 'Not authorized' }])).toEqual([]);
  });
});
