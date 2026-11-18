import { ALL_CARDS, MAJOR_IDS, SPREADS, CATEGORIES, POSITION_LEADS } from './tarot-data.js';

/* ════════════════════════════════════════════════════════════════
   1. TELEGRAM WEBAPP BRIDGE
   ════════════════════════════════════════════════════════════════ */

const tg = window.Telegram?.WebApp || null;

if (tg) {
  tg.ready();
  tg.expand();
  try {
    tg.setHeaderColor('#060512');
    tg.setBackgroundColor('#060512');
  } catch (_) {}
}

function haptic(type = 'light') {
  if (!tg?.HapticFeedback) return;
  try {
    if (['success', 'warning', 'error'].includes(type)) {
      tg.HapticFeedback.notificationOccurred(type);
    } else {
      tg.HapticFeedback.impactOccurred(type);
    }
  } catch (_) {}
}

/* ════════════════════════════════════════════════════════════════
   2. MYSTICAL SOUND ENGINE (WEB AUDIO API — ZERO LATENCY)
   Supports optional custom overrides in ./assets/sounds/
   ════════════════════════════════════════════════════════════════ */

class SoundEngine {
  constructor() {
    this.enabled = localStorage.getItem('klim_tarot_sound') !== 'off';
    this.ctx = null;
    this.bgm = null;
    this.bgmActive = false;
    this.bgmTargetVol = 0.18; // Тихий, атмосферный фон для ритуала гадания
    this._fadeTimer = null;
  }

  _ensureCtx() {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  _ensureBgm() {
    if (!this.bgm) {
      this.bgm = new Audio('./assets/ritual-music.mp3');
      this.bgm.loop = false;
      this.bgm.preload = 'auto';
      this.bgm.volume = 0;
      this.bgmStartSec = 31.2; // Старт сразу с баса и основного ритма (пропускаем тихое вступление)
      this.bgmLoopEndSec = 158.0; // Конец основной части перед затуханием (2:38)

      this.bgm.addEventListener('loadedmetadata', () => {
        if (this.bgm.currentTime < this.bgmStartSec) {
          try { this.bgm.currentTime = this.bgmStartSec; } catch (_) {}
        }
      });
      this.bgm.addEventListener('timeupdate', () => {
        if (this.bgm.currentTime >= this.bgmLoopEndSec) {
          this.bgm.currentTime = this.bgmStartSec;
        }
      });
    }
    return this.bgm;
  }

  _fadeBgmTo(targetVol, durationMs = 1100, pauseAtZero = false) {
    const audio = this.bgm;
    if (!audio) return;
    if (this._fadeTimer) clearInterval(this._fadeTimer);

    const steps = 22;
    const stepMs = Math.max(20, Math.floor(durationMs / steps));
    const startVol = audio.volume;
    let step = 0;

    this._fadeTimer = setInterval(() => {
      step += 1;
      const t = Math.min(1, step / steps);
      audio.volume = Math.max(0, Math.min(1, startVol + (targetVol - startVol) * t));
      if (t >= 1) {
        clearInterval(this._fadeTimer);
        this._fadeTimer = null;
        if (pauseAtZero && targetVol <= 0.001) {
          audio.pause();
        }
      }
    }, stepMs);
  }

  // Плавное включение/выключение фоновой музыки ритуала
  setRitualAmbience(active) {
    this.bgmActive = active;
    if (!this.enabled || !active) {
      if (this.bgm && !this.bgm.paused) {
        this._fadeBgmTo(0, 850, true);
      }
      return;
    }
    const audio = this._ensureBgm();
    if (audio.paused && audio.currentTime < (this.bgmStartSec || 31.2)) {
      try { audio.currentTime = this.bgmStartSec || 31.2; } catch (_) {}
    }
    audio.play().then(() => {
      if (audio.currentTime < (this.bgmStartSec || 31.2) - 0.5) {
        try { audio.currentTime = this.bgmStartSec || 31.2; } catch (_) {}
      }
      this._fadeBgmTo(this.bgmTargetVol, 1400, false);
    }).catch(() => {});
  }

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem('klim_tarot_sound', this.enabled ? 'on' : 'off');
    if (this.enabled) {
      this.playTap();
      if (this.bgmActive) this.setRitualAmbience(true);
    } else if (this.bgm && !this.bgm.paused) {
      this._fadeBgmTo(0, 350, true);
    }
    return this.enabled;
  }

  // Subtle crystalline UI tap
  playTap() {
    const ctx = this._ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(680, now);
    osc.frequency.exponentialRampToValueAtTime(980, now + 0.06);
    gain.gain.setValueAtTime(0.055, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.09);
  }

  // Soft velvet card-shuffle rustle (filtered noise bursts)
  playShuffle() {
    const ctx = this._ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      const start = now + i * 0.075;
      const len = Math.floor(ctx.sampleRate * 0.09);
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let j = 0; j < len; j++) {
        data[j] = (Math.random() * 2 - 1) * Math.sin((j / len) * Math.PI);
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1600 + i * 240, start);
      filter.Q.value = 1.6;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.09, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.09);

      src.connect(filter).connect(gain).connect(ctx.destination);
      src.start(start);
    }
  }

  // Tactile card slide + delicate chime when picking from deck
  playCardPick(index = 0) {
    const ctx = this._ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Soft paper swish
    const len = Math.floor(ctx.sampleRate * 0.07);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'highpass';
    bp.frequency.value = 1800;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.06, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    noise.connect(bp).connect(ng).connect(ctx.destination);
    noise.start(now);

    // Ascending pentatonic sparkle note
    const scale = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];
    const freq = scale[index % scale.length];
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.34);
  }

  // Celestial harmonic chord when a card flips face-up
  playCardFlip(isMajor = false, isReversed = false) {
    const ctx = this._ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;

    const notes = isReversed
      ? [329.63, 392.0, 466.16] // Mysterious diminished/minor tint
      : isMajor
      ? [392.0, 493.88, 587.33, 783.99] // Majestic Major Arcana chord
      : [440.0, 554.37, 659.25]; // Warm celestial triad

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = idx === 0 ? 'sine' : 'triangle';
      const t = now + idx * 0.045;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(isMajor ? 0.075 : 0.055, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.9);
    });
  }

  // Deep mystical bell for Yes/No Oracle verdict
  playOracleReveal(weight = 0) {
    const ctx = this._ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const chord =
      weight > 0
        ? [523.25, 659.25, 783.99, 1046.5]
        : weight < 0
        ? [293.66, 349.23, 440.0]
        : [392.0, 493.88, 659.25];

    chord.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const t = now + i * 0.06;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.07, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 1.25);
    });
  }
}

