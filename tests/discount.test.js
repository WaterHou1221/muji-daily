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
      { skuCd: 'a', sizeName: '120', colorName: '卡其绿', price: 50, mktPrice: 128, stock: 2 },
      { skuCd: 'b', sizeName: '110', colorName: '浅绿色', price: 50, mktPrice: 198, stock: 0 },
      { skuCd: 'c', sizeName: '130', colorName: '深蓝色', price: 198, mktPrice: 198, stock: 5 },
    ],
    ...overrides,
  };
}

const emptyIndex = { lineMap: new Map(), topByCat1: {} };

test('无货规格不参与计算，也不写入 skus', () => {
  const catalog = new Map([[1, { selLineCd: '', topCategory: '衣服·杂货' }]]);
  const { products } = buildDiscounts([detail()], catalog, emptyIndex);
  assert.equal(products.length, 1);

  const product = products[0];
  assert.equal(product.price, 50);
  assert.equal(product.mkt, 128);
  assert.equal(product.rate, 0.3906);
  assert.equal(product.skuCd, 'a');
  assert.equal(product.skuCount, 2);
  assert.equal(product.discSkuCount, 1);
  assert.equal(product.partial, true);
  assert.deepEqual(product.skus.map((sku) => sku.skuCd), ['a', 'c']);
});

test('在有货的折扣规格里选折扣最深的', () => {
  const catalog = new Map([[1, {}]]);
  const item = detail({
    skus: [
      { skuCd: 'x', price: 60, mktPrice: 100, stock: 1 },
      { skuCd: 'y', price: 40, mktPrice: 100, stock: 3 },
      { skuCd: 'z', price: 20, mktPrice: 100, stock: 0 },
    ],
  });
  const product = buildDiscounts([item], catalog, emptyIndex).products[0];
  assert.equal(product.skuCd, 'y');
  assert.equal(product.price, 40);
});

test('折扣规格全部无货时，商品进入 soldOut 且不生成产品', () => {
  const catalog = new Map([[1, {}]]);
  const item = detail({
    skus: [
      { skuCd: 'x', price: 50, mktPrice: 100, stock: 0 },
      { skuCd: 'y', price: 60, mktPrice: 100, stock: 0 },
      { skuCd: 'z', price: 100, mktPrice: 100, stock: 5 },
    ],
  });
  const result = buildDiscounts([item], catalog, emptyIndex);
  assert.equal(result.products.length, 0);
  assert.equal(result.soldOut.length, 1);
  assert.equal(result.soldOut[0].id, 1);
});

test('所有有货规格都折扣时不标记 partial', () => {
  const catalog = new Map([[1, {}]]);
  const item = detail({
    skus: [
      { skuCd: 'a', price: 50, mktPrice: 100, stock: 1 },
      { skuCd: 'b', price: 60, mktPrice: 100, stock: 2 },
      { skuCd: 'c', price: 100, mktPrice: 100, stock: 0 },
    ],
  });
  const product = buildDiscounts([item], catalog, emptyIndex).products[0];
  assert.equal(product.partial, false);
  assert.equal(product.skuCount, 2);
});
