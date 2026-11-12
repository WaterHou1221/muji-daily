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

test('有 003 号 M 码时只看 M 码价格', () => {
  const catalog = new Map([[1, { selLineCd: '', topCategory: '衣服·杂货' }]]);
  const item = detail({
    name: '男式 不易沾水 风帽夹克',
    sex: 'Men',
    skus: [
      { skuCd: 's', sizeCd: '002', sizeName: 'S', colorName: '烟熏蓝色', price: 200, mktPrice: 398, stock: 1 },
      { skuCd: 'm1', sizeCd: '003', sizeName: 'M', colorName: '深藏青色', price: 290, mktPrice: 398, stock: 9 },
      { skuCd: 'm2', sizeCd: '003', sizeName: 'M', colorName: '灰色', price: 290, mktPrice: 398, stock: 2 },
    ],
  });

  const { products, mNoDiscount } = buildDiscounts([item], catalog, emptyIndex);
  assert.equal(products.length, 1);
  assert.equal(products[0].price, 290);
  assert.equal(products[0].size, 'M');
  assert.equal(products[0].pricingScope, 'M');
  assert.equal(products[0].partial, false);
  assert.equal(mNoDiscount, 0);
});

test('M 有货但 M 不折扣、其他尺码折扣时，整款不算折扣商品', () => {
  const catalog = new Map([[1, { selLineCd: '', topCategory: '衣服·杂货' }]]);
  const item = detail({
    name: '男式 不易沾水 风帽夹克',
    sex: 'Men',
    skus: [
      { skuCd: 's', sizeCd: '002', sizeName: 'S', colorName: '烟熏蓝色', price: 200, mktPrice: 398, stock: 1 },
      { skuCd: 'm', sizeCd: '003', sizeName: 'M', colorName: '深藏青色', price: 398, mktPrice: 398, stock: 5 },
    ],
  });

  const { products, mNoDiscount } = buildDiscounts([item], catalog, emptyIndex);
  assert.equal(products.length, 0);
  assert.equal(mNoDiscount, 1);
});

test('非衣服·杂货不启用 M-only 计价', () => {
  const catalog = new Map([[1, { selLineCd: '', topCategory: '生活杂货' }]]);
  const item = detail({
    name: '测试 收纳用品',
    skus: [
      { skuCd: 's', sizeCd: '002', sizeName: 'S', colorName: '灰色', price: 200, mktPrice: 398, stock: 1 },
      { skuCd: 'm', sizeCd: '003', sizeName: 'M', colorName: '灰色', price: 290, mktPrice: 398, stock: 2 },
    ],
  });

  const { products } = buildDiscounts([item], catalog, emptyIndex);
  assert.equal(products.length, 1);
  assert.equal(products[0].price, 200);
  assert.equal(products[0].pricingScope, 'all');
});

test('M 码部分颜色不折扣时标记 partial', () => {
  const catalog = new Map([[1, { selLineCd: '', topCategory: '衣服·杂货' }]]);
  const item = detail({
    name: '男式 风帽夹克',
    sex: 'Men',
    skus: [
      { skuCd: 'm1', sizeCd: '003', sizeName: 'M', colorName: '深藏青色', price: 290, mktPrice: 398, stock: 2 },
      { skuCd: 'm2', sizeCd: '003', sizeName: 'M', colorName: '灰色', price: 398, mktPrice: 398, stock: 2 },
    ],
  });

  const { products } = buildDiscounts([item], catalog, emptyIndex);
  assert.equal(products[0].price, 290);
  assert.equal(products[0].partial, true);
});