const sound = new SoundEngine();

/* ════════════════════════════════════════════════════════════════
   3. COSMIC STARFIELD CANVAS (SUBTLE 60FPS AMBIENCE)
   ════════════════════════════════════════════════════════════════ */

function initCosmosCanvas() {
  const canvas = document.getElementById('cosmos-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let w = 0, h = 0;
  const stars = [];

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const count = 65;
  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 1.4 + 0.3,
      phase: Math.random() * Math.PI * 2,
      speed: 0.008 + Math.random() * 0.018,
      tint: i % 5 === 0 ? '#f5c969' : i % 7 === 0 ? '#22d3ee' : '#f6f4ff',
    });
  }

  function frame() {
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      s.phase += s.speed;
      const alpha = 0.25 + 0.65 * (0.5 + 0.5 * Math.sin(s.phase));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = s.tint;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(frame);
  }
  frame();
}

/* ════════════════════════════════════════════════════════════════
   4. TAROT ENGINE (DRAW, INTERPRETATIONS, SYNTHESIS, STORAGE)
   ════════════════════════════════════════════════════════════════ */

function getPositionLead(position) {
  const lower = position.toLowerCase();
  for (const [key, phrase] of Object.entries(POSITION_LEADS)) {
    if (lower.includes(key)) return phrase;
  }
  return 'здесь открывается';
}

function drawRandomCards(n) {
  const pool = [...ALL_CARDS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n).map((card) => ({
    card,
    reversed: Math.random() < 0.32,
  }));
}

function buildSynthesis(spreadName, positions, drawn) {
  const n = drawn.length;
  if (n === 1) {
    const { card, reversed } = drawn[0];
    return {
      intro: reversed
        ? `Карта «${card.name}» пришла в перевёрнутом положении — это мягкий сигнал обратить внимание внутрь и снять внутреннее напряжение.`
        : `Аркан «${card.name}» задаёт чистый, прямой фокус на ближайший период.`,
      arc: card.story,
      keyAdvice: card.advice,
    };
  }

  const majorCount = drawn.filter(({ card }) => MAJOR_IDS.has(card.id)).length;
  const revCount = drawn.filter(({ reversed }) => reversed).length;
  const posCount = drawn.filter(
    ({ card, reversed }) =>
      (card.yes_weight > 0 && !reversed) || (card.yes_weight < 0 && reversed)
  ).length;

  const first = drawn[0];
  const last = drawn[n - 1];
  const firstKw = (first.reversed ? first.card.reversed : first.card.upright).split(',')[0].trim().toLowerCase();
  const lastKw = (last.reversed ? last.card.reversed : last.card.upright).split(',')[0].trim().toLowerCase();

  let intro = '';
  if (majorCount >= n * 0.6) {
    intro = `В этом раскладе ${majorCount} из ${n} карт — Старшие Арканы. Это редкое и сильное стечение: ситуация несёт глубокий, поворотный смысл и способна заметно изменить ваш путь.`;
  } else if (revCount > Math.floor(n / 2)) {
    intro = `Большинство карт (${revCount} из ${n}) легли перевёрнутыми — расклад указывает на время внутренней настройки. То, что снаружи кажется паузой, на деле даёт шанс честно переосмыслить курс.`;
  } else if (posCount >= n * 0.6) {
    intro = `Расклад наполнен поддерживающей, созидательной энергией: большинство арканов открывают пространство для роста и верного движения вперёд.`;
  } else {
    intro = `Карты рисуют живую, объёмную картину — в ней соединяются и вызовы, и скрытые точки опоры. Именно в этом балансе рождается осознанный выбор.`;
  }

  let arc = '';
  if (first.reversed && !last.reversed) {
    arc = `Путь начинается через преодоление (${first.card.name} — ${firstKw}), но финальная карта «${last.card.name}» выводит вас к состоянию «${lastKw}». Это сильная, обнадёживающая дуга: от сложности к ресурсу.`;
  } else if (!first.reversed && last.reversed) {
    arc = `Старт уверенный (${first.card.name} — ${firstKw}), однако финальная карта «${last.card.name}» в перевёрнутом положении советует не терять бдительность на финишной прямой.`;
  } else if (last.card.yes_weight > 0 && !last.reversed) {
    arc = `Сюжет разворачивается от позиции «${positions[0]}» (${first.card.name}: ${firstKw}) к финалу «${positions[n - 1]}» (${last.card.name}: ${lastKw}). Светлый финал подтверждает: направление выбрано верно.`;
  } else {
    arc = `Линия от «${positions[0]}» (${first.card.name}: ${firstKw}) к «${positions[n - 1]}» (${last.card.name}: ${lastKw}) призывает действовать взвешенно, не торопя события и прислушиваясь к интуиции.`;
  }

  const keyAdvice = last.card.advice || drawn[Math.floor(n / 2)].card.advice || 'Доверяйте первому внутреннему отклику.';
  return { intro, arc, keyAdvice };
}

