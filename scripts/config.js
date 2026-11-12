export const API_BASE = 'https://www.muji.com.cn/cn/ecapi/maps/ec';
export const SIGN_SECRET = '3CE70638F556FB9B';
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// 官网 provinceCd 使用两位省级短码（由 /delivery/regions 的 shortCd 提供），不是六位行政区划码。
// 上海 = 31；传 310000 时接口不报错，但会静默落到一个很小的默认库存池。
export const PROVINCE_CD = process.env.PROVINCE_CD || '31';
export const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 6));
export const PAGE_SIZE = 500;
export const REQUEST_TIMEOUT_MS = 20_000;
export const REQUEST_RETRIES = 3;

export const TOP_CATEGORY_IDS = [100000018, 100000020, 100000022];

export const ITEMS_PER_MESSAGE = 25;
export const MAX_PAGES_PER_SECTION = 30;
export const MESSAGE_BYTE_LIMIT = 3900;

export const THROTTLE_THRESHOLD = 18;
export const THROTTLE_INTERVAL_MS = 3500;
export const NORMAL_INTERVAL_MS = 800;

export const ANOMALY_MIN_TOTAL = 100;
export const ANOMALY_RATIO = 0.35;
export const ANOMALY_MAX_CHANGES = 400;
export const DETAIL_FAIL_RATE_MAX = 0.05;

export const STALE_MAX_DAYS = 3;
export const SNAPSHOT_RETAIN_DAYS = 30;
export const REPORT_RETAIN_DAYS = 30;
export const HISTORY_LENGTH = 14;

// 过滤规则版本：修改过滤/计价条件时递增，触发基线重建
export const FILTER_VERSION = 3;

// 规则①：按分类整类排除
export const EXCLUDE_CAT1 = ['女式服装', '女式内衣/睡衣', '美妆护肤', '芳香用品', '童装'];
export const EXCLUDE_CAT2 = ['鞋类'];

// 规则②：在这些二级分类里，商品名命中女性关键词则排除
export const NAME_FILTER_CAT1 = ['MUJI LABO', 'MUJI IDÉE WEAR', 'MUJI IDÉE', '服饰杂货', '鞋包'];

// 规则③：仅 sizeCd=003（男式/通用 M）算 M 号；M 号全部无货则排除整个 SPU
export const M_SIZE_CDS = ['003'];
export const M_SIZE_TOP = '衣服·杂货';

// 有 M 号时，只用 M 号 SKU 判定折扣与展示价格
export const M_ONLY_PRICING = true;
