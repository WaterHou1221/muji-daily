import {
  EXCLUDE_CAT1,
  EXCLUDE_CAT2,
  M_SIZE_CDS,
  M_SIZE_TOP,
  NAME_FILTER_CAT1,
} from './config.js';
import { resolveCategory } from './discount.js';

const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toUpperCase();

const EXCLUDE_CAT1_SET = new Set(EXCLUDE_CAT1.map(normalize));
const EXCLUDE_CAT2_SET = new Set(EXCLUDE_CAT2.map(normalize));
const NAME_FILTER_SET = new Set(NAME_FILTER_CAT1.map(normalize));
const M_SIZE_CD_SET = new Set(M_SIZE_CDS.map((code) => String(code).trim()));
const M_SIZE_TOP_NORM = normalize(M_SIZE_TOP);

export const FEMALE_PATTERN = /女式|女士|女款|女性|^女/;
export const FEMALE_EXCLUDE_PATTERN = /男女通用|中性/;

export function normalizeCategory(value) {
  return normalize(value);
}

export function hasFemaleKeyword(name) {
  const text = String(name || '').trim();
  if (FEMALE_EXCLUDE_PATTERN.test(text)) return false;
  return FEMALE_PATTERN.test(text);
}

export function isMSizeSku(sku) {
  return M_SIZE_CD_SET.has(String(sku?.sizeCd ?? '').trim());
}

/**
 * 三层过滤：① 分类黑名单 ② 指定分类里名称含“女” ③ 衣服·杂货 的 M 号（sizeCd=003）有货门槛。
 * 返回 { drop, layer, cat }，layer 取 category / name / msize。
 */
export function evaluateFilters(detail, base, index) {
  const cat = resolveCategory(detail, base, index);
  const name = String(detail.name || '').trim();

  if (EXCLUDE_CAT1_SET.has(normalize(cat.cat1))) {
    return { drop: true, layer: 'category', cat };
  }
  if (EXCLUDE_CAT2_SET.has(normalize(cat.cat2))) {
    return { drop: true, layer: 'category', cat };
  }
  if (NAME_FILTER_SET.has(normalize(cat.cat1)) && hasFemaleKeyword(name)) {
    return { drop: true, layer: 'name', cat };
  }
  if (normalize(cat.top) === M_SIZE_TOP_NORM) {
    const mSkus = (detail.skus || []).filter(isMSizeSku);
    if (mSkus.length && !mSkus.some((sku) => Number(sku.stock) > 0)) {
      return { drop: true, layer: 'msize', cat };
    }
  }

  return { drop: false, layer: null, cat };
}

/**
 * 仅审计：通过 ①② 后没有 003、但出现 026（女式M）的商品。只记日志，不过滤。
 */
export function is026OnlyAuditCandidate(detail) {
  const skus = detail.skus || [];
  const hasM = skus.some(isMSizeSku);
  if (hasM) return false;
  return skus.some((sku) => String(sku?.sizeCd ?? '').trim() === '026');
}

export function filterDetails(details, catalog, index) {
  const kept = [];
  const audit = [];
  const stats = { input: details.length, kept: 0, category: 0, name: 0, msize: 0 };

  for (const detail of details) {
    const base = catalog.get(detail.id) || {};
    const result = evaluateFilters(detail, base, index);
    if (result.drop) {
      stats[result.layer] += 1;
      continue;
    }
    kept.push(detail);
    if (is026OnlyAuditCandidate(detail)) {
      audit.push({
        id: detail.id,
        name: String(detail.name || '').trim(),
        cat1: result.cat.cat1,
      });
    }
  }

  stats.kept = kept.length;
  return { details: kept, stats, audit };
}
