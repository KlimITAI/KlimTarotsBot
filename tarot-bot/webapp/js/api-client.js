/**
 * HTTP API клиент KLIM TAROT Mini App.
 * Автоматически прикрепляет Telegram WebApp initData для HMAC-SHA256 проверки на сервере.
 */

function resolveApiBase() {
  if (typeof window !== 'undefined') {
    if (window.KLIM_API_BASE) {
      return String(window.KLIM_API_BASE).replace(/\/+$/, '');
    }
    try {
      const qs = new URLSearchParams(window.location.search).get('api');
      if (qs) return qs.replace(/\/+$/, '');
    } catch (_) {}
    const meta = document.querySelector('meta[name="api-base"]')?.getAttribute('content');
    if (meta) return meta.replace(/\/+$/, '');
  }
  return '';
}

const API_BASE = resolveApiBase();
const REQUEST_TIMEOUT_MS = 8500;

function getInitData() {
  return window.Telegram?.WebApp?.initData || '';
}

async function request(method, path, body = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const headers = {
    'X-Telegram-Init-Data': getInitData(),
  };
  if (body !== null) {
    headers['Content-Type'] = 'application/json';
  }

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || data.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.code = data.error || 'http_error';
      err.data = data;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export function apiBootstrap() {
  const tzOffset = -new Date().getTimezoneOffset();
  return request('GET', `/api/bootstrap?tzOffset=${encodeURIComponent(tzOffset)}`);
}

export function apiDrawDaily() {
  const tzOffset = -new Date().getTimezoneOffset();
  return request('POST', '/api/daily', { tzOffset });
}

export function apiDrawSpread(payload) {
  return request('POST', '/api/spreads/draw', payload);
}

export function apiAskOracle(payload) {
  return request('POST', '/api/oracle/ask', payload);
}

export function apiGetHistory() {
  return request('GET', '/api/history');
}

export function apiClearHistory() {
  return request('DELETE', '/api/history');
}

export function apiSpinWheel() {
  return request('POST', '/api/wheel/spin', {});
}

export function apiForgeShards() {
  return request('POST', '/api/wheel/forge', {});
}

export function apiSendReadingToChat(summary) {
  return request('POST', '/api/reading/send', { summary });
}
