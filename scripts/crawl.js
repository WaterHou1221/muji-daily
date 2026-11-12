import {
  CONCURRENCY,
  PAGE_SIZE,
  PROVINCE_CD,
  REQUEST_RETRIES,
  TOP_CATEGORY_IDS,
} from './config.js';
import { get, sleep } from './muji-api.js';

const TOP_LABELS = new Map([
  [100000018, '衣服·杂货'],
  [100000020, '生活杂货'],
  [100000022, '食品'],
]);

const LIST_BASE = { provinceCd: PROVINCE_CD, deliveryType: 0, shopId: 0 };

async function fetchListPages(params) {
  const first = await get('/commodities', { ...LIST_BASE, ...params, currentPage: 1, perPage: PAGE_SIZE });
  const rows = [...(first.list || [])];
  const lastPage = first.meta?.lastPage ?? 1;
  for (let page = 2; page <= lastPage; page += 1) {
    const next = await get('/commodities', { ...LIST_BASE, ...params, currentPage: page, perPage: PAGE_SIZE });
    rows.push(...(next.list || []));
    await sleep(200);
  }
  return rows;
}

export async function fetchCategories() {
  const data = await get('/categories', {});
  return buildCategoryIndex(data.list || []);
}

export async function fetchProvinces() {
  const data = await get('/delivery/regions', { parentShortCd: '0' });
  return data.list || data || [];
}

export function isKnownProvince(code, provinces) {
  const target = String(code ?? '').trim();
  return (provinces || []).some((item) => String(item.shortCd ?? '').trim() === target);
}

export function buildCategoryIndex(list) {
  const byId = new Map(list.map((item) => [item.id, item]));
  const lineMap = new Map();
  for (const item of list) {
    if (item.grade !== 2) continue;
    const parent = byId.get(item.parentId);
    for (const line of item.selLineCds || []) {
      if (!lineMap.has(line)) {
        lineMap.set(line, { cat1: parent ? parent.cateName : '', cat2: item.cateName });
      }
    }
  }
  const topByCat1 = {};
  for (const item of list) {
    if (item.grade !== 1) continue;
    const root = byId.get(item.parentId);
    topByCat1[item.cateName] = root ? root.cateName : '';
  }
  return { lineMap, topByCat1 };
}

/**
 * 全量商品列表：一次全站分页 + 三个一级类目分别分页，取并集。
 * 单靠全站分页在排序抖动时可能漏掉个别商品，类目分页可补齐。
 */
export async function fetchCatalog() {
  const rows = await fetchListPages({ cateType: 'all' });
  for (const cateId of TOP_CATEGORY_IDS) {
    const topRows = await fetchListPages({ cateId, cateType: 'top' }).catch(() => []);
    for (const row of topRows) {
      row.topCategory = TOP_LABELS.get(cateId) || row.topCategory;
      rows.push(row);
    }
  }

  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.id)) map.set(row.id, { ...row });
    else if (row.topCategory && !map.get(row.id).topCategory) {
      map.get(row.id).topCategory = row.topCategory;
    }
  }

  return { catalog: map, list: [...map.values()] };
}

export async function fetchDetails(ids, { concurrency = CONCURRENCY, onProgress } = {}) {
  const details = [];
  const failures = [];
  let cursor = 0;
  let done = 0;

  async function worker() {
    while (true) {
      const position = cursor;
      cursor += 1;
      if (position >= ids.length) return;

      const id = ids[position];
      let lastError;
      let ok = false;
      for (let attempt = 1; attempt <= REQUEST_RETRIES && !ok; attempt += 1) {
        try {
          const detail = await get('/commodity', { id, provinceCd: PROVINCE_CD }, { retries: 1 });
          details.push(detail);
          ok = true;
        } catch (error) {
          lastError = error;
          if (attempt < REQUEST_RETRIES) await sleep(300 * attempt);
        }
      }
      if (!ok) failures.push({ id, message: lastError?.message || 'unknown' });

      done += 1;
      if (onProgress && done % 200 === 0) onProgress({ done, total: ids.length });
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, ids.length) }, () => worker());
  await Promise.all(workers);

  return { details, failures };
}
