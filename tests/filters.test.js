import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateFilters,
  filterDetails,
  hasFemaleKeyword,
  is026OnlyAuditCandidate,
  isMSizeSku,
} from '../scripts/filters.js';

function indexFor(cat1, cat2, top = '衣服·杂货') {
  return {
    lineMap: new Map([['LINE1', { cat1, cat2 }]]),
    topByCat1: { [cat1]: top },
  };
}

function detail(overrides = {}) {
  return {
    id: 1,
    name: '男式 测试商品',
    sex: 'Men',
    skus: [
      { sizeCd: '002', sizeName: 'S', price: 100, mktPrice: 200, stock: 1 },
      { sizeCd: '003', sizeName: 'M', price: 100, mktPrice: 200, stock: 0 },
      { sizeCd: '004', sizeName: 'L', price: 100, mktPrice: 200, stock: 3 },
    ],
    ...overrides,
  };
}

test('规则①：整类排除女式服装、童装与三级分类鞋类', () => {
  const women = evaluateFilters(detail({ name: '女式 大衣' }), { selLineCd: 'LINE1' }, indexFor('女式服装', '女式外套'));
  assert.equal(women.drop, true);
  assert.equal(women.layer, 'category');

  const kids = evaluateFilters(detail({ name: '大童 针织裤' }), { selLineCd: 'LINE1' }, indexFor('童装', '幼儿类（110-150cm）'));
  assert.equal(kids.drop, true);
  assert.equal(kids.layer, 'category');

  const shoes = evaluateFilters(detail({ name: '男式 袋鼠鞋' }), { selLineCd: 'LINE1' }, indexFor('鞋包', '鞋类'));
  assert.equal(shoes.drop, true);
  assert.equal(shoes.layer, 'category');

  const men = evaluateFilters(
    detail({ skus: [{ sizeCd: '004', sizeName: 'L', price: 100, mktPrice: 200, stock: 3 }] }),
    { selLineCd: 'LINE1' },
    indexFor('男式服装', '男式外套'),
  );
  assert.equal(men.drop, false);
});

test('规则②：四个分类里名称含“女”才排除，男女通用/中性不误伤', () => {
  assert.equal(hasFemaleKeyword('女式 法兰绒 衬衫'), true);
  assert.equal(hasFemaleKeyword('女士 开衫'), true);
  assert.equal(hasFemaleKeyword('女款 运动鞋'), true);
  assert.equal(hasFemaleKeyword('女性 内衣'), true);
  assert.equal(hasFemaleKeyword('男女通用 T恤'), false);
  assert.equal(hasFemaleKeyword('中性 香水'), false);

  const labo = evaluateFilters(
    detail({ name: 'MUJI Labo 女式 羊毛混 夹克' }),
    { selLineCd: 'LINE1' },
    indexFor('MUJI LABO', '女式外套'),
  );
  assert.equal(labo.drop, true);
  assert.equal(labo.layer, 'name');

  const idee = evaluateFilters(
    detail({ name: 'MUJI IDÉE 女式 法兰绒 长袖衬衫' }),
    { selLineCd: 'LINE1' },
    indexFor('MUJI IDÉE', '女式衬衫'),
  );
  assert.equal(idee.drop, true);
  assert.equal(idee.layer, 'name');

  const ideeHome = evaluateFilters(
    detail({ name: 'MUJI IDÉE 木质 收纳盒', skus: [{ sizeCd: '004', sizeName: 'L', price: 100, mktPrice: 200, stock: 1 }] }),
    { selLineCd: 'LINE1' },
    indexFor('MUJI IDÉE', '收纳'),
  );
  assert.equal(ideeHome.drop, false);

  const unisex = evaluateFilters(
    detail({ name: 'MUJI Labo 男女通用 夹克', skus: [{ sizeCd: '004', sizeName: 'L', price: 100, mktPrice: 200, stock: 1 }] }),
    { selLineCd: 'LINE1' },
    indexFor('MUJI LABO', '外套'),
  );
  assert.equal(unisex.drop, false);

  const notInList = evaluateFilters(
    detail({ name: '女式 大衣', sex: 'Women' }),
    { selLineCd: 'LINE1' },
    indexFor('女式服装', '女式外套'),
  );
  assert.equal(notInList.layer, 'category');
});

