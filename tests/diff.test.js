import assert from 'node:assert/strict';
import test from 'node:test';

import { compare } from '../scripts/diff.js';

function product(id, rate, extra = {}) {
  return {
    id,
    name: `商品${id}`,
    price: Math.round(100 * rate),
    mkt: 100,
    rate,
    inStockSkus: 1,
    ...extra,
  };
}

test('识别新增与失效', () => {
  const prev = [product(1, 0.7), product(2, 0.8), product(3, 0.6)];
  const curr = [product(2, 0.7), product(4, 0.5)];
  const diff = compare(prev, curr);

  assert.deepEqual(diff.added.map((item) => item.id), [4]);
  assert.deepEqual(diff.expired.map((item) => item.id), [1, 3]);
  assert.equal('reason' in diff.expired[0], false);
  assert.deepEqual(diff.deepened.map((item) => item.id), [2]);
  assert.equal(diff.stats.total, 2);
});

test('详情失败时沿用上一份快照，不判失效', () => {
  const prev = [product(1, 0.7)];
  const diff = compare(prev, [], { failures: [{ id: 1, message: 'timeout' }] });

  assert.equal(diff.expired.length, 0);
  assert.deepEqual(diff.carried, [1]);
  assert.equal(diff.stats.total, 1);
});

test('连续失败超过 3 天按失效处理', () => {
  const prev = [product(1, 0.7, { staleDays: 3 })];
  const diff = compare(prev, [], { failures: [{ id: 1, message: 'timeout' }] });

  assert.equal(diff.carried.length, 0);
  assert.deepEqual(diff.expired.map((item) => item.id), [1]);
  assert.equal('reason' in diff.expired[0], false);
});

test('售罄导致的失效不再附带原因', () => {
  const prev = [product(1, 0.7)];
  const diff = compare(prev, [], { soldOut: [{ id: 1, name: '商品1' }] });

  assert.equal(diff.expired.length, 1);
  assert.equal('reason' in diff.expired[0], false);
  assert.equal(diff.stats.soldOut, 1);
});

test('折扣总数过少时触发异常', () => {
  const diff = compare([], [product(1, 0.7)], {});
  assert.ok(diff.anomalies.some((item) => item.type === 'too_few'));
});

test('详情失败率过高时触发异常', () => {
  const curr = Array.from({ length: 10 }, (_, index) => product(index + 1, 0.7));
  const failures = Array.from({ length: 10 }, (_, index) => ({ id: 100 + index, message: 'err' }));
  const diff = compare([], curr, { failures });
  assert.ok(diff.anomalies.some((item) => item.type === 'detail_fail'));
});

test('单日变动过大时触发异常', () => {
  const prev = Array.from({ length: 300 }, (_, index) => product(index + 1, 0.7));
  const curr = Array.from({ length: 300 }, (_, index) => product(1000 + index, 0.7));
  const diff = compare(prev, curr, {});
  assert.ok(diff.anomalies.some((item) => item.type === 'too_many_changes'));
});
