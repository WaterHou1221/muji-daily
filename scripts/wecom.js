import { NORMAL_INTERVAL_MS, THROTTLE_INTERVAL_MS, THROTTLE_THRESHOLD } from './config.js';
import { sleep } from './muji-api.js';

function toBody(message) {
  if (message.type === 'text') return { msgtype: 'text', text: { content: message.content } };
  return { msgtype: 'markdown', markdown: { content: message.content } };
}

export async function sendMessage(webhook, message, { retries = 2 } = {}) {
  const body = JSON.stringify(toBody(message));
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      const text = await response.text();
      let result;
      try {
        result = JSON.parse(text);
      } catch {
        throw new Error(`企业微信响应异常：${text.slice(0, 100)}`);
      }

      if (result.errcode === 0) return { ok: true };
      if (result.errcode === 45009) {
        lastError = new Error('企业微信限流 45009');
        await sleep(20_000);
        continue;
      }
      if (result.errcode === 93000 || result.errcode === 40001) {
        throw new Error(`Webhook 无效（${result.errcode}）：${result.errmsg}`);
      }
      lastError = new Error(`企业微信错误 ${result.errcode}：${result.errmsg}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < retries) await sleep(5_000 * (attempt + 1));
  }

  throw lastError;
}

export async function sendBatch(webhook, messages, { onResult } = {}) {
  const interval = messages.length > THROTTLE_THRESHOLD ? THROTTLE_INTERVAL_MS : NORMAL_INTERVAL_MS;
  const results = [];
  const failures = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    try {
      await sendMessage(webhook, message);
      results.push({ seq: message.seq, ok: true });
    } catch (error) {
      results.push({ seq: message.seq, ok: false, error: error.message });
      failures.push(message);
    }
    if (onResult) onResult(results[results.length - 1]);
    if (index < messages.length - 1) await sleep(interval);
  }

  return { results, failures };
}
