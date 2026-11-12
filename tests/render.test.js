import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMessages, formatDateCST } from '../scripts/render.js';

function product(id, rate, extra = {}) {
  return {
    id,
    name: `商品${id}`,
    price: Math.round(100 * rate),
    mkt: 100,
    rate,
    partial: false,
    reason: 'restored',
    ...extra,
  };
}

function diffOf(added = [], expired = []) {
  return {
    added,
    expired,
    stats: { total: added.length + expired.length },
  };
}

test('日期格式为年月日加星期', () => {
  assert.equal(formatDateCST('2026-11-09'), '2026年11月9日 星期一');
  assert.equal(formatDateCST('2026-11-08'), '2026年11月8日 星期日');
});

test('无新增无失效时仍是三条消息', () => {
  const messages = buildMessages({ mode: 'normal', diff: diffOf(), date: '2026-11-09' });
  assert.equal(messages.length, 3);
  assert.equal(messages[0].type, 'text');
  assert.equal(messages[0].content, '2026年11月9日 星期一');
  assert.match(messages[1].content, /新增折扣 · 11-09（0 款）/);
  assert.match(messages[1].content, /今日无新增折扣/);
  assert.match(messages[2].content, /今日无失效折扣/);
});

test('25 款一条，26 款拆成两条且编号连续', () => {
  const added = Array.from({ length: 25 }, (_, index) => product(index + 1, 0.5));
  const onePage = buildMessages({ mode: 'normal', diff: diffOf(added), date: '2026-11-09' });
  assert.equal(onePage.length, 3);
  assert.match(onePage[1].content, /新增折扣 · 11-09（25 款）/);

  const twoPages = buildMessages({ mode: 'normal', diff: diffOf([...added, product(26, 0.5)]), date: '2026-11-09' });
  assert.equal(twoPages.length, 4);
  assert.match(twoPages[1].content, /新增折扣 · 11-09（1\/2，共 26 款）/);
  assert.match(twoPages[2].content, /新增折扣 · 11-09（2\/2，共 26 款）/);
  assert.match(twoPages[2].content, /26\. \[商品26\]/);
});

test('部分规格带标记，失效不带原因', () => {
  const added = [product(1, 0.25, { partial: true, name: '大童 针织 收腿裤', price: 50, mkt: 198 })];
  const expired = [product(2, 0.7, { reason: 'delisted', name: '法兰绒 衬衫', price: 290, mkt: 398 })];
  const messages = buildMessages({ mode: 'normal', diff: diffOf(added, expired), date: '2026-11-09' });

  assert.match(messages[1].content, /\[大童 针织 收腿裤\]\(https:\/\/www\.muji\.com\.cn\/cn\/store\/commodity\/1\)｜¥50（原¥198，2\.5折） · 部分规格/);
  assert.match(messages[2].content, /\[法兰绒 衬衫\]\(https:\/\/www\.muji\.com\.cn\/cn\/store\/commodity\/2\)｜¥290（原¥398，7\.0折）$/m);
  assert.doesNotMatch(messages[2].content, /→/);
});

test('每条消息不超过 3900 字节', () => {
  const added = Array.from({ length: 200 }, (_, index) => product(index + 1, 0.5, {
    name: `很长的商品名称用于测试字节上限第${index + 1}款`,
  }));
  const messages = buildMessages({ mode: 'normal', diff: diffOf(added), date: '2026-11-09' });
  for (const message of messages) {
    assert.ok(Buffer.byteLength(message.content, 'utf8') <= 3900);
  }
});

test('单类超过 750 款时截断并提示', () => {
  const added = Array.from({ length: 800 }, (_, index) => product(index + 1, 0.5));
  const messages = buildMessages({ mode: 'normal', diff: diffOf(added), date: '2026-11-09' });
  const addedPages = messages.filter((message) => message.content.startsWith('新增折扣'));
  assert.equal(addedPages.length, 30);
  assert.match(addedPages[29].content, /其余 50 款未发送（单日上限）/);
});

test('失效消息不再附带细分原因', () => {
  const expired = [product(1, 0.5, { reason: 'soldout', name: '【芳香油】香精油' })];
  const messages = buildMessages({ mode: 'normal', diff: diffOf([], expired), date: '2026-11-09' });
  assert.match(messages[2].content, /\[【芳香油】香精油\]\(https:\/\/www\.muji\.com\.cn\/cn\/store\/commodity\/1\)｜¥50（原¥100，5\.0折）$/m);
  assert.doesNotMatch(messages[2].content, /→|已售罄|已下架|已恢复原价/);
});

test('商品名渲染为官网详情链接', () => {
  const added = [product(97255, 0.25, {
    name: '男式 袋鼠鞋',
    price: 150,
    mkt: 598,
    url: 'https://www.muji.com.cn/cn/store/commodity/97255',
  })];
  const messages = buildMessages({ mode: 'normal', diff: diffOf(added), date: '2026-11-09' });
  assert.match(
    messages[1].content,
    /\[男式 袋鼠鞋\]\(https:\/\/www\.muji\.com\.cn\/cn\/store\/commodity\/97255\)｜¥150（原¥598，2\.5折）/,
  );
});

test('没有 url 字段时用商品 ID 拼接链接', () => {
  const messages = buildMessages({ mode: 'normal', diff: diffOf([product(12345, 0.5)]), date: '2026-11-09' });
  assert.match(messages[1].content, /\[商品12345\]\(https:\/\/www\.muji\.com\.cn\/cn\/store\/commodity\/12345\)/);
});

test('商品名中的 ASCII 方括号被替换，链接保持闭合', () => {
  const added = [product(1, 0.5, { name: '测试[限定]商品' })];
  const messages = buildMessages({ mode: 'normal', diff: diffOf(added), date: '2026-11-09' });
  assert.match(messages[1].content, /\[测试［限定］商品\]\(https:\/\/www\.muji\.com\.cn\/cn\/store\/commodity\/1\)/);
  assert.doesNotMatch(messages[1].content, /\[测试\[限定\]商品\]/);
});

test('首次运行只发一条初始化消息', () => {
  const messages = buildMessages({ mode: 'init', diff: diffOf(), date: '2026-11-09' });
  assert.equal(messages.length, 1);
  assert.match(messages[0].content, /初始化完成 · 11-09/);
  assert.match(messages[0].content, /明日起推送/);
});