test('规则②：分类名多余空格也能匹配', () => {
  const result = evaluateFilters(
    detail({ name: 'MUJI Labo 女式 夹克' }),
    { selLineCd: 'LINE1' },
    { lineMap: new Map([['LINE1', { cat1: 'MUJI  LABO', cat2: '外套' }]]), topByCat1: { 'MUJI  LABO': '衣服·杂货' } },
  );
  assert.equal(result.drop, true);
  assert.equal(result.layer, 'name');
});

test('规则③：只有 sizeCd=003 算 M；M 全部无货则丢整个 SPU', () => {
  const allOut = evaluateFilters(detail(), { selLineCd: 'LINE1' }, indexFor('男式服装', '男式外套'));
  assert.equal(allOut.drop, true);
  assert.equal(allOut.layer, 'msize');

  const mInStock = evaluateFilters(
    detail({ skus: [{ sizeCd: '003', sizeName: 'M', price: 100, mktPrice: 200, stock: 2 }] }),
    { selLineCd: 'LINE1' },
    indexFor('男式服装', '男式外套'),
  );
  assert.equal(mInStock.drop, false);

  const noM = evaluateFilters(
    detail({ skus: [{ sizeCd: '004', sizeName: 'L', price: 100, mktPrice: 200, stock: 1 }] }),
    { selLineCd: 'LINE1' },
    indexFor('男式服装', '男式外套'),
  );
  assert.equal(noM.drop, false);
});

test('规则③：026（女式M）不算 M，只做审计；非衣服·杂货不触发 M 门槛', () => {
  const womenM = detail({ skus: [{ sizeCd: '026', sizeName: '女式M', price: 100, mktPrice: 200, stock: 0 }] });
  const result = evaluateFilters(womenM, { selLineCd: 'LINE1' }, indexFor('服饰杂货', '杂货'));
  assert.equal(result.drop, false);
  assert.equal(is026OnlyAuditCandidate(womenM), true);

  const home = evaluateFilters(
    detail({ name: '收纳盒' }),
    { selLineCd: 'LINE1' },
    indexFor('家具', '收纳', '生活杂货'),
  );
  assert.equal(home.drop, false);
});

test('isMSizeSku 只认 003，不认名称里的 M', () => {
  assert.equal(isMSizeSku({ sizeCd: '003', sizeName: 'M' }), true);
  assert.equal(isMSizeSku({ sizeCd: '026', sizeName: '女式M' }), false);
  assert.equal(isMSizeSku({ sizeCd: '999', sizeName: 'M' }), false);
});

test('filterDetails 汇总各层计数并输出 026 审计', () => {
  const catalog = new Map([
    [1, { selLineCd: 'LINE1', topCategory: '衣服·杂货' }],
    [2, { selLineCd: 'LINE2', topCategory: '衣服·杂货' }],
    [3, { selLineCd: 'LINE3', topCategory: '衣服·杂货' }],
    [4, { selLineCd: 'LINE4', topCategory: '衣服·杂货' }],
  ]);
  const index = {
    lineMap: new Map([
      ['LINE1', { cat1: '女式服装', cat2: '女式外套' }],
      ['LINE2', { cat1: '男式服装', cat2: '男式外套' }],
      ['LINE3', { cat1: 'MUJI LABO', cat2: '外套' }],
      ['LINE4', { cat1: '服饰杂货', cat2: '杂货' }],
    ]),
    topByCat1: { 女式服装: '衣服·杂货', 男式服装: '衣服·杂货', 'MUJI LABO': '衣服·杂货', 服饰杂货: '衣服·杂货' },
  };
  const details = [
    { ...detail({ id: 1, name: '女式 大衣' }) },
    { ...detail({ id: 2, name: '男式 夹克', skus: [{ sizeCd: '003', sizeName: 'M', price: 100, mktPrice: 200, stock: 0 }] }) },
    { ...detail({ id: 3, name: 'MUJI Labo 女式 夹克' }) },
    { ...detail({ id: 4, name: '男女通用 包', skus: [{ sizeCd: '026', sizeName: '女式M', price: 50, mktPrice: 100, stock: 0 }] }) },
  ];

  const result = filterDetails(details, catalog, index);
  assert.equal(result.stats.input, 4);
  assert.equal(result.stats.category, 1);
  assert.equal(result.stats.name, 1);
  assert.equal(result.stats.msize, 1);
  assert.equal(result.stats.kept, 1);
  assert.deepEqual(result.details.map((item) => item.id), [4]);
  assert.deepEqual(result.audit.map((item) => item.id), [4]);
});