function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getDailyCard() {
  const today = getTodayKey();
  try {
    const saved = JSON.parse(localStorage.getItem('klim_tarot_daily') || 'null');
    if (saved && saved.date === today) {
      const card = ALL_CARDS.find((c) => c.id === saved.cardId);
      if (card) return { card, reversed: saved.reversed, opened: true };
    }
  } catch (_) {}
  return null;
}

function drawAndSaveDailyCard() {
  const existing = getDailyCard();
  if (existing) return existing;
  const [{ card, reversed }] = drawRandomCards(1);
  localStorage.setItem(
    'klim_tarot_daily',
    JSON.stringify({ date: getTodayKey(), cardId: card.id, reversed })
  );
  return { card, reversed, opened: false };
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem('klim_tarot_history') || '[]');
  } catch (_) {
    return [];
  }
}

function saveReadingToHistory(reading) {
  const list = loadHistory();
  list.unshift({
    id: Date.now(),
    time: new Date().toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
    ...reading,
  });
  localStorage.setItem('klim_tarot_history', JSON.stringify(list.slice(0, 25)));
  updateHistoryCounter();
}

/* ════════════════════════════════════════════════════════════════
   5. APP STATE & NAVIGATION
   ════════════════════════════════════════════════════════════════ */

const state = {
  currentView: 'hero',
  historyStack: [],
  activeCategory: 'all',
  activeSuit: 'all',
  dictQuery: '',
  drawSession: null, // { spread, friendName, question, needed, pool, picked: [] }
  lastReading: null,
  oracleFlipped: false,
};

const viewHero = document.getElementById('view-hero');
const mainChrome = document.getElementById('main-chrome');
const btnBack = document.getElementById('btn-back');
const topbarTitle = document.getElementById('topbar-title');

const VIEW_TITLES = {
  home: 'KLIM TAROT',
  spreads: 'Расклады',
  draw: 'Выбор карт',
  result: 'Толкование',
  oracle: 'Да или Нет',
  friend: 'Для друга',
  dictionary: 'Словарь карт',
  history: 'История',
};

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), 2400);
}

