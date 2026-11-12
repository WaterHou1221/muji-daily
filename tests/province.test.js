import assert from 'node:assert/strict';
import test from 'node:test';

import { isKnownProvince } from '../scripts/crawl.js';

const provinces = [
  { shortCd: '11', name: '北京市' },
  { shortCd: '31', name: '上海市' },
  { shortCd: '44', name: '广东省' },
];

test('两位省级短码可以通过校验', () => {
  assert.equal(isKnownProvince('31', provinces), true);
  assert.equal(isKnownProvince(11, provinces), true);
});

test('六位行政区码不是合法 provinceCd', () => {
  assert.equal(isKnownProvince('310000', provinces), false);
  assert.equal(isKnownProvince('999999', provinces), false);
});

test('空值与空列表安全返回 false', () => {
  assert.equal(isKnownProvince('', provinces), false);
  assert.equal(isKnownProvince('31', []), false);
  assert.equal(isKnownProvince('31', null), false);
});
