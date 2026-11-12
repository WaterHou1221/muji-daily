import { ITEMS_PER_MESSAGE, MAX_PAGES_PER_SECTION, MESSAGE_BYTE_LIMIT } from './config.js';

export function formatDateCST(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(`${dateStr}T12:00:00+08:00`);
  const weekday = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', weekday: 'long' }).format(date);
  return `${year}年${month}月${day}日 ${weekday}`;
}

export function mmdd(dateStr) {
  return dateStr.slice(5);
}

function money(value) {
  const number = Number(value);
  if (Number.isInteger(number)) return String(number);
  return number.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function rateText(rate) {
  return `${(Number(rate) * 10).toFixed(1)}折`;
}

function linkText(name) {
  return String(name || '').replaceAll('[', '［').replaceAll(']', '］');
}

function productLink(product) {
  if (product.url) return product.url;
  return `https://www.muji.com.cn/cn/store/commodity/${product.id}`;
}

function linkedName(product) {
  return `[${linkText(product.name)}](${productLink(product)})`;
}

function baseLine(product, number) {
  return `${number}. ${linkedName(product)}｜¥${money(product.price)}（原¥${money(product.mkt)}，${rateText(product.rate)}）`;
}

export function addedLine(product, number) {
  const suffix = product.partial ? ' · 部分规格' : '';
  return `${baseLine(product, number)}${suffix}`;
}

export function expiredLine(product, number) {
  return baseLine(product, number);
}

function paginate(title, items, dateStr, lineFn) {
  const stamp = mmdd(dateStr);
  if (!items.length) {
    return [{ type: 'markdown', content: `${title} · ${stamp}（0 款）\n今日无${title}` }];
  }

  const maxItems = MAX_PAGES_PER_SECTION * ITEMS_PER_MESSAGE;
  const shown = items.slice(0, maxItems);
  const overflow = items.length - shown.length;

  const chunks = [];
  for (let index = 0; index < shown.length; index += ITEMS_PER_MESSAGE) {
    chunks.push(shown.slice(index, index + ITEMS_PER_MESSAGE));
  }

  return chunks.map((chunk, pageIndex) => {
    const start = pageIndex * ITEMS_PER_MESSAGE;
    const header = chunks.length > 1
      ? `${title} · ${stamp}（${pageIndex + 1}/${chunks.length}，共 ${items.length} 款）`
      : `${title} · ${stamp}（${items.length} 款）`;

    const lines = chunk.map((product, offset) => lineFn(product, start + offset + 1));
    if (overflow && pageIndex === chunks.length - 1) {
      lines.push(`…其余 ${overflow} 款未发送（单日上限）`);
    }

    let content = `${header}\n\n${lines.join('\n')}`;
    while (Buffer.byteLength(content, 'utf8') > MESSAGE_BYTE_LIMIT && lines.length > 1) {
      lines.pop();
      content = `${header}\n\n${lines.join('\n')}`;
    }
    return { type: 'markdown', content };
  });
}

export function buildMessages({ mode = 'normal', diff, date, prevDate = null }) {
  if (mode === 'init') {
    return [{
      seq: 1,
      type: 'text',
      content: `初始化完成 · ${mmdd(date)}\n基线已建立：当前折扣商品 ${diff.stats.total} 款\n明日起推送「新增折扣 / 失效折扣」`,
    }];
  }

  const added = [...diff.added].sort((a, b) => a.rate - b.rate || b.mkt - a.mkt || a.id - b.id);
  const expired = [...diff.expired].sort((a, b) => b.mkt - a.mkt || a.id - b.id);

  const messages = [{ type: 'text', content: formatDateCST(date) }];
  messages.push(...paginate('新增折扣', added, date, addedLine));
  messages.push(...paginate('失效折扣', expired, date, expiredLine));

  return messages.map((message, index) => ({ ...message, seq: index + 1 }));
}

export function describeMessages(messages) {
  return messages.map((message) => ({
    seq: message.seq,
    type: message.type,
    bytes: Buffer.byteLength(message.content, 'utf8'),
  }));
}
