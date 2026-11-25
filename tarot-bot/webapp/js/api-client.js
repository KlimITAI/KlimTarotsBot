/**
 * HTTP API клиент KLIM TAROT Mini App.
 * Автоматически прикрепляет Telegram WebApp initData и UID для HMAC-SHA256 проверки на сервере.
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
    if (window.location.hostname.endsWith('github.io')) {
      return 'https://klim-tarot-bot.onrender.com';
    }
  }
  return '';
}

const API_BASE = resolveApiBase();
const REQUEST_TIMEOUT_MS = 8000;

function getInitData() {
  return window.Telegram?.WebApp?.initData || '';
}

function getFallbackUid() {
  try {
    const u = window.Telegram?.WebApp?.initDataUnsafe?.user;
    if (u && u.id) return String(u.id);
    const qs = new URLSearchParams(window.location.search).get('uid');
    if (qs) return qs;
    const cached = localStorage.getItem('klim_tarot_uid');
    if (cached) return cached;
  } catch (_) {}
  return '';
}

async function request(method, path, body = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const initData = getInitData();
  const uid = getFallbackUid();

  const headers = {
    'Accept': 'application/json',
  };
  if (initData) {
    headers['Authorization'] = `tma ${initData}`;
    headers['X-Telegram-Init-Data'] = initData;
  }
  if (uid) {
    headers['X-Dev-User-Id'] = uid;
  }
  if (body !== null) {
    headers['Content-Type'] = 'application/json';
  }

  const sep = path.includes('?') ? '&' : '?';
  const url = uid ? `${API_BASE}${path}${sep}uid=${encodeURIComponent(uid)}` : `${API_BASE}${path}`;

  try {
    const res = await fetch(url, {
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
  return request('POST', '/api/draw/daily', { tzOffset });
}

export function apiDrawSpread(payload) {
  return request('POST', '/api/draw/spread', payload);
}

export function apiAskOracle(payload) {
  return request('POST', '/api/draw/oracle', payload);
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
