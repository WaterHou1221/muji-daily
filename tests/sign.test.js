import assert from 'node:assert/strict';
import test from 'node:test';

import { sign } from '../scripts/muji-api.js';

test('签名对已知参数输出固定值', () => {
  assert.equal(sign({ currentPage: 1, perPage: 500 }), '6EF06774DB95AB02F8D7BAFE974B39E7');
  assert.equal(sign({ id: 97255, provinceCd: '310000' }), '420D501586CB067F4A3C9E6141DC49C5');
});

test('参数顺序不影响签名', () => {
  assert.equal(sign({ b: 2, a: 1 }), sign({ a: 1, b: 2 }));
});

test('undefined、null 和对象字段被跳过', () => {
  assert.equal(sign({ a: 1, b: undefined, c: null, d: { x: 1 } }), sign({ a: 1 }));
});

test('空参数只对密钥取摘要', () => {
  assert.equal(sign({}), sign());
});
