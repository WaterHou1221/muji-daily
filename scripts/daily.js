import fs from 'node:fs';
import path from 'node:path';

import { CONCURRENCY, FILTER_VERSION } from './config.js';
import { fetchCatalog, fetchCategories, fetchDetails } from './crawl.js';
import { buildDiscounts } from './discount.js';
import { compare } from './diff.js';
import { filterDetails } from './filters.js';
import { buildMessages, describeMessages } from './render.js';
import * as store from './snapshot.js';
import { sendBatch, sendMessage } from './wecom.js';

function parseArgs(argv) {
  const args = { stateDir: './state', dryRun: false, force: false, noSend: false };
  for (const arg of argv) {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--force') args.force = true;
    else if (arg === '--no-send') args.noSend = true;
    else if (arg.startsWith('--state=')) args.stateDir = arg.slice('--state='.length);
  }
  if (process.env.DRY_RUN === 'true') args.dryRun = true;
  if (process.env.FORCE === 'true') args.force = true;
  return args;
}

function log(message) {
  console.log(message);
}

function writeSummary(stateDir, { today, products, diff, failures, messageCount, failedCount, elapsed, filterStats }) {
  const filterLine = filterStats
    ? `- 过滤：分类 ${filterStats.category}，名称 ${filterStats.name}，M码 ${filterStats.msize}（保留 ${filterStats.kept}/${filterStats.input}）`
    : null;
  const text = [
    `## MUJI 日报 ${today}`,
    '',
    `- 折扣商品：${products.length} 款`,
    `- 新增：${diff.added.length} 款`,
    `- 失效：${diff.expired.length} 款`,
    `- 售罄未计入：${diff.soldOut.length} 款`,
    ...(filterLine ? [filterLine] : []),
    `- 详情失败：${failures.length} 个`,
    `- 消息：${messageCount} 条，失败 ${failedCount} 条`,
    `- 耗时：${elapsed}s`,
    '',
  ].join('\n');
  store.writeText(store.paths.summary(stateDir), text);
}

