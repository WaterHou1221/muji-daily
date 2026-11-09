import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDiscounts } from '../scripts/discount.js';

function detail(overrides = {}) {
  return {
    id: 1,
    name: '大童 针织 收腿裤',
    spuCd: '4550000000001',
    defaultPic: '',
    sex: 'Kids',
    series: 'X',
    seasonName: '秋',
    promotions: [{ name: 'SALE 26.8.25—27.2.28' }],
    skus: [
      { skuCd: 'a', sizeName: '120', colorName: '卡其绿', price: 50, mktPrice: 128, stock: 1 },
      { skuCd: 'b', sizeName: '110', colorName: '浅绿色', price: 50, mktPrice: 198, stock: 0 },
      { skuCd: 'c', sizeName: '130', colorName: '深蓝色', price: 198, mktPrice: 198, stock: 5 },
    ],
    ...overrides,
  };
}

test('取折扣最深的 SKU，价格三元组来自同一个规格', () => {
  const catalog = new Map([[1, { selLineCd: '', topCategory: '衣服·杂货' }]]);
  const { products } = buildDiscounts([detail()], catalog, { lineMap: new Map(), topByCat1: {} });
  assert.equal(products.length, 1);

  const product = products[0];
  assert.equal(product.price, 50);
  assert.equal(product.mkt, 198);
  assert.equal(product.rate, 0.2525);
  assert.equal(product.skuCd, 'b');
  assert.ok(product.skus.some((sku) => sku.skuCd === 'b' && sku.price === 50 && sku.mkt === 198));
});

test('部分规格折扣时标记 partial，全部折扣时不标记', () => {
  const catalog = new Map([[1, {}]]);
  const partial = buildDiscounts([detail()], catalog, { lineMap: new Map(), topByCat1: {} }).products[0];
  assert.equal(partial.partial, true);
  assert.equal(partial.skuCount, 3);
  assert.equal(partial.discSkuCount, 2);

  const allDiscounted = detail({
    skus: [
      { skuCd: 'a', price: 50, mktPrice: 100, stock: 1 },
      { skuCd: 'b', price: 60, mktPrice: 100, stock: 2 },
    ],
  });
  const full = buildDiscounts([allDiscounted], catalog, { lineMap: new Map(), topByCat1: {} }).products[0];
  assert.equal(full.partial, false);
});
