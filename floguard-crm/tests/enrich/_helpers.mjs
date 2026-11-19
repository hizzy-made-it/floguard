import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
export const fixture = (name) => JSON.parse(readFileSync(path.join(dir, 'fixtures', name), 'utf8'));

const ENV_KEYS = ['BATCHDATA_API_KEY', 'BATCH_DATA_API_KEY', 'TRESTLE_API_KEY', 'TRESTLE_API_URL'];

/** Run fn with a clean env + mocked global fetch; always restores both. */
export async function withMocks({ env = {}, handler }, fn) {
  const saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  Object.assign(process.env, env);
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const call = { url: String(url), host: u.hostname, path: u.pathname, params: Object.fromEntries(u.searchParams), headers: init.headers || {}, method: init.method || 'GET', body: init.body };
    calls.push(call);
    const r = await handler(call);
    if (r instanceof Response) return r;
    const { status = 200, json, text, type } = r || {};
    const body = json !== undefined ? JSON.stringify(json) : text ?? '';
    return new Response(body, {
      status,
      headers: { 'content-type': type || (json !== undefined ? 'application/json' : 'text/html') },
    });
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = realFetch;
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

export const trestleHost = 'api.trestleiq.com';
export const ddgHtml = (phone) =>
  `<html><body><a class="result__snippet">Call us at ${phone} today</a></body></html>`;