function navigateTo(viewName, { push = true } = {}) {
  sound.playTap();
  haptic('light');

  // Включаем тихое музыкальное сопровождение во время ритуала гадания и Оракула
  const isRitualView = ['draw', 'result', 'oracle'].includes(viewName);
  sound.setRitualAmbience(isRitualView);

  if (viewName === 'hero') {
    viewHero.classList.remove('hidden');
    mainChrome.classList.add('hidden');
    state.currentView = 'hero';
    state.historyStack = [];
    if (tg?.BackButton) tg.BackButton.hide();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  if (push && state.currentView !== 'hero' && state.currentView !== viewName) {
    state.historyStack.push(state.currentView);
  }

  viewHero.classList.add('hidden');
  mainChrome.classList.remove('hidden');

  document.querySelectorAll('.subview').forEach((el) => el.classList.remove('active'));
  const target = document.getElementById(`view-${viewName}`);
  if (target) target.classList.add('active');

  state.currentView = viewName;
  topbarTitle.textContent = VIEW_TITLES[viewName] || 'KLIM TAROT';

  // Update dock active state
  const dockTab = ['home', 'spreads', 'oracle', 'dictionary'].includes(viewName) ? viewName : null;
  document.querySelectorAll('.dock-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === dockTab);
  });

  // Back button visibility
  const showBack = !['home', 'spreads', 'oracle', 'dictionary'].includes(viewName);
  btnBack.classList.toggle('hidden', !showBack);
  if (tg?.BackButton) {
    if (showBack) tg.BackButton.show();
    else tg.BackButton.hide();
  }

  if (viewName === 'home') refreshHomeBanner();
  if (viewName === 'history') renderHistory();
  if (viewName === 'oracle') resetOracleStage();

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function goBack() {
  const prev = state.historyStack.pop() || 'home';
  navigateTo(prev, { push: false });
}

if (tg?.BackButton) {
  tg.BackButton.onClick(goBack);
}

/* ════════════════════════════════════════════════════════════════
   6. RENDERING VIEWS
   ════════════════════════════════════════════════════════════════ */

function refreshHomeBanner() {
  const daily = getDailyCard();
  const badge = document.getElementById('daily-status-badge');
  const title = document.getElementById('daily-banner-title');
  const desc = document.getElementById('daily-banner-desc');
  const cta = document.getElementById('daily-banner-cta');

  if (daily) {
    badge.textContent = 'ВАША КАРТА НА СЕГОДНЯ';
    title.textContent = `${daily.card.emoji} ${daily.card.name}`;
    desc.textContent = daily.reversed ? daily.card.reversed : daily.card.upright;
    cta.textContent = 'Читать полное послание';
  } else {
    badge.textContent = 'ПОСЛАНИЕ НА СЕГОДНЯ';
    title.textContent = 'Карта дня';
    desc.textContent = 'Откройте аркан, который задаёт энергию вашего дня';
    cta.textContent = 'Открыть карту';
  }
}

function updateHistoryCounter() {
  const count = loadHistory().length;
  const el = document.getElementById('history-count-label');
  if (el) {
    el.textContent = count > 0 ? `${count} сохранённых` : 'Пока пусто';
  }
}

function renderFeaturedSpreads() {
  const keys = ['three_cards', 'love_simple', 'career', 'celtic_cross', 'decision', 'year_ahead'];
  const container = document.getElementById('featured-spreads-row');
  container.innerHTML = '';

  keys.forEach((key) => {
    const spread = SPREADS.find((s) => s.key === key);
    if (!spread) return;
    const card = document.createElement('button');
    card.className = 'featured-pill-card';
    card.innerHTML = `
      <span class="featured-count">${spread.positions.length} ${pluralCards(spread.positions.length)}</span>
      <div>
        <div class="featured-name">${spread.name}</div>
        <div class="featured-desc">${spread.desc}</div>
      </div>
    `;
    card.addEventListener('click', () => startDrawSession(spread));
    container.appendChild(card);
  });
}

function pluralCards(n) {
  if (n % 10 === 1 && n % 100 !== 11) return 'карта';
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return 'карты';
  return 'карт';
}

function renderSpreadTabs() {
  const container = document.getElementById('spread-category-tabs');
  const tabs = [{ key: 'all', name: `Все (${SPREADS.length})` }, ...CATEGORIES];
  container.innerHTML = '';

  tabs.forEach((cat) => {
    const btn = document.createElement('button');
    btn.className = `pill-tab ${state.activeCategory === cat.key ? 'active' : ''}`;
    btn.textContent = cat.name;
    btn.addEventListener('click', () => {
      sound.playTap();
      state.activeCategory = cat.key;
      renderSpreadTabs();
      renderSpreadsList();
    });
    container.appendChild(btn);
  });
}

function renderSpreadsList() {
  const container = document.getElementById('spreads-list');
  const list =
    state.activeCategory === 'all'
      ? SPREADS
      : SPREADS.filter((s) => s.category === state.activeCategory);

  container.innerHTML = '';
  list.forEach((spread) => {
    const btn = document.createElement('button');
    btn.className = 'spread-row';
    btn.innerHTML = `
      <div class="spread-row-main">
        <span class="spread-row-title">${spread.name}</span>
        <span class="spread-row-desc">${spread.desc}</span>
      </div>
      <span class="spread-count-pill">${spread.positions.length} к.</span>
    `;
    btn.addEventListener('click', () => startDrawSession(spread));
    container.appendChild(btn);
  });
}

function renderFriendSpreads() {
  const container = document.getElementById('friend-spreads-list');
  container.innerHTML = '';
  SPREADS.forEach((spread) => {
    const btn = document.createElement('button');
    btn.className = 'spread-row';
    btn.innerHTML = `
      <div class="spread-row-main">
        <span class="spread-row-title">${spread.name}</span>
        <span class="spread-row-desc">${spread.desc}</span>
      </div>
      <span class="spread-count-pill">${spread.positions.length} к.</span>
    `;
    btn.addEventListener('click', () => {
      const nameInput = document.getElementById('friend-name-input');
      const friendName = nameInput.value.trim();
      if (!friendName) {
        haptic('warning');
        showToast('Сначала введите имя друга ✨');
        nameInput.focus();
        return;
      }
      startDrawSession(spread, { friendName });
    });
    container.appendChild(btn);
  });
}

/* ── INTERACTIVE DRAW TABLE ──────────────────────────────────── */

function startDrawSession(spread, { friendName = null } = {}) {
  // Card of the day is locked once per day
  if (spread.key === 'card_of_day' && !friendName) {
    openDailyCardReading();
    return;
  }

  sound.playShuffle();
  haptic('medium');

  const deckPool = drawRandomCards(22);
  state.drawSession = {
    spread,
    friendName,
    needed: spread.positions.length,
    pool: deckPool,
    picked: [],
  };

  document.getElementById('draw-mode-badge').textContent = friendName
    ? `ПОДАРОК ДЛЯ ${friendName.toUpperCase()}`
    : 'РИТУАЛ ВЫБОРА КАРТ';
  document.getElementById('draw-spread-title').textContent = spread.name;
  document.getElementById('draw-spread-intro').textContent = spread.intro;
  document.getElementById('draw-question-input').value = '';

  renderDrawState();
  navigateTo('draw');
}

function renderDrawState() {
  const s = state.drawSession;
  if (!s) return;

  const rem = s.needed - s.picked.length;
  document.getElementById('draw-progress-text').textContent =
    rem > 0
      ? `Выберите ещё ${rem} ${pluralCards(rem)} (${s.picked.length}/${s.needed})`
      : 'Все карты выбраны — открываем...';

  // Render slots
  const slotsEl = document.getElementById('drawn-slots');
  slotsEl.innerHTML = '';
  for (let i = 0; i < s.needed; i++) {
    const slot = document.createElement('div');
    const filled = i < s.picked.length;
    slot.className = `drawn-slot ${filled ? 'filled' : ''}`;
    slot.innerHTML = filled ? `<span>✦</span><span>${i + 1}</span>` : `<span>${i + 1}</span>`;
    slotsEl.appendChild(slot);
  }

  // Render pickable deck fan
  const deckEl = document.getElementById('deck-strip');
  if (deckEl.childElementCount === 0 || s.picked.length === 0) {
    deckEl.innerHTML = '';
    s.pool.forEach((item, idx) => {
      const cardBtn = document.createElement('button');
      cardBtn.className = 'pickable-card';
      cardBtn.dataset.idx = idx;
      cardBtn.innerHTML = `<div class="pickable-card-inner"></div>`;
      cardBtn.addEventListener('click', () => pickDeckCard(idx, cardBtn));
      deckEl.appendChild(cardBtn);
    });
  }
}

function pickDeckCard(idx, btnEl) {
  const s = state.drawSession;
  if (!s || s.picked.length >= s.needed) return;
  if (btnEl.classList.contains('picked')) return;

  btnEl.classList.add('picked');
  s.picked.push(s.pool[idx]);
  sound.playCardPick(s.picked.length - 1);
  haptic('light');

  // Update slots & counter
  const slotsEl = document.getElementById('drawn-slots');
  const slot = slotsEl.children[s.picked.length - 1];
  if (slot) {
    slot.classList.add('filled');
    slot.innerHTML = `<span>✦</span><span>${s.picked.length}</span>`;
  }

  const rem = s.needed - s.picked.length;
  document.getElementById('draw-progress-text').textContent =
    rem > 0
      ? `Выберите ещё ${rem} ${pluralCards(rem)} (${s.picked.length}/${s.needed})`
      : 'Открываем расклад...';

  if (s.picked.length === s.needed) {
    setTimeout(() => finalizeReading(), 420);
  }
}

function autoDrawRemaining() {
  const s = state.drawSession;
  if (!s) return;
  sound.playShuffle();
  haptic('medium');

  const deckEl = document.getElementById('deck-strip');
  const available = Array.from(deckEl.children).filter((el) => !el.classList.contains('picked'));

  let delay = 0;
  while (s.picked.length < s.needed && available.length > 0) {
    const pickIdx = Math.floor(Math.random() * available.length);
    const el = available.splice(pickIdx, 1)[0];
    const poolIdx = Number(el.dataset.idx);
    s.picked.push(s.pool[poolIdx]);
    const slotIndex = s.picked.length - 1;
    setTimeout(() => {
      el.classList.add('picked');
      sound.playCardPick(slotIndex);
      const slot = document.getElementById('drawn-slots').children[slotIndex];
      if (slot) {
        slot.classList.add('filled');
        slot.innerHTML = `<span>✦</span><span>${slotIndex + 1}</span>`;
      }
    }, delay);
    delay += 95;
  }

  setTimeout(() => finalizeReading(), delay + 360);
}

function openDailyCardReading() {
  const daily = drawAndSaveDailyCard();
  const spread = SPREADS.find((s) => s.key === 'card_of_day');
  const reading = {
    spreadKey: spread.key,
    spreadName: spread.name,
    spreadDesc: `Карта дня · ${new Date().toLocaleDateString('ru-RU')}`,
    positions: spread.positions,
    drawn: [{ card: daily.card, reversed: daily.reversed }],
    friendName: null,
    question: '',
    isDaily: true,
  };
  if (!daily.opened) {
    saveReadingToHistory({
      spreadKey: reading.spreadKey,
      spreadName: reading.spreadName,
      friendName: null,
      question: '',
      cards: [{ id: daily.card.id, reversed: daily.reversed }],
    });
  }
  renderReadingResult(reading);
  navigateTo('result');
}

function finalizeReading() {
  const s = state.drawSession;
  if (!s) return;
  const question = document.getElementById('draw-question-input').value.trim();

  const reading = {
    spreadKey: s.spread.key,
    spreadName: s.spread.name,
    spreadDesc: s.spread.desc,
    positions: s.spread.positions,
    drawn: s.picked,
    friendName: s.friendName,
    question,
  };

  saveReadingToHistory({
    spreadKey: reading.spreadKey,
    spreadName: reading.spreadName,
    friendName: reading.friendName,
    question: reading.question,
    cards: reading.drawn.map((d) => ({ id: d.card.id, reversed: d.reversed })),
  });

  renderReadingResult(reading);
  navigateTo('result');
}

/* ── RESULT VIEW WITH 3D CARD FLIP + DEEP SYNTHESIS ──────────── */

function renderReadingResult(reading) {
  state.lastReading = reading;
  const readerName = tg?.initDataUnsafe?.user?.first_name || 'Вы';

  // Hero header
  const hero = document.getElementById('result-hero');
  hero.innerHTML = `
    <div class="draw-badge ${reading.friendName ? 'badge-magenta' : ''}">
      ${reading.friendName ? `🎁 ПОДАРОК ДЛЯ ${escapeHtml(reading.friendName.toUpperCase())}` : 'ВАШ РАСКЛАД'}
    </div>
    <h2>${escapeHtml(reading.spreadName)}</h2>
    <p>${reading.friendName ? `Гадание от ${escapeHtml(readerName)} · ` : ''}${escapeHtml(reading.spreadDesc)}</p>
    ${reading.question ? `<div class="result-question-quote">«${escapeHtml(reading.question)}»</div>` : ''}
  `;

  // 3D Flipped Cards Grid
  const grid = document.getElementById('revealed-cards-grid');
  grid.innerHTML = '';
  reading.drawn.forEach(({ card, reversed }, idx) => {
    const pos = reading.positions[idx] || `Карта ${idx + 1}`;
    const cardEl = document.createElement('div');
    cardEl.className = 'tarot-flip-card';
    cardEl.innerHTML = `
      <div class="tarot-flip-inner">
        <div class="tarot-face tarot-face-back">✦</div>
        <div class="tarot-face tarot-face-front ${reversed ? 'reversed' : ''}">
          <span class="card-pos-tag">${idx + 1}. ${escapeHtml(pos.split('(')[0].trim())}</span>
          <div class="card-glyph-wrap ${reversed ? 'is-reversed' : ''}">${card.emoji}</div>
          <div class="card-face-name">${escapeHtml(card.name)}</div>
          <span class="card-orient-pill ${reversed ? 'rev' : ''}">${reversed ? 'Перевёрнутая' : 'Прямая'}</span>
        </div>
      </div>
    `;
    cardEl.addEventListener('click', () => openCardModal(card, reversed));
    grid.appendChild(cardEl);

    // Staggered 3D flip with celestial sound
    setTimeout(() => {
      cardEl.classList.add('flipped');
      if (idx < 4) {
        sound.playCardFlip(MAJOR_IDS.has(card.id), reversed);
      }
      if (idx === 0) haptic('success');
    }, 240 + idx * 240);
  });

  // Detailed human-language cards breakdown
  const list = document.getElementById('interpretations-list');
  list.innerHTML = '';
  reading.drawn.forEach(({ card, reversed }, idx) => {
    const pos = reading.positions[idx] || `Позиция ${idx + 1}`;
    const meaning = reversed ? card.reversed : card.upright;
    const firstKw = meaning.split(',')[0].trim();
    const lead = getPositionLead(pos);

    const item = document.createElement('article');
    item.className = 'interp-card';
    item.innerHTML = `
      <div class="interp-head">
        <div>
          <div class="interp-pos">${idx + 1}. ${escapeHtml(pos)}</div>
          <div class="interp-title">${card.emoji} ${escapeHtml(card.name)} <span style="opacity:.55;font-size:16px;">(${escapeHtml(card.num)})</span></div>
        </div>
        <span class="card-orient-pill ${reversed ? 'rev' : ''}">${reversed ? '🔄 Перевёрнутая' : '⬆️ Прямая'}</span>
      </div>
      <p class="interp-story">📖 ${escapeHtml(card.story)}</p>
      <p class="interp-meaning">В позиции «${escapeHtml(pos)}» ${lead} энергия <strong>${escapeHtml(firstKw)}</strong>. ${escapeHtml(meaning)}.</p>
      ${
        reversed
          ? `<div class="interp-warning">⚠️ Карта перевёрнута — эта энергия сейчас заблокирована или проявляется в избытке. Это приглашение остановиться и взглянуть на ситуацию честно.</div>`
          : ''
      }
      <div class="interp-advice">🎯 Совет карты: ${escapeHtml(card.advice)}</div>
    `;
    list.appendChild(item);
  });

  // Final Multi-Card Synthesis
  const syn = buildSynthesis(reading.spreadName, reading.positions, reading.drawn);
  const synEl = document.getElementById('synthesis-card');
  synEl.innerHTML = `
    <div class="synthesis-badge">✦ ОБЩИЙ СИНТЕЗ РАСКЛАДА</div>
    <h3>Что всё это значит вместе</h3>
    <p>${escapeHtml(syn.intro)}</p>
    <p>${escapeHtml(syn.arc)}</p>
    <div class="synthesis-key">✨ Главное послание: ${escapeHtml(syn.keyAdvice)}</div>
  `;

  document.getElementById('btn-share-label').textContent = reading.friendName
    ? `Переслать расклад для ${reading.friendName}`
    : 'Поделиться раскладом';
}

function formatReadingAsPlainText(reading) {
  const syn = buildSynthesis(reading.spreadName, reading.positions, reading.drawn);
  const lines = [];
  if (reading.friendName) {
    lines.push(`🎁 Расклад Таро для ${reading.friendName}`);
  }
  lines.push(`✨ ${reading.spreadName}`);
  if (reading.question) lines.push(`❓ Вопрос: ${reading.question}`);
  lines.push('');
  reading.drawn.forEach(({ card, reversed }, idx) => {
    const pos = reading.positions[idx] || `Карта ${idx + 1}`;
    lines.push(`${idx + 1}. ${pos}: ${card.emoji} ${card.name} (${reversed ? 'перевёрнутая' : 'прямая'})`);
  });
  lines.push('');
  lines.push(`🔮 Итог: ${syn.keyAdvice}`);
  return lines.join('\n');
}

/* ── YES / NO ORACLE ─────────────────────────────────────────── */

function resetOracleStage() {
  state.oracleFlipped = false;
  document.getElementById('oracle-card-3d').classList.remove('flipped');
  document.getElementById('oracle-verdict-panel').classList.add('hidden');
}

function triggerOracle() {
  const card3d = document.getElementById('oracle-card-3d');
  if (state.oracleFlipped) {
    resetOracleStage();
    sound.playShuffle();
    setTimeout(() => revealOracleCard(), 280);
    return;
  }
  revealOracleCard();
}

function revealOracleCard() {
  const [{ card, reversed }] = drawRandomCards(1);
  let weight = card.yes_weight || 0;
  if (reversed) weight = -weight;

  const verdict = weight > 0 ? 'ДА' : weight < 0 ? 'НЕТ' : 'ВОЗМОЖНО';
  const verdictClass = weight > 0 ? 'verdict-yes' : weight < 0 ? 'verdict-no' : 'verdict-maybe';
  const energyNote =
    weight > 0
      ? 'Карта несёт открытую, поддерживающую энергию — путь открыт.'
      : weight < 0
      ? 'Карта предупреждает о препятствии или неверном моменте.'
      : 'Исход не предопределён — многое зависит от вашего следующего шага.';

  const front = document.getElementById('oracle-front');
  front.innerHTML = `
    <span class="oracle-verdict-badge ${verdictClass}">${verdict}</span>
    <div class="card-glyph-wrap ${reversed ? 'is-reversed' : ''}" style="font-size:56px;">${card.emoji}</div>
    <div>
      <div class="card-face-name" style="font-size:21px;">${escapeHtml(card.name)}</div>
      <div style="font-size:11.5px;color:var(--text-muted);margin-top:3px;">${reversed ? '🔄 Перевёрнутая' : '⬆️ Прямая'}</div>
    </div>
  `;

  state.oracleFlipped = true;
  document.getElementById('oracle-card-3d').classList.add('flipped');
  sound.playOracleReveal(weight);
  haptic(weight > 0 ? 'success' : weight < 0 ? 'warning' : 'medium');

  const question = document.getElementById('oracle-question-input').value.trim();
  const panel = document.getElementById('oracle-verdict-panel');
  panel.innerHTML = `
    ${question ? `<div class="result-question-quote" style="margin:0 0 12px;">«${escapeHtml(question)}»</div>` : ''}
    <p style="margin:0 0 10px;font-weight:600;color:var(--gold-soft);">${escapeHtml(energyNote)}</p>
    <p class="interp-story">📖 ${escapeHtml(card.story)}</p>
    <p class="interp-meaning">💡 ${escapeHtml(reversed ? card.reversed : card.upright)}</p>
    <div class="interp-advice">🎯 Совет: ${escapeHtml(card.advice)}</div>
    <button class="btn-glass-secondary" id="btn-oracle-again" style="width:100%;margin-top:14px;">Задать другой вопрос 🔄</button>
  `;
  panel.classList.remove('hidden');
  document.getElementById('btn-oracle-again').addEventListener('click', () => {
    resetOracleStage();
    sound.playTap();
  });

  saveReadingToHistory({
    spreadKey: 'oracle_yesno',
    spreadName: `Да / Нет → ${verdict}`,
    friendName: null,
    question,
    cards: [{ id: card.id, reversed }],
  });
}

/* ── 78-CARD DICTIONARY ──────────────────────────────────────── */

const SUIT_TABS = [
  { key: 'all', name: 'Все (78)' },
  { key: 'major', name: '🌟 Старшие' },
  { key: 'wands', name: '🔥 Жезлы' },
  { key: 'cups', name: '💧 Кубки' },
  { key: 'swords', name: '💨 Мечи' },
  { key: 'pentacles', name: '🌍 Пентакли' },
];

function renderDictTabs() {
  const container = document.getElementById('dict-suit-tabs');
  container.innerHTML = '';
  SUIT_TABS.forEach((tab) => {
    const btn = document.createElement('button');
    btn.className = `pill-tab ${state.activeSuit === tab.key ? 'active' : ''}`;
    btn.textContent = tab.name;
    btn.addEventListener('click', () => {
      sound.playTap();
      state.activeSuit = tab.key;
      renderDictTabs();
      renderDictGrid();
    });
    container.appendChild(btn);
  });
}

function renderDictGrid() {
  const container = document.getElementById('dict-grid');
  const q = state.dictQuery.toLowerCase();
  const filtered = ALL_CARDS.filter((c) => {
    if (state.activeSuit !== 'all' && c.suit !== state.activeSuit) return false;
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      c.upright.toLowerCase().includes(q) ||
      c.reversed.toLowerCase().includes(q)
    );
  });

  container.innerHTML = '';
  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state" style="grid-column:span 2;">Карты по запросу не найдены</div>`;
    return;
  }

  filtered.forEach((card) => {
    const btn = document.createElement('button');
    btn.className = 'dict-card';
    btn.innerHTML = `
      <div class="dict-card-top">
        <span class="dict-emoji">${card.emoji}</span>
        <span class="dict-num">${escapeHtml(card.num)}</span>
      </div>
      <div class="dict-name">${escapeHtml(card.name)}</div>
      <div class="dict-preview">${escapeHtml(card.upright)}</div>
    `;
    btn.addEventListener('click', () => {
      sound.playTap();
      openCardModal(card, false);
    });
    container.appendChild(btn);
  });
}

