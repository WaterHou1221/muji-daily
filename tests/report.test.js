import assert from 'node:assert/strict';
import test from 'node:test';

import { buildReportMarkdown } from '../scripts/snapshot.js';

function product(id, rate = 0.5, extra = {}) {
  return {
    id,
    name: `商品${id}`,
    price: Math.round(100 * rate),
    mkt: 100,
    rate,
    reason: 'restored',
    ...extra,
  };
}

test('可读版日报收录全部条目，并按 25 条分页', () => {
  const added = Array.from({ length: 30 }, (_, index) => product(index + 1));
  const expired = [
    product(101, 0.7, { reason: 'restored' }),
    product(102, 0.6, { reason: 'delisted' }),
  ];
  const md = buildReportMarkdown('2026-11-09', {
    products: added,
    diff: { added, expired, soldOut: [product(103)] },
    mode: 'normal',
  });

  assert.match(md, /## 新增折扣（共 30 款）/);
  assert.match(md, /### 新增折扣（1\/2）/);
  assert.match(md, /### 新增折扣（2\/2）/);
  assert.match(md, /30\. 商品30/);
  assert.match(md, /2\. 商品102/);
  assert.doesNotMatch(md, /→/);
  assert.doesNotMatch(md, /前 50/);

  const numbered = md.split('\n').filter((line) => /^\d+\. /.test(line));
  assert.equal(numbered.length, 32);
});

test('初始化时标题为“初始基线商品”，且不截断', () => {
  const added = Array.from({ length: 60 }, (_, index) => product(index + 1));
  const md = buildReportMarkdown('2026-11-09', {
    products: added,
    diff: { added, expired: [], soldOut: [] },
    mode: 'init',
  });

  assert.match(md, /## 初始基线商品（共 60 款）/);
  assert.match(md, /### 初始基线商品（3\/3）/);
  assert.match(md, /60\. 商品60/);
});

test('无新增无失效时给出空状态', () => {
  const md = buildReportMarkdown('2026-11-09', {
    products: [],
    diff: { added: [], expired: [], soldOut: [] },
    mode: 'normal',
  });

  assert.match(md, /今日无新增折扣/);
  assert.match(md, /今日无失效折扣/);
});
