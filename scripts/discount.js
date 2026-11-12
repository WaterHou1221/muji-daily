import { M_ONLY_PRICING, M_SIZE_CDS, M_SIZE_TOP } from './config.js';

const M_SIZE_CD_SET = new Set(M_SIZE_CDS.map((code) => String(code).trim()));

function isMSizeSku(sku) {
  return M_SIZE_CD_SET.has(String(sku?.sizeCd ?? '').trim());
}

function inferCategory(name, sex) {
  const text = (name || '').trim();
  if (/^男式|^男士/.test(text)) return { cat1: '男式服装', cat2: '男式服装（自动归类）' };
  if (/^女式|^女士/.test(text)) return { cat1: '女式服装', cat2: '女式服装（自动归类）' };
  if (/^童|儿童|婴儿|宝宝|大童|孩童/.test(text)) return { cat1: '童装', cat2: '童装（自动归类）' };
  if (/MUJI Labo/i.test(text)) return { cat1: 'MUJI LABO', cat2: 'MUJI LABO（自动归类）' };
  if (/MUJI IDÉE|IDEE|PUUF/i.test(text)) return { cat1: 'MUJI IDÉE', cat2: 'MUJI IDÉE（自动归类）' };
  if (/MUJI WALKER/i.test(text)) {
    return { cat1: sex === 'Women' ? '女式服装' : '男式服装', cat2: 'MUJI WALKER（自动归类）' };
  }
  if (/文件夹|笔记本|笔|文具|胶带|便签|卡夹|相框/.test(text)) {
    return { cat1: '文具·办公用品', cat2: '文具·办公用品（自动归类）' };
  }
  if (/椅|凳|桌|柜|架|床|沙发|家具/.test(text)) return { cat1: '家具', cat2: '家具（自动归类）' };
  if (/毛巾|浴|洗|清洁|扫|拖|刷/.test(text)) {
    return { cat1: '清扫洗涤·卫浴用品', cat2: '清扫洗涤·卫浴用品（自动归类）' };
  }
  if (/收纳/.test(text)) return { cat1: '收纳储物', cat2: '收纳储物（自动归类）' };
  if (/包|袋/.test(text)) return { cat1: '鞋包', cat2: '鞋包（自动归类）' };
  if (/男女通用|中性/.test(text)) return { cat1: '服饰杂货', cat2: '服饰杂货（自动归类）' };
  if (/食品|零食|饮料|茶|咖啡|调味|面|汤|米|点心|糖/.test(text)) {
    return { cat1: '零食·点心', cat2: '食品（自动归类）' };
  }
  if (sex === 'Men') return { cat1: '男式服装', cat2: '男式服装（自动归类）' };
  if (sex === 'Women') return { cat1: '女式服装', cat2: '女式服装（自动归类）' };
  if (sex === 'Kids') return { cat1: '童装', cat2: '童装（自动归类）' };
  return { cat1: '', cat2: '未细分' };
}

function discountRate(sku) {
  return Number(sku.price) / Number(sku.mktPrice);
}

function pickBestSku(discounted) {
  let best = discounted[0];
  for (const sku of discounted) {
    const rate = discountRate(sku);
    const bestRate = discountRate(best);
    if (rate < bestRate - 1e-9 || (Math.abs(rate - bestRate) < 1e-9 && Number(sku.price) < Number(best.price))) {
      best = sku;
    }
  }
  return best;
}

export function resolveCategory(detail, base, index) {
  const { lineMap = new Map(), topByCat1 = {} } = index || {};
  const mapped = lineMap.get(base.selLineCd);
  const inferred = mapped ? null : inferCategory(detail.name, detail.sex);
  const cat1 = mapped ? mapped.cat1 : inferred.cat1;
  const cat2 = mapped ? mapped.cat2 : inferred.cat2;
  const top = topByCat1[cat1] || base.topCategory || '未分类';
  return { top, cat1: cat1 || '未分类', cat2: cat2 || '未细分' };
}

export function buildDiscounts(details, catalog, index) {
  const products = [];
  const soldOut = [];
  let mNoDiscount = 0;

  for (const detail of details) {
    const base = catalog.get(detail.id) || {};
    const { top, cat1, cat2 } = resolveCategory(detail, base, index);
    const valid = (detail.skus || []).filter((sku) => Number(sku.mktPrice) > 0);
    const available = valid.filter((sku) => Number(sku.stock) > 0);
    const hasM = M_ONLY_PRICING && top === M_SIZE_TOP && valid.some(isMSizeSku);
    const pricingPool = hasM ? available.filter(isMSizeSku) : available;
    const discounted = pricingPool.filter((sku) => Number(sku.price) < Number(sku.mktPrice));

    if (!discounted.length) {
      if (hasM) {
        const nonMDiscounted = available.some(
          (sku) => !isMSizeSku(sku) && Number(sku.price) < Number(sku.mktPrice),
        );
        if (nonMDiscounted) mNoDiscount += 1;
      } else if (valid.some((sku) => Number(sku.price) < Number(sku.mktPrice))) {
        soldOut.push({ id: detail.id, name: String(detail.name || '').trim() });
      }
      continue;
    }

    const best = pickBestSku(discounted);
    const price = Number(best.price);
    const mkt = Number(best.mktPrice);

    products.push({
      id: detail.id,
      name: String(detail.name || '').trim(),
      spuCd: detail.spuCd || '',
      pic: detail.defaultPic || '',
      url: `https://www.muji.com.cn/cn/store/commodity/${detail.id}`,
      top,
      cat1: cat1 || '未分类',
      cat2: cat2 || '未细分',
      sex: detail.sex || '',
      series: detail.series || '',
      season: detail.seasonName || '',
      skuCd: best.skuCd,
      size: best.sizeName || '',
      color: best.colorName || '',
      price,
      mkt,
      rate: Number((price / mkt).toFixed(4)),
      partial: discounted.length < pricingPool.length,
      skuCount: available.length,
      discSkuCount: discounted.length,
      inStockSkus: discounted.length,
      stock: discounted.reduce((sum, sku) => sum + (Number(sku.stock) || 0), 0),
      pricingScope: hasM ? 'M' : 'all',
      promos: [...new Set((detail.promotions || []).map((promo) => promo.name).filter(Boolean))],
      skus: available.map((sku) => ({
        skuCd: sku.skuCd,
        size: sku.sizeName || '',
        color: sku.colorName || '',
        price: Number(sku.price),
        mkt: Number(sku.mktPrice),
        stock: Number(sku.stock) || 0,
      })),
    });
  }

  const byId = new Map(products.map((product) => [product.id, product]));
  return { products, soldOut, mNoDiscount, byId };
}