async function main() {
  const started = Date.now();
  const args = parseArgs(process.argv.slice(2));
  const stateDir = path.resolve(args.stateDir);
  fs.mkdirSync(stateDir, { recursive: true });

  const today = store.cstDate();
  const webhook = process.env.WECOM_WEBHOOK;

  if (!args.dryRun && !args.noSend && !webhook) throw new Error('缺少 WECOM_WEBHOOK 环境变量');

  const last = store.loadLastSuccess(stateDir);
  const versionMismatch = Boolean(last) && last.filterVersion !== FILTER_VERSION;
  if (!args.force && last?.date === today && !versionMismatch) {
    log(`[skip] ${today} 已有成功快照，跳过（--force 可强制重跑）`);
    return;
  }
  if (versionMismatch) {
    log(`[filter] 过滤规则版本 ${last.filterVersion ?? '未记录'} -> ${FILTER_VERSION}，本次重建基线`);
  }

  const pending = store.readOutbox(stateDir);
  if (pending.length) log(`[outbox] 有 ${pending.length} 条待补发消息`);

  log(`[1/6] 拉取类目与商品列表`);
  const index = await fetchCategories().catch((error) => {
    log(`  类目接口失败，退回名称归类：${error.message}`);
    return { lineMap: new Map(), topByCat1: {} };
  });
  const { catalog, list } = await fetchCatalog();
  log(`  在售商品 ${list.length} 个`);

  log(`[2/6] 抓取商品详情（并发 ${CONCURRENCY}）`);
  const { details, failures } = await fetchDetails(list.map((item) => item.id), {
    onProgress: ({ done, total }) => log(`  详情 ${done}/${total}`),
  });
  log(`  详情成功 ${details.length} 个，失败 ${failures.length} 个`);

  log(`[3/6] 过滤与折扣计算`);
  const filtered = filterDetails(details, catalog, index);
  log(`  过滤：分类 -${filtered.stats.category}，名称 -${filtered.stats.name}，M码 -${filtered.stats.msize}；保留 ${filtered.stats.kept}/${filtered.stats.input}`);
  if (filtered.audit.length) {
    const samples = filtered.audit.slice(0, 5).map((item) => `${item.id} ${item.name}（${item.cat1}）`).join('；');
    log(`  [audit] 仅 026（女式M）且通过 ①② 的商品 ${filtered.audit.length} 个：${samples}`);
  }
  const { products, soldOut } = buildDiscounts(filtered.details, catalog, index);
  log(`  折扣商品 ${products.length} 款（另有 ${soldOut.length} 款折扣规格全部无货，未纳入）`);

  const prev = last && !versionMismatch ? store.loadSnapshot(stateDir, last.date) : null;
  if (last && !prev && !versionMismatch) log(`  [warn] 找不到 ${last.date} 的快照，按首次运行处理`);

  log(`[4/6] 对比基线 ${prev ? prev.date : '（无，首次运行）'}`);
  const diff = compare(prev?.products || [], products, {
    prevDate: prev?.date || null,
    catalogIds: new Set(catalog.keys()),
    failures,
    history: last?.history || [],
    soldOut,
  });

  const mode = prev ? 'normal' : 'init';
  if (mode === 'normal' && diff.anomalies.length && !args.force) {
    const text = [
      `【MUJI 日报异常】${today}`,
      ...diff.anomalies.map((item) => `· ${item.message}`),
      '本次未更新基线，请检查后手动触发（--force 可跳过校验）。',
    ].join('\n');
    log(text);
    if (!args.dryRun && !args.noSend) await sendMessage(webhook, { type: 'text', content: text }).catch(() => {});
    return;
  }

  log(`[5/6] 渲染消息`);
  const messages = buildMessages({ mode, diff, date: today, prevDate: prev?.date || null });
  const toSend = [
    ...pending.map((message) => ({ ...message, content: `【补发】\n${message.content}` })),
    ...messages,
  ];
  log(`  本次 ${messages.length} 条，加待补发共 ${toSend.length} 条`);
  for (const info of describeMessages(toSend)) log(`  #${info.seq} ${info.type} ${info.bytes} bytes`);

  if (args.dryRun) {
    for (const message of toSend) {
      log(`\n--- #${message.seq} ${message.type} ---\n${message.content}`);
    }
    log('\n[dry-run] 未发送、未写入状态');
    return;
  }

  log(`[6/6] 写入状态并推送`);
  const runAt = new Date().toISOString();
  store.saveSnapshot(stateDir, {
    version: 1,
    filterVersion: FILTER_VERSION,
    date: today,
    runAt,
    mode,
    total: products.length,
    products,
  });
  store.writeReports(stateDir, today, { products, diff, mode });
  store.saveLastSuccess(stateDir, {
    version: 1,
    filterVersion: FILTER_VERSION,
    date: today,
    runAt,
    mode,
    total: products.length,
    added: diff.added.length,
    expired: diff.expired.length,
    soldOut: diff.soldOut.length,
    filter: filtered.stats,
    history: store.appendHistory(last?.history || [], { date: today, total: products.length }),
  });
  store.prune(stateDir, today);

  log(`  已写入 state/（快照 ${products.length} 款）`);

  if (args.noSend) {
    const elapsed = ((Date.now() - started) / 1000).toFixed(0);
    writeSummary(stateDir, { today, products, diff, failures, messageCount: toSend.length, failedCount: 0, elapsed, filterStats: filtered.stats });
    log(`[no-send] 已写入状态，未推送消息；耗时 ${elapsed}s`);
    return;
  }

  const { failures: sendFailures, results } = await sendBatch(webhook, toSend, {
    onResult: (result) => log(`  #${result.seq} ${result.ok ? '已发送' : `失败：${result.error}`}`),
  });
  store.writeOutbox(stateDir, sendFailures);
  if (pending.length && sendFailures.length === 0) log('  待补发消息已发送并清空');

  const elapsed = ((Date.now() - started) / 1000).toFixed(0);
  writeSummary(stateDir, { today, products, diff, failures, messageCount: toSend.length, failedCount: sendFailures.length, elapsed, filterStats: filtered.stats });
  log(`完成，耗时 ${elapsed}s，消息失败 ${sendFailures.length}/${toSend.length}`);

  if (toSend.length > 0 && sendFailures.length === toSend.length) {
    throw new Error('全部消息推送失败');
  }
  if (results.some((result) => !result.ok)) {
    log('部分消息推送失败，已写入 outbox，次日补发');
  }
}

try {
  await main();
} catch (error) {
  console.error('运行失败：', error);
  const webhook = process.env.WECOM_WEBHOOK;
  if (webhook && process.env.DRY_RUN !== 'true') {
    const runUrl = process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : '';
    const content = `【MUJI 日报失败】${store.cstDate()}\n${error.message}${runUrl ? `\n${runUrl}` : ''}`;
    await sendMessage(webhook, { type: 'text', content }).catch(() => {});
  }
  process.exitCode = 1;
}
