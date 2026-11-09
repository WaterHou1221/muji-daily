import crypto from 'node:crypto';

import {
  API_BASE,
  PROVINCE_CD,
  REQUEST_RETRIES,
  REQUEST_TIMEOUT_MS,
  SIGN_SECRET,
  USER_AGENT,
} from './config.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class ApiError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

/**
 * 官网前端签名算法：参数按 key 排序后拼接 key+value，追加固定密钥，MD5 后转大写。
 */
export function sign(params = {}) {
  const keys = Object.keys(params).sort();
  let raw = '';
  for (const key of keys) {
    const value = params[key];
    if (value === undefined || value === null) continue;
    if (typeof value === 'object') continue;
    raw += key + String(value);
  }
  return crypto
    .createHash('md5')
    .update(raw + SIGN_SECRET, 'utf8')
    .digest('hex')
    .toUpperCase();
}

export async function get(path, params = {}, { retries = REQUEST_RETRIES } = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  const url = `${API_BASE}${path}${query ? `?${query}` : ''}`;

  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          'user-agent': USER_AGENT,
          accept: 'application/json, text/plain, */*',
          'x-app-source': '4',
          'x-sign': sign(params),
          origin: 'https://www.muji.com.cn',
          referer: 'https://www.muji.com.cn/cn/store/',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const text = await response.text();
      if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 100)}`);

      let body;
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error(`响应不是 JSON：${text.slice(0, 100)}`);
      }

      if (body.code === 0) return body.data;

      const error = new ApiError(body.message || `接口错误 code=${body.code}`, body.code);
      if (/签名/.test(error.message)) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
      if (error instanceof ApiError && /签名/.test(error.message)) throw error;
    }
    if (attempt < retries) await sleep(500 * attempt);
  }
  throw lastError;
}

export async function fetchCommodity(id) {
  return get('/commodity', { id, provinceCd: PROVINCE_CD });
}

export { sleep };
