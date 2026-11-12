import {
  ANOMALY_MAX_CHANGES,
  ANOMALY_MIN_TOTAL,
  ANOMALY_RATIO,
  DETAIL_FAIL_RATE_MAX,
  STALE_MAX_DAYS,
} from './config.js';

function median(values) {
  const list = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!list.length) return 0;
  const middle = Math.floor(list.length / 2);
  return list.length % 2 ? list[middle] : (list[middle - 1] + list[middle]) / 2;
}

/**
 * 商品级 diff。curr 里若某商品本轮详情抓取失败，会沿用上一份快照（carry-forward），
 * 连续失败超过 STALE_MAX_DAYS 天才按失效处理。
 */
export function compare(prevProducts = [], currProducts = [], {
  prevDate = null,
  failures = [],
  history = [],
  soldOut = [],
} = {}) {
  const prevMap = new Map(prevProducts.map((product) => [product.id, product]));
  const currMap = new Map(currProducts.map((product) => [product.id, product]));
  const failedIds = new Set(failures.map((item) => item.id));

  const carried = [];
  for (const [id, prev] of prevMap) {
    if (currMap.has(id) || !failedIds.has(id)) continue;
    const staleDays = (prev.staleDays || 0) + 1;
    if (staleDays > STALE_MAX_DAYS) continue;
    currMap.set(id, { ...prev, stale: true, staleDays });
    carried.push(id);
  }

  const added = [...currMap.values()].filter((product) => !prevMap.has(product.id) && !product.stale);

  const expired = [...prevMap.values()].filter((product) => !currMap.has(product.id));

  const deepened = [...currMap.values()].filter((product) => {
    const prev = prevMap.get(product.id);
    return prev && !product.stale && prev.rate - product.rate >= 0.05;
  });

  const attempted = currProducts.length + failures.length;
  const failureRate = attempted > 0 ? failures.length / attempted : 0;
  const total = currMap.size;
  const historyValues = history.map((item) => Number(item.total)).filter((value) => Number.isFinite(value));
  const baseline = median(historyValues);

  const anomalies = [];
  if (failureRate > DETAIL_FAIL_RATE_MAX) {
    anomalies.push({ type: 'detail_fail', message: `详情抓取失败率 ${(failureRate * 100).toFixed(1)}%` });
  }
  if (total < ANOMALY_MIN_TOTAL) {
    anomalies.push({ type: 'too_few', message: `折扣商品仅 ${total} 款，疑似数据异常` });
  }
  if (historyValues.length >= 3 && baseline > 0 && Math.abs(total - baseline) / baseline > ANOMALY_RATIO) {
    anomalies.push({
      type: 'volume_swing',
      message: `折扣总数 ${total} 款，较近 7 次中位数 ${Math.round(baseline)} 款波动超过 ${Math.round(ANOMALY_RATIO * 100)}%`,
    });
  }
  if (added.length + expired.length > ANOMALY_MAX_CHANGES) {
    anomalies.push({
      type: 'too_many_changes',
      message: `新增 ${added.length} + 失效 ${expired.length} 超过 ${ANOMALY_MAX_CHANGES} 款`,
    });
  }

  return {
    prevDate,
    added,
    expired,
    soldOut,
    deepened,
    carried,
    stats: {
      total,
      added: added.length,
      expired: expired.length,
      soldOut: soldOut.length,
      deepened: deepened.length,
      carried: carried.length,
      failed: failures.length,
      failureRate: Number(failureRate.toFixed(4)),
    },
    anomalies,
  };
}
