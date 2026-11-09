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

test('识别新增、恢复原价和已下架', () => {
  const prev = [product(1, 0.7), product(2, 0.8), product(3, 0.6)];
  const curr = [product(2, 0.7), product(4, 0.5)];
  const diff = compare(prev, curr, { catalogIds: new Set([1, 2, 4]) });

  assert.deepEqual(diff.added.map((item) => item.id), [4]);
  assert.deepEqual(diff.expired.map((item) => [item.id, item.reason]), [[1, 'restored'], [3, 'delisted']]);
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

test('连续失败超过 3 天降级为数据缺失', () => {
  const prev = [product(1, 0.7, { staleDays: 3 })];
  const diff = compare(prev, [], { failures: [{ id: 1, message: 'timeout' }] });

  assert.equal(diff.carried.length, 0);
  assert.deepEqual(diff.expired.map((item) => [item.id, item.reason]), [[1, 'missing']]);
});

test('售罄单独统计，不算失效', () => {
  const curr = [product(1, 0.7, { inStockSkus: 0 })];
  const diff = compare([], curr, {});

  assert.equal(diff.soldOut.length, 1);
  assert.equal(diff.expired.length, 0);
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
  const diff = compare(prev, curr, { catalogIds: new Set() });
  assert.ok(diff.anomalies.some((item) => item.type === 'too_many_changes'));
});