function openCardModal(card, reversed = false) {
  const body = document.getElementById('modal-body');
  body.innerHTML = `
    <div style="text-align:center;margin-bottom:16px;">
      <div style="font-size:48px;line-height:1;margin-bottom:8px;${reversed ? 'transform:rotate(180deg);display:inline-block;' : ''}">${card.emoji}</div>
      <h2 style="margin:0;font-family:var(--font-display);font-size:30px;">${escapeHtml(card.name)}</h2>
      <div style="font-size:12.5px;color:var(--gold);margin-top:2px;">Аркан ${escapeHtml(card.num)}</div>
    </div>
    <p class="interp-story">📖 ${escapeHtml(card.story)}</p>
    <div style="margin-bottom:12px;">
      <div class="field-label">⬆️ Прямое значение</div>
      <p style="margin:0;font-size:14px;">${escapeHtml(card.upright)}</p>
    </div>
    <div style="margin-bottom:14px;">
      <div class="field-label">🔄 Перевёрнутое значение</div>
      <p style="margin:0;font-size:14px;color:var(--text-muted);">${escapeHtml(card.reversed)}</p>
    </div>
    <div class="synthesis-key">🎯 Совет: ${escapeHtml(card.advice)}</div>
  `;
  document.getElementById('card-modal').classList.remove('hidden');
}

