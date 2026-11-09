import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import { HISTORY_LENGTH, REPORT_RETAIN_DAYS, SNAPSHOT_RETAIN_DAYS } from './config.js';

export function cstDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function shiftDate(dateStr, days) {
  const base = new Date(`${dateStr}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeFileAtomic(file, content) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

export function writeJson(file, value) {
  writeFileAtomic(file, JSON.stringify(value, null, 1));
}

export function writeText(file, text) {
  writeFileAtomic(file, text);
}

export const paths = {
  lastSuccess: (stateDir) => path.join(stateDir, 'last_success.json'),
  snapshot: (stateDir, date) => path.join(stateDir, 'snapshots', `${date}.json.gz`),
  reportMd: (stateDir, date) => path.join(stateDir, 'reports', `${date}.md`),
  reportCsv: (stateDir, date) => path.join(stateDir, 'reports', `${date}.csv`),
  outbox: (stateDir) => path.join(stateDir, 'outbox.json'),
  summary: (stateDir) => path.join(stateDir, 'last_run_summary.md'),
};

export function loadLastSuccess(stateDir) {
  return readJson(paths.lastSuccess(stateDir), null);
}

export function saveLastSuccess(stateDir, info) {
  writeJson(paths.lastSuccess(stateDir), info);
}

export function loadSnapshot(stateDir, date) {
  const file = paths.snapshot(stateDir, date);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
  } catch {
    return null;
  }
}

export function saveSnapshot(stateDir, payload) {
  ensureDir(path.join(stateDir, 'snapshots'));
  const file = paths.snapshot(stateDir, payload.date);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, zlib.gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'), { level: 9 }));
  fs.renameSync(tmp, file);
}

function csvCell(value) {
  const text = value === undefined || value === null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function writeReports(stateDir, date, { products, diff }) {
  ensureDir(path.join(stateDir, 'reports'));

  const header = [
    '商品ID', '商品名称', '一级分类', '二级分类', '现价(元)', '原价(元)', '折扣',
    '规格', '颜色', '部分规格', '折扣规格数', '总规格数', '库存', '活动', '商品链接',
  ];
  const lines = [header.join(',')];
  for (const product of products) {
    lines.push([
      product.id,
      csvCell(product.name),
      csvCell(product.top),
      csvCell(product.cat1),
      csvCell(product.cat2),
      product.price,
      product.mkt,
      (product.rate * 10).toFixed(1),
      csvCell(product.size),
      csvCell(product.color),
      product.partial ? '是' : '否',
      product.discSkuCount,
      product.skuCount,
      product.stock,
      csvCell(product.promos.join('; ')),
      product.url,
    ].join(','));
  }
  writeFileAtomic(paths.reportCsv(stateDir, date), `\uFEFF${lines.join('\n')}\n`);

  const reasonText = { restored: '已恢复原价', delisted: '已下架', missing: '数据缺失' };
  const md = [
    `# MUJI 折扣日报 ${date}`,
    '',
    `- 当前折扣商品：${products.length} 款`,
    `- 新增：${diff.added.length} 款`,
    `- 失效：${diff.expired.length} 款`,
    `- 售罄（仍有折扣价）：${diff.soldOut.length} 款`,
    '',
    '## 新增（前 50）',
    '',
    ...diff.added.slice(0, 50).map((p, i) => `${i + 1}. ${p.name}｜¥${p.price}（原¥${p.mkt}，${(p.rate * 10).toFixed(1)}折）`),
    '',
    '## 失效（前 50）',
    '',
    ...diff.expired.slice(0, 50).map((p, i) => `${i + 1}. ${p.name}｜¥${p.price}（原¥${p.mkt}，${(p.rate * 10).toFixed(1)}折）→ ${reasonText[p.reason] || '已失效'}`),
    '',
  ].join('\n');
  writeFileAtomic(paths.reportMd(stateDir, date), md);
}

export function prune(stateDir, today, {
  snapshotDays = SNAPSHOT_RETAIN_DAYS,
  reportDays = REPORT_RETAIN_DAYS,
} = {}) {
  const snapshotCutoff = shiftDate(today, -snapshotDays);
  const reportCutoff = shiftDate(today, -reportDays);

  const snapDir = path.join(stateDir, 'snapshots');
  if (fs.existsSync(snapDir)) {
    for (const name of fs.readdirSync(snapDir)) {
      const match = name.match(/^(\d{4}-\d{2}-\d{2})\.json\.gz$/);
      if (match && match[1] < snapshotCutoff) fs.rmSync(path.join(snapDir, name), { force: true });
    }
  }

  const reportDir = path.join(stateDir, 'reports');
  if (fs.existsSync(reportDir)) {
    for (const name of fs.readdirSync(reportDir)) {
      const match = name.match(/^(\d{4}-\d{2}-\d{2})\.(md|csv)$/);
      if (match && match[1] < reportCutoff) fs.rmSync(path.join(reportDir, name), { force: true });
    }
  }
}

export function appendHistory(history = [], entry) {
  const list = history.filter((item) => item.date !== entry.date);
  list.push(entry);
  list.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return list.slice(-HISTORY_LENGTH);
}

export function readOutbox(stateDir) {
  const value = readJson(paths.outbox(stateDir), null);
  return Array.isArray(value?.messages) ? value.messages : [];
}

export function writeOutbox(stateDir, messages) {
  if (!messages.length) {
    fs.rmSync(paths.outbox(stateDir), { force: true });
    return;
  }
  writeJson(paths.outbox(stateDir), { createdAt: new Date().toISOString(), messages });
}

export function writeJsonFile(file, value) {
  writeJson(file, value);
}