/* ── HISTORY VIEW ────────────────────────────────────────────── */

function renderHistory() {
  const list = loadHistory();
  const container = document.getElementById('history-list');
  const clearBtn = document.getElementById('btn-clear-history');
  clearBtn.classList.toggle('hidden', list.length === 0);

  if (list.length === 0) {
    container.innerHTML = `<div class="empty-state">Вы ещё не делали раскладов в Mini App.<br/>Откройте свой первый аркан ✨</div>`;
    return;
  }

  container.innerHTML = '';
  list.forEach((entry) => {
    const cardNames = (entry.cards || [])
      .map((item) => {
        const c = ALL_CARDS.find((x) => x.id === item.id);
        return c ? `${c.name}${item.reversed ? ' (🔄)' : ''}` : '';
      })
      .filter(Boolean);

    const btn = document.createElement('button');
    btn.className = 'history-item';
    btn.innerHTML = `
      <div class="history-top">
        <span class="history-title">${entry.friendName ? `🎁 Для ${escapeHtml(entry.friendName)}: ` : ''}${escapeHtml(entry.spreadName)}</span>
        <span class="history-time">${escapeHtml(entry.time)}</span>
      </div>
      ${entry.question ? `<div style="font-size:12px;color:var(--text-muted);font-style:italic;">«${escapeHtml(entry.question)}»</div>` : ''}
      <div class="history-cards">${escapeHtml(cardNames.slice(0, 4).join(' · '))}${cardNames.length > 4 ? ` +${cardNames.length - 4}` : ''}</div>
    `;
    btn.addEventListener('click', () => {
      const spread = SPREADS.find((s) => s.key === entry.spreadKey);
      const drawn = (entry.cards || [])
        .map((it) => {
          const c = ALL_CARDS.find((x) => x.id === it.id);
          return c ? { card: c, reversed: it.reversed } : null;
        })
        .filter(Boolean);
      if (drawn.length === 0) return;

      renderReadingResult({
        spreadKey: entry.spreadKey,
        spreadName: entry.spreadName,
        spreadDesc: spread ? spread.desc : entry.time,
        positions: spread ? spread.positions : drawn.map((_, i) => `Карта ${i + 1}`),
        drawn,
        friendName: entry.friendName || null,
        question: entry.question || '',
      });
      navigateTo('result');
    });
    container.appendChild(btn);
  });
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ════════════════════════════════════════════════════════════════
   7. WIRE ALL EVENTS & BOOTSTRAP
   ════════════════════════════════════════════════════════════════ */

function updateSoundIcon() {
  const btn = document.getElementById('btn-sound-toggle');
  document.getElementById('icon-sound-on').classList.toggle('hidden', !sound.enabled);
  document.getElementById('icon-sound-off').classList.toggle('hidden', sound.enabled);
  btn.classList.toggle('muted', !sound.enabled);
}

function bindEvents() {
  // Hero cards playful lift + chime
  document.querySelectorAll('.hero-tarot-card').forEach((card, idx) => {
    card.addEventListener('click', () => {
      sound.playCardPick(idx);
      haptic('light');
      card.classList.toggle('lifted');
      setTimeout(() => card.classList.remove('lifted'), 650);
    });
  });

  // Hero Enter button
  document.getElementById('btn-enter-app').addEventListener('click', () => {
    sound.playShuffle();
    navigateTo('home');
  });

  // Hero Quick Chips
  document.querySelectorAll('.hero-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const action = chip.dataset.action;
      if (action === 'card-of-day') openDailyCardReading();
      if (action === 'oracle') navigateTo('oracle');
      if (action === 'friend') navigateTo('friend');
    });
  });

  // Topbar controls
  document.getElementById('btn-back').addEventListener('click', goBack);
  document.getElementById('btn-to-hero').addEventListener('click', () => navigateTo('hero'));
  document.getElementById('btn-history-shortcut').addEventListener('click', () => navigateTo('history'));
  document.getElementById('btn-sound-toggle').addEventListener('click', () => {
    const on = sound.toggle();
    updateSoundIcon();
    showToast(on ? '🔊 Озвучка включена' : '🔇 Озвучка выключена');
  });

  // Home daily banner
  document.getElementById('banner-daily-card').addEventListener('click', openDailyCardReading);

  // Generic [data-nav] buttons
  document.querySelectorAll('[data-nav]').forEach((el) => {
    el.addEventListener('click', () => navigateTo(el.dataset.nav));
  });

  // Bottom dock tabs
  document.querySelectorAll('.dock-item').forEach((btn) => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.tab, { push: false }));
  });

  // Draw auto-pick
  document.getElementById('btn-auto-draw').addEventListener('click', autoDrawRemaining);

  // Oracle flip
  document.getElementById('oracle-card-3d').addEventListener('click', triggerOracle);

  // Dictionary search
  document.getElementById('dict-search-input').addEventListener('input', (e) => {
    state.dictQuery = e.target.value.trim();
    renderDictGrid();
  });

  // History clear
  document.getElementById('btn-clear-history').addEventListener('click', () => {
    localStorage.removeItem('klim_tarot_history');
    updateHistoryCounter();
    renderHistory();
    showToast('История очищена');
  });

  // Share reading
  document.getElementById('btn-share-reading').addEventListener('click', async () => {
    if (!state.lastReading) return;
    sound.playTap();
    const text = formatReadingAsPlainText(state.lastReading);
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent('https://t.me/MysticalTarotKlimBot')}&text=${encodeURIComponent(text)}`;
    if (tg?.openTelegramLink) {
      tg.openTelegramLink(shareUrl);
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      showToast('Расклад скопирован — можно переслать другу 💌');
    }
  });

  // Send reading back to bot chat
  document.getElementById('btn-send-to-bot').addEventListener('click', async () => {
    if (!state.lastReading) return;
    sound.playTap();
    const payload = {
      type: 'reading_result',
      spreadName: state.lastReading.spreadName,
      friendName: state.lastReading.friendName,
      question: state.lastReading.question,
      summary: formatReadingAsPlainText(state.lastReading),
    };
    if (tg?.sendData) {
      try {
        tg.sendData(JSON.stringify(payload));
        return;
      } catch (_) {}
    }
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(payload.summary);
      showToast('Текст расклада скопирован в буфер ✨');
    }
  });

  // Modal close
  const modal = document.getElementById('card-modal');
  document.getElementById('btn-close-modal').addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });
}

// Ensure background looping videos play smoothly in Telegram iOS/Android WebViews
function ensureVideosPlaying() {
  document.querySelectorAll('video').forEach((v) => {
    v.muted = true;
    v.play().catch(() => {});
  });
}
ensureVideosPlaying();
window.addEventListener('pointerdown', ensureVideosPlaying, { once: true });

// Ставим музыку на паузу, если пользователь свернул Telegram
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (sound.bgm && !sound.bgm.paused) sound.bgm.pause();
  } else if (sound.enabled && sound.bgmActive && sound.bgm) {
    sound.bgm.play().catch(() => {});
  }
});

// Boot
initCosmosCanvas();
updateSoundIcon();
refreshHomeBanner();
updateHistoryCounter();
renderFeaturedSpreads();
renderSpreadTabs();
renderSpreadsList();
renderFriendSpreads();
renderDictTabs();
renderDictGrid();
bindEvents();
