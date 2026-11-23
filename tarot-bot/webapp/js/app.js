import { ALL_CARDS, MAJOR_IDS, SPREADS, CATEGORIES, POSITION_LEADS } from './tarot-data.js?v=15';
import { PSYCH_CATEGORIES, PSYCH_GUIDES } from './psychology-data.js?v=8';
import { ZODIAC_SIGNS, ELEMENT_LABELS, calculateCompatibility } from './zodiac-data.js?v=8';

const BOT_INVITE_URL = 'https://t.me/MysticalTarotKlimBot';
const DEFAULT_SHARE_CTA =
  '✨ Интересно, что карты покажут тебе сегодня? Карта дня, совместимость и 21 расклад бесплатно — гадания тут 👇\n🔮 KLIM TAROT · @MysticalTarotKlimBot';

async function shareContentWithPromo(rawText, customCta = '') {
  sound.playTap();
  const base = (rawText || '').trim();
  const cta = customCta || DEFAULT_SHARE_CTA;
  const fullText = base.includes('@MysticalTarotKlimBot') ? base : `${base}\n\n${cta}`;
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(BOT_INVITE_URL)}&text=${encodeURIComponent(fullText)}`;

  if (tg?.openTelegramLink) {
    tg.openTelegramLink(shareUrl);
    return;
  }
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(fullText);
    showToast('Результат скопирован — отправь другу 💌');
  }
}

const _preloadedImgs = new Set();
function preloadCardImage(card) {
  if (!card?.img || _preloadedImgs.has(card.img)) return null;
  _preloadedImgs.add(card.img);
  const im = new Image();
  im.decoding = 'async';
  im.src = card.img;
  return im;
}

/* ════════════════════════════════════════════════════════════════
   1. TELEGRAM WEBAPP BRIDGE & SWIPE PROTECTION
   ════════════════════════════════════════════════════════════════ */

const tg = window.Telegram?.WebApp || null;

function applyTelegramSettings() {
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
  } catch (_) {}

  try {
    tg.setHeaderColor('#060512');
    tg.setBackgroundColor('#060512');
  } catch (_) {}

  // 1. Disable accidental vertical swipe-down so the Mini App NEVER closes when dragging finger on cards.
  // The app will ONLY close via the explicit Close (✕) button!
  try {
    if (typeof tg.disableVerticalSwipes === 'function') {
      tg.disableVerticalSwipes();
    }
  } catch (err) {
    console.warn('Telegram disableVerticalSwipes:', err);
  }

  // 2. Enable closing confirmation dialog to prevent accidental exit
  try {
    if (typeof tg.enableClosingConfirmation === 'function') {
      tg.enableClosingConfirmation();
    }
  } catch (err) {
    console.warn('Telegram enableClosingConfirmation:', err);
  }
}

applyTelegramSettings();
setTimeout(applyTelegramSettings, 350);
setTimeout(applyTelegramSettings, 1200);

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
    const rawVol = localStorage.getItem('klim_tarot_vol_v2');
    const savedPct = rawVol !== null ? Number(rawVol) : NaN;
    this.volumePercent = Number.isFinite(savedPct) && savedPct >= 0 && savedPct <= 100 ? savedPct : 75;
    this.ctx = null;
    this.bgm = null;
    this.bgmGain = null;
    this.bgmSourceConnected = false;
    this.bgmStarted = false;
    this.bgmTargetVol = this._pctToGain(this.volumePercent);
    this._fadeTimer = null;
    this.playlist = [
      { src: './assets/ambient-1.mp3', name: 'Атмосфера I' },
      { src: './assets/ambient-2.mp3', name: 'Атмосфера II' },
    ];
    this.trackIndex = 0;
  }

  _pctToGain(pct) {
    // 0% -> 0, 75% -> ~0.64 (отчётливая, насыщенная атмосфера по умолчанию), 100% -> 0.85
    return Math.max(0, Math.min(0.85, (pct / 100) * 0.85));
  }

  _applyBgmLevel(level) {
    const v = Math.max(0, Math.min(1, level));
    if (this.bgmGain && this.ctx) {
      try {
        this.bgmGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.04);
      } catch (_) {
        this.bgmGain.gain.value = v;
      }
    }
    if (this.bgm && !this.bgmSourceConnected) {
      try { this.bgm.volume = v; } catch (_) {}
    }
  }

  _attachBgmGain() {
    if (this.bgmSourceConnected || !this.bgm) return;
    const ctx = this._ensureCtx();
    if (!ctx) return;
    try {
      const src = ctx.createMediaElementSource(this.bgm);
      const gain = ctx.createGain();
      gain.gain.value = this.enabled ? this.bgmTargetVol : 0;
      src.connect(gain).connect(ctx.destination);
      this.bgmGain = gain;
      this.bgmSourceConnected = true;
      try { this.bgm.volume = 1; } catch (_) {}
    } catch (_) {}
  }

  setVolumePercent(pct) {
    const clamped = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
    this.volumePercent = clamped;
    this.bgmTargetVol = this._pctToGain(clamped);
    localStorage.setItem('klim_tarot_vol_v2', String(clamped));

    if (clamped === 0) {
      this._applyBgmLevel(0);
      return clamped;
    }
    if (!this.enabled) {
      this.enabled = true;
      localStorage.setItem('klim_tarot_sound', 'on');
    }
    this._ensureBgm();
    this._attachBgmGain();
    if (this.bgm && this.bgm.paused) {
      this._playCurrentTrack(false);
    } else {
      this._applyBgmLevel(this.bgmTargetVol);
    }
    return clamped;
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
      this.bgm = new Audio(this.playlist[this.trackIndex].src);
      this.bgm.loop = false;
      this.bgm.preload = 'auto';
      this.bgm.volume = 0;

      // Плавный автоматический переход к следующему треку по кругу
      this.bgm.addEventListener('ended', () => {
        if (!this.enabled) return;
        this.trackIndex = (this.trackIndex + 1) % this.playlist.length;
        this._playCurrentTrack(true);
      });
    }
    return this.bgm;
  }

  _playCurrentTrack(fadeIn = true) {
    const audio = this._ensureBgm();
    const track = this.playlist[this.trackIndex];
    if (!audio.src.endsWith(track.src.replace('./', ''))) {
      audio.src = track.src;
      audio.load();
    }
    if (fadeIn) this._applyBgmLevel(0);
    this._attachBgmGain();
    return audio.play().then(() => {
      this.bgmStarted = true;
      this._fadeBgmTo(this.bgmTargetVol, fadeIn ? 1400 : 400, false);
    }).catch(() => {});
  }

  _fadeBgmTo(targetVol, durationMs = 1100, pauseAtZero = false) {
    const audio = this.bgm;
    if (!audio) return;
    if (this._fadeTimer) clearInterval(this._fadeTimer);

    const steps = 22;
    const stepMs = Math.max(20, Math.floor(durationMs / steps));
    const startVol = this.bgmGain ? this.bgmGain.gain.value : audio.volume;
    let step = 0;

    this._fadeTimer = setInterval(() => {
      step += 1;
      const t = Math.min(1, step / steps);
      this._applyBgmLevel(startVol + (targetVol - startVol) * t);
      if (t >= 1) {
        clearInterval(this._fadeTimer);
        this._fadeTimer = null;
        if (pauseAtZero && targetVol <= 0.001) {
          audio.pause();
        }
      }
    }, stepMs);
  }

  // Запуск непрерывной фоновой музыки сразу при входе (или при первом касании экрана)
  startAmbience() {
    if (!this.enabled) return;
    const audio = this._ensureBgm();
    if (!audio.paused && this.bgmStarted) return;
    this._playCurrentTrack(true);
  }

  // Ручное переключение между двумя треками
  nextTrack() {
    this.trackIndex = (this.trackIndex + 1) % this.playlist.length;
    if (!this.enabled) {
      this.enabled = true;
      localStorage.setItem('klim_tarot_sound', 'on');
    }
    const audio = this._ensureBgm();
    audio.pause();
    audio.currentTime = 0;
    this._playCurrentTrack(true);
    return { index: this.trackIndex + 1, total: this.playlist.length, name: this.playlist[this.trackIndex].name };
  }

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem('klim_tarot_sound', this.enabled ? 'on' : 'off');
    if (this.enabled) {
      this.playTap();
      this._playCurrentTrack(true);
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


/* ── SEAMLESS VIDEO LOOP (crossfade two players) ───────────────── */
function initSeamlessLoop(videoEl) {
  if (!videoEl || !videoEl.src && !videoEl.querySelector('source')) return;
  const src = videoEl.querySelector('source')?.src || videoEl.src;
  if (!src) return;

  // Create shadow twin video
  const twin = document.createElement('video');
  twin.style.cssText = videoEl.style.cssText;
  twin.className = videoEl.className;
  twin.setAttribute('muted', '');
  twin.muted = true;
  twin.playsInline = true;
  twin.preload = 'auto';
  twin.loop = false;
  twin.style.opacity = '0';
  twin.style.position = 'absolute';
  twin.style.inset = '0';
  twin.style.width = '100%';
  twin.style.height = '100%';
  twin.style.objectFit = 'cover';
  twin.style.transition = 'opacity 1.8s ease';
  const twinSrc = document.createElement('source');
  twinSrc.src = src;
  twinSrc.type = 'video/mp4';
  twin.appendChild(twinSrc);
  videoEl.loop = false;
  videoEl.style.transition = 'opacity 1.8s ease';
  videoEl.parentNode.insertBefore(twin, videoEl.nextSibling);

  let active = videoEl, inactive = twin;
  let crossing = false;

  function crossfade() {
    if (crossing) return;
    crossing = true;
    inactive.currentTime = 0;
    inactive.play().catch(() => {});
    inactive.style.opacity = window.getComputedStyle(active).opacity; // inherit visibility
    // If main-bg-video — match the .visible class opacity (0.18)
    const isBgMain = active.id === 'main-bg-video' || active.classList.contains('main-bg-video');
    inactive.style.opacity = isBgMain ? '0.18' : (active.classList.contains('visible') ? '0.18' : '1');
    active.style.opacity = '0';
    setTimeout(() => {
      active.pause();
      active.currentTime = 0;
      [active, inactive] = [inactive, active];
      crossing = false;
    }, 1900);
  }

  function onTimeUpdate() {
    const v = active;
    if (!v.duration || isNaN(v.duration)) return;
    if (v.currentTime >= v.duration - 2.0 && !crossing) {
      crossfade();
    }
  }

  videoEl.addEventListener('timeupdate', onTimeUpdate);
  twin.addEventListener('timeupdate', () => {
    if (!twin.duration || isNaN(twin.duration)) return;
    if (twin.currentTime >= twin.duration - 2.0 && active === twin && !crossing) {
      crossfade();
    }
  });

  videoEl.play().catch(() => {});
}
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
  let pool = [...ALL_CARDS];
  if (state.isProMode) {
    if (state.proDeckMode === 'major') {
      pool = ALL_CARDS.filter((c) => MAJOR_IDS.has(c.id));
    } else if (state.proDeckMode === 'minor') {
      pool = ALL_CARDS.filter((c) => !MAJOR_IDS.has(c.id));
    }
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const revProb = state.isProMode ? (state.proReversals !== undefined ? state.proReversals : 0.5) : 0.25;
  return pool.slice(0, n).map((card) => ({
    card,
    reversed: Math.random() < revProb,
  }));
}

function buildSynthesis(spreadName, positions, drawn) {
  const n = drawn.length;
  if (n === 1) {
    const { card, reversed } = drawn[0];
    const kw = (reversed ? card.reversed : card.upright).split(',')[0].trim().toLowerCase();
    return {
      intro: reversed
        ? `Аркан «${card.name}» лёг в теневой (перевёрнутой) позиции. Это призыв не торопить внешние события, а обратить внимание на тему «${kw}» и внутренне перенастроиться.`
        : `Аркан «${card.name}» задаёт чистый прямой вектор. Ваша ключевая опора сейчас — «${kw}», доверяйте естественному течению дел.`,
      arc: card.story,
      keyAdvice: card.advice,
    };
  }

  const first = drawn[0];
  const last = drawn[n - 1];
  const middle = drawn.slice(1, -1);
  const firstKw = (first.reversed ? first.card.reversed : first.card.upright).split(',')[0].trim().toLowerCase();
  const lastKw = (last.reversed ? last.card.reversed : last.card.upright).split(',')[0].trim().toLowerCase();

  // Подсчёт распределения стихий и арканов
  const suitCounts = { major: 0, wands: 0, cups: 0, swords: 0, pentacles: 0 };
  drawn.forEach(({ card }) => {
    if (MAJOR_IDS.has(card.id)) suitCounts.major++;
    else if (suitCounts[card.suit] !== undefined) suitCounts[card.suit]++;
  });

  const majorDrawn = drawn.filter(d => MAJOR_IDS.has(d.card.id));
  const revCount = drawn.filter(d => d.reversed).length;

  // 1. Динамическая характеристика момента (Intro)
  let intro = '';
  if (majorDrawn.length >= Math.ceil(n * 0.5)) {
    const names = majorDrawn.map(d => `«${d.card.name}»`).join(' и ');
    intro = `Ситуация носит судьбоносный, кармический характер: сразу ${majorDrawn.length} из ${n} карт — Старшие Арканы (${names}). Происходящее сейчас формирует ваш долгосрочный фундамент и не зависит от мелких случайностей.`;
  } else if (suitCounts.wands >= Math.ceil(n * 0.4)) {
    intro = `В раскладе ярко доминирует стихия Огня (Жезлы) — импульс воли, амбиций и активных шагов. Время сомнений прошло: ситуация ждёт от вас смелости, инициативы и прямого движения вперёд.`;
  } else if (suitCounts.cups >= Math.ceil(n * 0.4)) {
    intro = `Главенствует стихия Воды (Кубки) — сфера сердца, интуиции и искренних связей. Ключ к ответу лежит не в сухих расчётах, а в вашем эмоциональном комфорте и доверии собственному чутью.`;
  } else if (suitCounts.swords >= Math.ceil(n * 0.4)) {
    intro = `Ведущая энергия — стихия Воздуха (Мечи). Происходит ментальная трансформация: пора отсечь лишние иллюзии, посмотреть правде в глаза и принять взвешенное, принципиальное решение.`;
  } else if (suitCounts.pentacles >= Math.ceil(n * 0.4)) {
    intro = `Расклад опирается на стихию Земли (Пентакли) — материальные ресурсы, финансовую устойчивость и практический результат. Фокус на стабильности, надёжности и пошаговом укреплении позиций.`;
  } else if (revCount >= Math.ceil(n * 0.5)) {
    intro = `Большинство карт (${revCount} из ${n}) выпали в теневом (перевёрнутом) положении. Это период внутренней настройки: видимая пауза на деле даёт вам шанс вовремя исправить скрытые ошибки.`;
  } else {
    intro = `Перед вами сбалансированный полифоничный расклад: энергии распределены гармонично, соединяя и практические действия, и искреннее эмоциональное участие.`;
  }

  // 2. Динамическая сюжетная дуга (Arc)
  const firstPosName = (positions[0] || 'Исходная точка').split('(')[0].trim();
  const lastPosName = (positions[n - 1] || 'Итог').split('(')[0].trim();

  let middleClause = '';
  if (middle.length > 0) {
    const midCard = middle[0];
    const midKw = (midCard.reversed ? midCard.card.reversed : midCard.card.upright).split(',')[0].trim().toLowerCase();
    middleClause = ` проходя через призму «${midCard.card.name}» (${midKw}),`;
  }

  let arc = '';
  if (first.reversed && !last.reversed) {
    arc = `Сюжет начинается с преодоления («${first.card.name}» в ${firstPosName}: ${firstKw}), но${middleClause} уверенно выводит вас к созидательному финалу «${last.card.name}» (${lastPosName}: ${lastKw}). Это сильная дуга освобождения от сложностей.`;
  } else if (!first.reversed && last.reversed) {
    arc = `Старт уверенный («${first.card.name}» в ${firstPosName}: ${firstKw}), однако${middleClause} завершающий аркан «${last.card.name}» выпал перевёрнутым. Это совет: не форсируйте события на финише и перепроверьте детали.`;
  } else if (last.card.yes_weight > 0 && !last.reversed) {
    arc = `Вектор развивается последовательно и гармонично: от стартовой энергии «${first.card.name}» (${firstKw})${middleClause} к прямому успеху в позиции «${lastPosName}» («${last.card.name}»: ${lastKw}). Путь свободен.`;
  } else {
    arc = `Линия от «${first.card.name}» (${firstKw})${middleClause} к финальной позиции «${last.card.name}» (${lastKw}) советует действовать взвешенно, сохраняя внутреннее равновесие.`;
  }

  // 3. Точечный панчлайн-совет (Key Advice)
  let keyAdvice = last.card.advice;
  if (last.reversed) {
    keyAdvice = `Учтите теневой намёк карты «${last.card.name}»: ${last.card.reversed.split(',')[0].toLowerCase()}. ${last.card.advice}`;
  } else if (first.card.advice && first.card.advice !== last.card.advice) {
    keyAdvice = `${last.card.advice} Опирайтесь на силу «${first.card.name}» (${firstKw}).`;
  }

  return { intro, arc, keyAdvice };
}

/* ── МЕСТНОЕ ВРЕМЯ ПОЛЬЗОВАТЕЛЯ: КАРТА ДНЯ И НОЧИ + КУЛДАУНЫ ── */

const COOLDOWNS_MS = {
  spread: 15 * 60 * 1000, // 15 минут между раскладами
  oracle: 5 * 60 * 1000,  // 5 минут между вопросами Да/Нет
  friend: 10 * 60 * 1000, // 10 минут между гаданиями для друга
};

const COOLDOWN_LABELS = {
  spread: 'Новый расклад',
  oracle: 'Новый вопрос Оракулу',
  friend: 'Новое гадание для друга',
};

function formatLocalDate(d) {
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

function formatLocalKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getUserDayNightPeriod() {
  const now = new Date(); // Точное местное время устройства пользователя
  const h = now.getHours();
  const m = now.getMinutes();
  const s = now.getSeconds();
  const isDay = h >= 6 && h < 21;

  // Ночь с 21:00 до 06:00 по местному времени — единый период (не сбрасывается в 00:00)
  const anchor = new Date(now.getTime());
  if (h < 6) {
    anchor.setDate(anchor.getDate() - 1);
  }
  const periodKey = `${formatLocalKey(anchor)}-${isDay ? 'day' : 'night'}`;

  const curSecs = h * 3600 + m * 60 + s;
  const targetSecs = isDay ? 21 * 3600 : (h >= 21 ? 30 * 3600 : 6 * 3600);
  const diffSecs = Math.max(1, targetSecs - curSecs);
  const remH = Math.floor(diffSecs / 3600);
  const remM = Math.floor((diffSecs % 3600) / 60);
  const remS = diffSecs % 60;
  const remClock = `${String(remH).padStart(2, '0')}:${String(remM).padStart(2, '0')}:${String(remS).padStart(2, '0')}`;
  const remText = remH > 0 ? `${remH} ч ${remM} мин` : `${remM} мин`;

  return {
    isDay,
    mode: isDay ? 'day' : 'night',
    periodKey,
    dateStr: formatLocalDate(now),
    timeStr: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
    remClock,
    nextIcon: isDay ? '🌙' : '🌅',
    nextShortLabel: isDay ? 'Ночная' : 'Дневная',
    title: isDay ? '🌅 Карта дня' : '🌙 Карта этой ночи',
    badge: isDay ? 'КАРТА ДНЯ' : 'КАРТА ЭТОЙ НОЧИ',
    position: isDay ? 'Послание этого дня' : 'Послание этой ночи',
    promptDesc: isDay
      ? 'Дневной аркан (06:00–21:00) — энергия и фокус вашего дня'
      : 'Ночной аркан (21:00–06:00) — подсказка интуиции и снов на эту ночь',
    nextNote: isDay
      ? `Карта этой ночи откроется в 21:00 (через ${remText})`
      : `Карта дня откроется в 06:00 (через ${remText})`,
  };
}

function getDailyCard() {
  const period = getUserDayNightPeriod();
  try {
    const saved = JSON.parse(localStorage.getItem('klim_tarot_daily_local') || 'null');
    if (saved && saved.periodKey === period.periodKey) {
      const card = ALL_CARDS.find((c) => c.id === saved.cardId);
      if (card) return { card, reversed: saved.reversed, opened: true, period };
    }
  } catch (_) {}
  return null;
}

function drawAndSaveDailyCard() {
  const existing = getDailyCard();
  if (existing) return existing;
  const period = getUserDayNightPeriod();
  const [{ card, reversed }] = drawRandomCards(1);
  localStorage.setItem(
    'klim_tarot_daily_local',
    JSON.stringify({ periodKey: period.periodKey, cardId: card.id, reversed })
  );
  return { card, reversed, opened: false, period };
}

function getCooldownRemaining(kind) {
  const limit = COOLDOWNS_MS[kind] || 0;
  if (!limit) return 0;
  try {
    const map = JSON.parse(localStorage.getItem('klim_tarot_cooldowns') || '{}');
    const lastTs = Number(map[kind] || 0);
    if (!lastTs) return 0;
    const rem = limit - (Date.now() - lastTs);
    return rem > 0 ? rem : 0;
  } catch (_) {
    return 0;
  }
}

function markCooldown(kind) {
  try {
    const map = JSON.parse(localStorage.getItem('klim_tarot_cooldowns') || '{}');
    map[kind] = Date.now();
    localStorage.setItem('klim_tarot_cooldowns', JSON.stringify(map));
  } catch (_) {}
}

function formatDurationMs(ms) {
  const totalSec = Math.ceil(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins > 0) return `${mins} мин ${String(secs).padStart(2, '0')} сек`;
  return `${secs} сек`;
}

function showCooldownModal(kind, remainingMs) {
  haptic('warning');
  const label = COOLDOWN_LABELS[kind] || 'Новое гадание';
  const period = getUserDayNightPeriod();
  const body = document.getElementById('modal-body');
  body.innerHTML = `
    <div style="text-align:center;padding:8px 0 6px;">
      <div style="font-size:44px;line-height:1;margin-bottom:10px;">⏳</div>
      <h2 style="margin:0 0 8px;font-family:var(--font-display);font-size:28px;">Колода отдыхает</h2>
      <p style="margin:0 0 14px;font-size:14px;color:var(--text-muted);">
        Чтобы ответы Таро оставались точными, между гаданиями нужен небольшой перерыв.
      </p>
      <div class="synthesis-key" style="margin-bottom:14px;">
        ${escapeHtml(label)} откроется через <strong id="cooldown-live-timer">${formatDurationMs(remainingMs)}</strong>
      </div>
      <p style="margin:0 0 16px;font-size:12.5px;color:var(--text-faint);">
        Сейчас ${escapeHtml(period.timeStr)} · ${escapeHtml(period.nextNote)}
      </p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <button class="btn-glass-secondary" id="cd-open-history">📜 Моя история</button>
        <button class="btn-glass-secondary" id="cd-open-dict">📖 Словарь карт</button>
      </div>
    </div>
  `;
  const modal = document.getElementById('card-modal');
  modal.classList.remove('hidden');

  document.getElementById('cd-open-history').addEventListener('click', () => {
    modal.classList.add('hidden');
    navigateTo('history');
  });
  document.getElementById('cd-open-dict').addEventListener('click', () => {
    modal.classList.add('hidden');
    navigateTo('dictionary');
  });

  clearInterval(modal._cdTimer);
  modal._cdTimer = setInterval(() => {
    if (modal.classList.contains('hidden')) {
      clearInterval(modal._cdTimer);
      return;
    }
    const rem = getCooldownRemaining(kind);
    const timerEl = document.getElementById('cooldown-live-timer');
    if (!timerEl) {
      clearInterval(modal._cdTimer);
      return;
    }
    if (rem <= 0) {
      clearInterval(modal._cdTimer);
      timerEl.textContent = 'уже доступно ✨';
    } else {
      timerEl.textContent = formatDurationMs(rem);
    }
  }, 1000);
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

const OWNER_TELEGRAM_ID = 7446803539;

function getTelegramUserId() {
  try {
    const u = window.Telegram?.WebApp?.initDataUnsafe?.user;
    if (u && u.id) return Number(u.id);
    const raw = window.Telegram?.WebApp?.initData || '';
    if (raw) {
      const sp = new URLSearchParams(raw);
      const userStr = sp.get('user');
      if (userStr) {
        const parsed = JSON.parse(userStr);
        if (parsed.id) return Number(parsed.id);
      }
    }
  } catch (e) {}
  return null;
}

function checkProAccessFromEnv() {
  const uid = getTelegramUserId();
  if (uid && uid === OWNER_TELEGRAM_ID) {
    try { localStorage.setItem('klim_tarot_pro_granted', 'true'); } catch (e) {}
    return true;
  }

  try {
    const urlParams = new URLSearchParams(window.location.search);
    const hash = window.location.hash || '';
    const hashParams = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
    const startParam = tg?.initDataUnsafe?.start_param || '';

    if (
      urlParams.get('pro') === '1' ||
      urlParams.get('pro') === 'true' ||
      hashParams.get('pro') === '1' ||
      startParam === 'pro' ||
      startParam.startsWith('pro_')
    ) {
      localStorage.setItem('klim_tarot_pro_granted', 'true');
      localStorage.setItem('klim_tarot_pro_mode', 'true');
      return true;
    }
  } catch (e) {}

  return localStorage.getItem('klim_tarot_pro_granted') === 'true';
}

function hasProAccess() {
  return checkProAccessFromEnv();
}

const state = {
  currentView: 'hero',
  historyStack: [],
  activeCategory: 'all',
  activeSuit: 'all',
  activePsychCat: 'all',
  compatSignA: 'aries',
  compatSignB: 'leo',
  dictQuery: '',
  drawSession: null, // { spread, friendName, question, needed, pool, picked: [] }
  lastReading: null,
  oracleFlipped: false,
  isProMode: hasProAccess() && (localStorage.getItem('klim_tarot_pro_mode') !== 'false'),
  proDeckMode: localStorage.getItem('klim_tarot_pro_deck') || 'all', // 'all' | 'major' | 'minor'
  proReversals: parseFloat(localStorage.getItem('klim_tarot_pro_rev') || '0.5'), // 0.5 | 0.25 | 0
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
  psychology: 'Психология и Таро',
  compat: 'Совместимость',
  dictionary: 'Словарь карт',
  history: 'История',
  plans: 'Тарифы и подписка',
  fortune: 'Колесо Фортуны',
  invite: 'Пригласить друзей',
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
  sound.startAmbience();

  if (viewName === 'hero') {
    viewHero.classList.remove('hidden');
    mainChrome.classList.add('hidden');
    document.getElementById('main-bg-video')?.classList.remove('visible');
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
  document.getElementById('main-bg-video')?.classList.add('visible');

  document.querySelectorAll('.subview').forEach((el) => el.classList.remove('active'));
  const target = document.getElementById(`view-${viewName}`);
  if (target) target.classList.add('active');

  state.currentView = viewName;
  topbarTitle.textContent = VIEW_TITLES[viewName] || 'KLIM TAROT';

  // Update dock active state
  const dockTabs = ['home', 'spreads', 'oracle', 'psychology', 'dictionary'];
  const dockTab = dockTabs.includes(viewName) ? viewName : null;
  document.querySelectorAll('.dock-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === dockTab);
  });

  // Back button visibility
  const showBack = !dockTabs.includes(viewName);
  btnBack.classList.toggle('hidden', !showBack);
  if (tg?.BackButton) {
    if (showBack) tg.BackButton.show();
    else tg.BackButton.hide();
  }

  if (viewName !== 'psychology') stopBreathing();
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
  const period = getUserDayNightPeriod();
  const daily = getDailyCard();
  const badge = document.getElementById('daily-status-badge');
  const title = document.getElementById('daily-banner-title');
  const desc = document.getElementById('daily-banner-desc');
  const cta = document.getElementById('daily-banner-cta');
  const timerPill = document.getElementById('daily-timer-pill');
  const heroChip = document.querySelector('.hero-chip[data-action="card-of-day"]');

  if (daily) {
    badge.textContent = `${period.badge} · ОТКРЫТА`;
    title.textContent = `${daily.card.emoji} ${daily.card.name}`;
    desc.textContent = `${period.nextNote}`;
    cta.textContent = 'Читать послание';
    if (timerPill) {
      timerPill.textContent = `${period.nextIcon} ${period.remClock}`;
      timerPill.classList.remove('hidden');
    }
    if (heroChip) {
      heroChip.innerHTML = `<span class="chip-dot dot-gold"></span>Карта дня и ночи <span class="hero-chip-timer">${period.remClock}</span>`;
    }
  } else {
    badge.textContent = `🌗 КАРТА ДНЯ И НОЧИ · ${period.timeStr}`;
    title.textContent = period.title;
    desc.textContent = period.promptDesc;
    cta.textContent = period.isDay ? 'Открыть карту дня' : 'Открыть карту ночи';
    if (timerPill) {
      timerPill.textContent = `${period.nextIcon} до ${period.isDay ? '21:00' : '06:00'} · ${period.remClock}`;
      timerPill.classList.remove('hidden');
    }
    if (heroChip) {
      heroChip.innerHTML = `<span class="chip-dot dot-gold"></span>Карта дня и ночи`;
    }
  }

  // Обновляем маленькие цифры таймера в списке раскладов, если он открыт
  const spreadRowTimer = document.getElementById('spread-daily-timer');
  if (spreadRowTimer) {
    spreadRowTimer.textContent = daily
      ? `${period.nextIcon} ${period.remClock}`
      : '1 к.';
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
  const keys = [
    'thoughts_feelings_actions',
    'three_cards',
    'station_for_two',
    'wish_fulfillment',
    'finance',
    'week_ahead',
    'celtic_cross',
    'decision',
  ];
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
    const isDaily = spread.key === 'card_of_day';
    const daily = isDaily ? getDailyCard() : null;
    const period = isDaily ? getUserDayNightPeriod() : null;
    const pillText = isDaily && daily ? `${period.nextIcon} ${period.remClock}` : `${spread.positions.length} к.`;
    btn.innerHTML = `
      <div class="spread-row-main">
        <span class="spread-row-title">${spread.name}${spread.popular ? '<span class="spread-popular-tag">ХИТ</span>' : ''}</span>
        <span class="spread-row-desc">${spread.desc}</span>
      </div>
      <span class="spread-count-pill" ${isDaily ? 'id="spread-daily-timer"' : ''}>${pillText}</span>
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

function startDrawSession(spread, { friendName = null, customQuestion = '' } = {}) {
  // Карта дня и ночи фиксируется на текущий дневной или ночной период по времени пользователя
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
    : customQuestion
    ? 'РАСКЛАД ПО ВАШЕЙ ТЕМЕ'
    : 'РИТУАЛ ВЫБОРА КАРТ';
  document.getElementById('draw-spread-title').textContent = spread.name;
  document.getElementById('draw-spread-intro').textContent = spread.intro;
  document.getElementById('draw-question-input').value = customQuestion || '';

  const tuner = document.getElementById('pro-draw-tuner');
  if (tuner) tuner.classList.toggle('hidden', !state.isProMode);
  if (state.isProMode) {
    document.querySelectorAll('#pro-deck-chips .pro-chip').forEach(b => {
      b.classList.toggle('active', b.dataset.deck === state.proDeckMode);
    });
    document.querySelectorAll('#pro-rev-chips .pro-chip').forEach(b => {
      b.classList.toggle('active', parseFloat(b.dataset.rev) === state.proReversals);
    });
  }

  renderDrawState();
  navigateTo('draw');
}

const TAROT_BACK_SVG = `
<svg viewBox="0 0 100 164" aria-hidden="true">
  <rect x="4" y="4" width="92" height="156" rx="8" fill="none" stroke="#f5c969" stroke-width="1.2" opacity="0.9"/>
  <rect x="9" y="9" width="82" height="146" rx="5" fill="none" stroke="#e040fb" stroke-width="0.7" stroke-dasharray="2.5 2" opacity="0.65"/>
  <circle cx="50" cy="82" r="21" fill="none" stroke="#f5c969" stroke-width="1.1" opacity="0.88"/>
  <circle cx="50" cy="82" r="14" fill="none" stroke="#22d3ee" stroke-width="0.7" stroke-dasharray="2 2" opacity="0.7"/>
  <path d="M50 64 L53.5 78.5 L68 82 L53.5 85.5 L50 100 L46.5 85.5 L32 82 L46.5 78.5 Z" fill="#fde68a" opacity="0.92"/>
  <path d="M50 22 L52 32 L50 36 L48 32 Z M50 142 L52 132 L50 128 L48 132 Z" fill="#f5c969" opacity="0.8"/>
  <circle cx="20" cy="24" r="1.6" fill="#22d3ee"/>
  <circle cx="80" cy="24" r="1.6" fill="#e040fb"/>
  <circle cx="20" cy="140" r="1.6" fill="#e040fb"/>
  <circle cx="80" cy="140" r="1.6" fill="#22d3ee"/>
</svg>`;

function attach3DTilt(el, maxDeg = 14) {
  if (!el) return;
  const update = (clientX, clientY) => {
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const px = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const py = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const rx = (0.5 - py) * maxDeg * 2;
    const ry = (px - 0.5) * maxDeg * 2;
    el.style.setProperty('--rx', `${rx.toFixed(1)}deg`);
    el.style.setProperty('--ry', `${ry.toFixed(1)}deg`);
    el.style.setProperty('--gx', `${(px * 100).toFixed(1)}%`);
    el.style.setProperty('--gy', `${(py * 100).toFixed(1)}%`);
    el.style.setProperty('--glare-op', '0.78');
  };
  const reset = () => {
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
    el.style.setProperty('--gx', '50%');
    el.style.setProperty('--gy', '35%');
    el.style.setProperty('--glare-op', '0.38');
  };
  el.addEventListener('pointermove', (e) => update(e.clientX, e.clientY));
  el.addEventListener('pointerleave', reset);
  el.addEventListener('pointerup', reset);
  el.addEventListener('pointercancel', reset);
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

  // Render curved 3D Tarot fan with ornate gilded backs
  const deckEl = document.getElementById('deck-strip');
  if (deckEl.childElementCount === 0 || s.picked.length === 0) {
    deckEl.innerHTML = '';
    const mid = (s.pool.length - 1) / 2;
    s.pool.forEach((item, idx) => {
      const offset = (idx - mid) / Math.max(1, mid);
      const rot = (offset * 10).toFixed(1);
      const liftY = (Math.pow(offset, 2) * 16).toFixed(1);
      const cardBtn = document.createElement('button');
      cardBtn.className = 'pickable-card';
      cardBtn.dataset.idx = idx;
      cardBtn.style.setProperty('--fan-rot', `${rot}deg`);
      cardBtn.style.setProperty('--fan-y', `${liftY}px`);
      cardBtn.innerHTML = `<div class="pickable-card-inner">${TAROT_BACK_SVG}</div>`;
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
  const chosen = s.pool[idx];
  s.picked.push(chosen);
  preloadCardImage(chosen.card);
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
    const chosen = s.pool[poolIdx];
    s.picked.push(chosen);
    preloadCardImage(chosen.card);
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
  const existing = getDailyCard();
  if (existing) {
    preloadCardImage(existing.card);
    const period = existing.period;
    const reading = {
      spreadKey: 'card_of_day',
      spreadName: period.title,
      spreadDesc: `${period.dateStr} (${period.timeStr}) · ${period.nextNote}`,
      positions: [period.position],
      drawn: [{ card: existing.card, reversed: existing.reversed }],
      friendName: null,
      question: '',
      isDaily: true,
    };
    renderReadingResult(reading);
    navigateTo('result');
    return;
  }

  // Новая карта дня/ночи: сначала мистическая пустота и кнопка проявления по клику
  const period = getUserDayNightPeriod();
  const hero = document.getElementById('result-hero');
  hero.innerHTML = `
    <div class="draw-badge">${escapeHtml(period.badge)}</div>
    <h2>${escapeHtml(period.title)}</h2>
    <p>${escapeHtml(period.promptDesc)}</p>
  `;

  const grid = document.getElementById('revealed-cards-grid');
  grid.classList.remove('two-cols');
  grid.classList.add('single-card');
  grid.innerHTML = `
    <div class="daily-void-stage">
      <div class="daily-void-slot" id="daily-void-slot" role="button" tabindex="0" aria-label="Проявить карту">
        <div class="daily-void-seal">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
            <path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" stroke-linejoin="round"/>
          </svg>
        </div>
        <div class="daily-void-caption">Сделайте вдох и коснитесь пустоты, чтобы карта проявилась</div>
      </div>
      <button type="button" class="btn-fusion-primary daily-void-btn" id="btn-manifest-daily">
        <span>✦ ${period.isDay ? 'Проявить карту дня' : 'Проявить карту ночи'}</span>
      </button>
    </div>
  `;

  document.getElementById('interpretations-list')?.classList.add('hidden');
  document.getElementById('synthesis-card')?.classList.add('hidden');
  document.querySelector('#view-result .result-actions')?.classList.add('hidden');

  const manifestNow = () => {
    const daily = drawAndSaveDailyCard();
    preloadCardImage(daily.card);
    const p = daily.period;
    const reading = {
      spreadKey: 'card_of_day',
      spreadName: p.title,
      spreadDesc: `${p.dateStr} (${p.timeStr}) · ${p.nextNote}`,
      positions: [p.position],
      drawn: [{ card: daily.card, reversed: daily.reversed }],
      friendName: null,
      question: '',
      isDaily: true,
    };
    saveReadingToHistory({
      spreadKey: reading.spreadKey,
      spreadName: reading.spreadName,
      friendName: null,
      question: '',
      cards: [{ id: daily.card.id, reversed: daily.reversed }],
    });
    refreshHomeBanner();
    renderReadingResult(reading);
  };

  document.getElementById('daily-void-slot')?.addEventListener('click', manifestNow, { once: true });
  document.getElementById('btn-manifest-daily')?.addEventListener('click', manifestNow, { once: true });
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
  document.getElementById('interpretations-list')?.classList.remove('hidden');
  document.getElementById('synthesis-card')?.classList.remove('hidden');
  document.querySelector('#view-result .result-actions')?.classList.remove('hidden');
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

  // 3D Flipped Authentic Rider-Waite Tarot Cards Grid
  const grid = document.getElementById('revealed-cards-grid');
  grid.classList.remove('single-card', 'two-cols');
  if (reading.drawn.length === 1) grid.classList.add('single-card');
  else if (reading.drawn.length === 2 || reading.drawn.length === 4) grid.classList.add('two-cols');

  grid.innerHTML = '';
  reading.drawn.forEach(({ card, reversed }, idx) => {
    const pos = reading.positions[idx] || `Карта ${idx + 1}`;
    const cardEl = document.createElement('div');
    cardEl.className = 'tarot-flip-card';
    cardEl.innerHTML = `
      <div class="tarot-flip-inner">
        <div class="tarot-face tarot-face-back">${TAROT_BACK_SVG}</div>
        <div class="tarot-face tarot-face-front ${reversed ? 'reversed' : ''}">
          <div class="tarot-art-frame">
            <img src="${escapeHtml(card.img || '')}" alt="${escapeHtml(card.name)}" class="tarot-art-img ${reversed ? 'is-reversed' : ''}" loading="eager" />
            <div class="tarot-foil-glare"></div>
            <div class="tarot-top-chip">
              <span class="card-pos-tag">${idx + 1}. ${escapeHtml(pos.split('(')[0].trim())}</span>
              ${reversed ? '<span class="card-rev-dot">🔄</span>' : ''}
            </div>
            <div class="tarot-caption-bar">
              <div class="card-face-name">${escapeHtml(card.name)}</div>
            </div>
          </div>
        </div>
      </div>
    `;
    attach3DTilt(cardEl, 11);
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

  // 👁 CLIENT MODE TOGGLE
  const existingClientBtn = document.getElementById('client-mode-btn');
  if (existingClientBtn) existingClientBtn.remove();
  const clientBtn = document.createElement('button');
  clientBtn.id = 'client-mode-btn';
  clientBtn.className = 'client-mode-btn';
  clientBtn.innerHTML = '👁 Режим таролога: скрыть значения';
  let _clientModeOn = false;
  const _toggleTargets = () => {
    _clientModeOn = !_clientModeOn;
    clientBtn.innerHTML = _clientModeOn
      ? '👁 Показать значения'
      : '👁 Режим таролога: скрыть значения';
    clientBtn.classList.toggle('active', _clientModeOn);
    ['synthesis-card', 'interpretations-list', 'pro-analysis-container'].forEach(id => {
      document.getElementById(id)?.classList.toggle('client-hidden-block', _clientModeOn);
    });
  };
  clientBtn.addEventListener('click', _toggleTargets);
  document.getElementById('result-hero').after(clientBtn);

  // 🌟 TOP SYNTHESIS: Bottom-Line Up Front (Directly under cards)
  const syn = buildSynthesis(reading.spreadName, reading.positions, reading.drawn);
  const synEl = document.getElementById('synthesis-card');
  synEl.innerHTML = `
    <div class="synthesis-top-row">
      <div class="synthesis-badge">✦ ГЛАВНЫЙ СИНТЕЗ</div>
      <div class="synthesis-spread-pill">${escapeHtml(reading.spreadName)}</div>
    </div>
    <div class="synthesis-punchline-card">
      <div class="punchline-gem">🎯</div>
      <div class="punchline-content">
        <div class="punchline-caption">КЛЮЧЕВОЙ ВЫВОД РАСКЛАДА</div>
        <div class="punchline-text">${escapeHtml(syn.keyAdvice)}</div>
      </div>
    </div>
    <div class="synthesis-story-grid">
      <div class="synthesis-mini-card">
        <div class="synthesis-step-badge">1. СУТЬ МОМЕНТА</div>
        <p>${escapeHtml(syn.intro)}</p>
      </div>
      <div class="synthesis-mini-card">
        <div class="synthesis-step-badge">2. ВЕКТОР СОБЫТИЙ</div>
        <p>${escapeHtml(syn.arc)}</p>
      </div>
    </div>
  `;

  // PRO Preview or Full PRO Matrix
  const oldTeaser = document.getElementById('pro-teaser-banner');
  if (oldTeaser) oldTeaser.remove();

  if (state.isProMode) {
    renderProResultMatrix(reading);
  } else {
    document.getElementById('pro-analysis-container')?.classList.add('hidden');
    const teaser = document.createElement('div');
    teaser.id = 'pro-teaser-banner';
    teaser.className = 'pro-teaser-banner';
    teaser.innerHTML = `
      <div class="pro-teaser-icon">⚡</div>
      <div class="pro-teaser-info">
        <div class="pro-teaser-head">Хотите увидеть скрытый пласт расклада?</div>
        <div class="pro-teaser-sub">Баланс 4 стихий · Теневая карта (Дно колоды) · Квинтэссенция расклада</div>
      </div>
      <button type="button" class="btn-teaser-unlock" id="btn-teaser-unlock">Включить PRO</button>
    `;
    document.getElementById('synthesis-card').after(teaser);
    teaser.querySelector('#btn-teaser-unlock')?.addEventListener('click', () => {
      state.isProMode = true;
      localStorage.setItem('klim_tarot_pro_mode', 'true');
      haptic('success');
      updateProModeUI();
      sound.playShuffle();
      teaser.remove();
      showToast('⚡ Экспертный режим (PRO) активирован!');
    });
  }

  // Collapsible cards breakdown (No more walls of text!)
  const list = document.getElementById('interpretations-list');
  list.innerHTML = '';
  reading.drawn.forEach(({ card, reversed }, idx) => {
    const pos = reading.positions[idx] || `Позиция ${idx + 1}`;
    const meaning = reversed ? card.reversed : card.upright;
    const firstKw = meaning.split(',')[0].trim();
    const lead = getPositionLead(pos);

    const item = document.createElement('article');
    item.className = `interp-card collapsible ${idx === 0 ? 'is-open' : ''}`;
    item.innerHTML = `
      <div class="interp-head" role="button" tabindex="0" aria-expanded="${idx === 0 ? 'true' : 'false'}">
        <div class="interp-head-left">
          <span class="interp-pos-tag">${idx + 1}. ${escapeHtml(pos.split('(')[0].trim())}</span>
          <div class="interp-card-title">
            <span class="interp-emoji">${card.emoji}</span>
            <span class="interp-card-name">${escapeHtml(card.name)}</span>
            <span class="interp-card-num">(${escapeHtml(card.num)})</span>
          </div>
        </div>
        <div class="interp-head-right">
          <span class="card-orient-pill ${reversed ? 'rev' : ''}">${reversed ? '🔄 Перевёрнутая' : '⬆️ Прямая'}</span>
          <svg class="interp-toggle-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
      </div>

      <div class="interp-preview-line">
        <span class="preview-lead">${escapeHtml(lead)}:</span> <strong>${escapeHtml(firstKw)}</strong> — ${escapeHtml(meaning.split('.')[0])}.
      </div>

      <div class="interp-expanded-body">
        <div class="interp-expanded-inner">
          <p class="interp-story">📖 <strong>Архетип и сюжет:</strong> ${escapeHtml(card.story)}</p>
          ${
            reversed
              ? `<div class="interp-warning">⚠️ <strong>Теневой аспект:</strong> энергия аркана перевёрнута — она проявляется в скрытой, подавленной форме или требует честного взгляда внутрь себя.</div>`
              : ''
          }
          <div class="interp-advice">🎯 <strong>Совет аркана:</strong> ${escapeHtml(card.advice)}</div>
        </div>
      </div>
    `;

    const head = item.querySelector('.interp-head');
    head.addEventListener('click', () => {
      sound.playTap();
      haptic('light');
      item.classList.toggle('is-open');
    });

    list.appendChild(item);
  });

  document.getElementById('btn-share-label').textContent = reading.friendName
    ? `Переслать расклад для ${reading.friendName}`
    : 'Поделиться раскладом';
}

function updateProModeUI() {
  const btn = document.getElementById('btn-pro-toggle');
  if (btn) {
    btn.classList.toggle('is-active', state.isProMode);
    btn.setAttribute('aria-pressed', state.isProMode ? 'true' : 'false');
  }
  const heroBtn = document.getElementById('btn-hero-pro-toggle');
  if (heroBtn) {
    heroBtn.classList.toggle('is-active', state.isProMode);
  }
  document.body.classList.toggle('is-pro-mode', state.isProMode);

  const customBadge = document.getElementById('custom-topic-badge');
  if (customBadge) {
    customBadge.textContent = state.isProMode ? '⚡ PRO · СВОЯ ТЕМА (АКТИВНА)' : '⚡ PRO · СВОЯ ТЕМА';
  }

  const tuner = document.getElementById('pro-draw-tuner');
  if (tuner) {
    tuner.classList.toggle('hidden', !state.isProMode);
  }

  const proResult = document.getElementById('pro-analysis-container');
  if (proResult && state.lastReading) {
    proResult.classList.toggle('hidden', !state.isProMode);
    if (state.isProMode) renderProResultMatrix(state.lastReading);
  }
}

function renderProResultMatrix(reading) {
  const container = document.getElementById('pro-analysis-container');
  if (!container || !reading || !reading.drawn) return;
  container.classList.remove('hidden');

  // 1. Стихийный баланс (Золотая Заря)
  let fire = 0, water = 0, air = 0, earth = 0, spirit = 0;
  reading.drawn.forEach(({ card }) => {
    if (MAJOR_IDS.has(card.id)) spirit++;
    else if (card.suit === 'wands') fire++;
    else if (card.suit === 'cups') water++;
    else if (card.suit === 'swords') air++;
    else if (card.suit === 'pentacles') earth++;
  });
  const total = reading.drawn.length || 1;
  const pFire = Math.round((fire / total) * 100);
  const pWater = Math.round((water / total) * 100);
  const pAir = Math.round((air / total) * 100);
  const pEarth = Math.round((earth / total) * 100);
  const pSpirit = Math.round((spirit / total) * 100);

  const barEl = document.getElementById('pro-elements-bar');
  if (barEl) {
    barEl.innerHTML = `
      <div class="elem-seg elem-seg-fire" style="width:${pFire}%" title="Огонь: ${pFire}%"></div>
      <div class="elem-seg elem-seg-water" style="width:${pWater}%" title="Вода: ${pWater}%"></div>
      <div class="elem-seg elem-seg-air" style="width:${pAir}%" title="Воздух: ${pAir}%"></div>
      <div class="elem-seg elem-seg-earth" style="width:${pEarth}%" title="Земля: ${pEarth}%"></div>
      <div class="elem-seg elem-seg-spirit" style="width:${pSpirit}%" title="Дух (СА): ${pSpirit}%"></div>
    `;
  }

  // Диагноз взаимодействия стихий
  let diag = '';
  if (spirit >= Math.ceil(total * 0.5)) {
    diag = `👑 <strong>Высший кармический фон (${spirit}/${total} Старших Арканов):</strong> ситуация выходит за рамки бытовых решений. Здесь действуют судьбоносные силы и архетипический урок.`;
  } else if (fire > 0 && air > 0 && water === 0) {
    diag = `🔥💨 <strong>Синергия Огня и Воздуха (${pFire}% Огонь, ${pAir}% Воздух):</strong> активная мысль мгновенно переходит в действие. Высокий энтузиазм и решительность, но полное отсутствие Воды предупреждает: не забывайте об искренности и чувствах близких.`;
  } else if (water > 0 && earth > 0 && fire === 0) {
    diag = `💧🌱 <strong>Питательный союз Воды и Земли (${pWater}% Вода, ${pEarth}% Земля):</strong> эмоциональная стабильность, надёжная забота и материальное укрепление союза или проекта.`;
  } else if (fire > 0 && water > 0) {
    diag = `🔥💧 <strong>Кипение стихий (Огонь + Вода):</strong> столкновение страстного порыва и глубоких переживаний. Профессиональный совет: избегайте поспешных решений на пике эмоций.`;
  } else if (air > 0 && earth > 0) {
    diag = `💨🌱 <strong>Воздух и Земля (${pAir}% Воздух, ${pEarth}% Земля):</strong> структурированный аналитический расчёт, приземление идей в чёткие сроки и цифры.`;
  } else {
    diag = `⚖️ <strong>Гармоничный поли-стихийный баланс:</strong> все сферы человеческой жизни (воля, чувства, мысли и материя) задействованы в разрешении ситуации.`;
  }

  const diagEl = document.getElementById('pro-elements-diagnosis');
  if (diagEl) {
    diagEl.innerHTML = `
      <div class="pro-elements-legend">
        <span class="legend-item"><span class="legend-dot" style="background:#ef4444"></span>Огонь: ${fire} (${pFire}%)</span>
        <span class="legend-item"><span class="legend-dot" style="background:#06b6d4"></span>Вода: ${water} (${pWater}%)</span>
        <span class="legend-item"><span class="legend-dot" style="background:#a855f7"></span>Воздух: ${air} (${pAir}%)</span>
        <span class="legend-item"><span class="legend-dot" style="background:#10b981"></span>Земля: ${earth} (${pEarth}%)</span>
        <span class="legend-item"><span class="legend-dot" style="background:#fde047"></span>Дух (СА): ${spirit} (${pSpirit}%)</span>
      </div>
      <div>${diag}</div>
    `;
  }

  // 2. Дно колоды (Shadow card)
  const drawnIds = new Set(reading.drawn.map(d => d.card.id));
  const availableShadows = ALL_CARDS.filter(c => !drawnIds.has(c.id));
  const seed = reading.drawn.reduce((acc, d) => acc + (d.card.id.length * 11) + (d.reversed ? 3 : 1), 7);
  const shadowCard = availableShadows[seed % availableShadows.length] || ALL_CARDS[0];

  const shadowEl = document.getElementById('pro-shadow-content');
  if (shadowEl) {
    shadowEl.innerHTML = `
      <img src="${escapeHtml(shadowCard.img || '')}" alt="${escapeHtml(shadowCard.name)}" class="pro-thumb-img" />
      <div class="pro-shadow-info">
        <div class="pro-shadow-name">${shadowCard.emoji} ${escapeHtml(shadowCard.name)} (${escapeHtml(shadowCard.num)})</div>
        <div class="pro-shadow-desc"><strong>Бессознательный импульс ситуации:</strong> ${escapeHtml(shadowCard.upright)}</div>
        <div style="font-size:11px;color:#facc15;margin-top:2px;">Мастер видит здесь скрытый мотив, который остаётся «за кадром» сознания кверента.</div>
      </div>
    `;
  }

  // 3. Квинтэссенция (Quintessence)
  let numSum = 0;
  const romans = { '0':0, 'I':1, 'II':2, 'III':3, 'IV':4, 'V':5, 'VI':6, 'VII':7, 'VIII':8, 'IX':9, 'X':10, 'XI':11, 'XII':12, 'XIII':13, 'XIV':14, 'XV':15, 'XVI':16, 'XVII':17, 'XVIII':18, 'XIX':19, 'XX':20, 'XXI':21 };
  reading.drawn.forEach(({ card }) => {
    if (MAJOR_IDS.has(card.id)) {
      const parsed = parseInt(card.num, 10);
      if (!isNaN(parsed)) numSum += parsed;
      else numSum += (romans[card.num] !== undefined ? romans[card.num] : 1);
    } else {
      const match = (card.num || '').match(/\d+/);
      if (match) numSum += parseInt(match[0], 10);
      else numSum += 5;
    }
  });

  let quintNum = numSum;
  while (quintNum > 22) {
    quintNum = String(quintNum).split('').reduce((a, b) => a + parseInt(b, 10), 0);
  }
  if (quintNum === 0 || quintNum > 22) quintNum = 22;

  const majorList = ALL_CARDS.filter(c => MAJOR_IDS.has(c.id));
  const quintCard = majorList[(quintNum - 1) % majorList.length];

  const quintEl = document.getElementById('pro-quint-content');
  if (quintEl) {
    quintEl.innerHTML = `
      <img src="${escapeHtml(quintCard.img || '')}" alt="${escapeHtml(quintCard.name)}" class="pro-thumb-img" />
      <div class="pro-quint-info">
        <div class="pro-quint-name">${quintCard.emoji} ${escapeHtml(quintCard.name)} (Числовой код: ${numSum} → ${quintNum})</div>
        <div class="pro-quint-desc"><strong>Высший духовный урок расклада:</strong> ${escapeHtml(quintCard.advice)}</div>
        <div style="font-size:11px;color:#fde047;margin-top:2px;">Связующий мета-аркан, показывающий вектор развития всей ситуации.</div>
      </div>
    `;
  }

  // 4. Кнопки «+ Доп» под каждой картой в подробном толковании
  const listItems = document.querySelectorAll('#interpretations-list .interp-card');
  listItems.forEach((item, idx) => {
    if (item.querySelector('.btn-pro-clarifier') || item.querySelector('.pro-clarifier-result')) return;
    const btnClarifier = document.createElement('button');
    btnClarifier.type = 'button';
    btnClarifier.className = 'btn-pro-clarifier';
    btnClarifier.innerHTML = '<span>✦ Вытянуть доп (уточнение)</span>';
    btnClarifier.addEventListener('click', () => {
      sound.playCardPick(idx);
      haptic('medium');
      const unused = ALL_CARDS.filter(c => !drawnIds.has(c.id));
      const dopCard = unused[Math.floor(Math.random() * unused.length)] || ALL_CARDS[0];
      const dopRev = Math.random() < 0.35;
      const dopMeaning = dopRev ? dopCard.reversed : dopCard.upright;
      const resEl = document.createElement('div');
      resEl.className = 'pro-clarifier-result';
      resEl.innerHTML = `
        🔍 <strong>Уточняющий доп:</strong> ${dopCard.emoji} <strong>${escapeHtml(dopCard.name)}</strong> (${dopRev ? 'перевёрнутая' : 'прямая'})<br>
        <em>«${escapeHtml(dopMeaning)}»</em>
      `;
      btnClarifier.replaceWith(resEl);
      showToast(`✦ Доп вытянут: ${dopCard.name}`);
    });
    item.appendChild(btnClarifier);
  });

  // 5. Карточка кверента & Экспорт отчёта
  const exportBtn = document.getElementById('btn-pro-export-client');
  if (exportBtn) {
    exportBtn.onclick = () => {
      const notes = (document.getElementById('pro-client-notes')?.value || '').trim();
      const reportLines = [
        `🔮 ЭКСПЕРТНЫЙ ПРОТОКОЛ ТАРО-СЕССИИ`,
        `Расклад: «${reading.spreadName}»`,
      ];
      if (reading.question) reportLines.push(`Вопрос кверента: «${reading.question}»`);
      reportLines.push(``);
      reportLines.push(`🎴 ВЫПАВШИЕ АРКАНЫ:`);
      reading.drawn.forEach(({ card, reversed }, i) => {
        const pos = reading.positions[i] || `Позиция ${i + 1}`;
        reportLines.push(`${i + 1}. ${pos}: ${card.emoji} ${card.name} [${reversed ? '🔄 перевёрнутая' : '⬆️ прямая'}]`);
        reportLines.push(`   → ${reversed ? card.reversed : card.upright}`);
      });
      reportLines.push(``);
      reportLines.push(`⚖️ СТИХИЙНЫЙ БАЛАНС: Огонь ${pFire}% | Вода ${pWater}% | Воздух ${pAir}% | Земля ${pEarth}% | СА ${pSpirit}%`);
      reportLines.push(`🌑 ДНО КОЛОДЫ (ТЕНЬ): ${shadowCard.emoji} ${shadowCard.name} — ${shadowCard.upright.split(',')[0]}`);
      reportLines.push(`🔢 КВИНТЭССЕНЦИЯ: ${quintCard.emoji} ${quintCard.name} — ${quintCard.advice}`);
      if (notes) {
        reportLines.push(``);
        reportLines.push(`📝 ЗАМЕТКИ МАСТЕРА:`);
        reportLines.push(notes);
      }
      reportLines.push(``);
      reportLines.push(`✦ Консультация проведена в KLIM TAROT PRO`);

      const fullReport = reportLines.join('\n');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(fullReport).then(() => {
          haptic('success');
          showToast('✦ Экспертный отчёт скопирован в буфер обмена!');
        }).catch(() => {
          showToast('✦ Текст отчёта подготовлен!');
        });
      } else {
        showToast('✦ Текст отчёта подготовлен!');
      }
    };
  }
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
  if (state.oracleFlipped && state.currentOracleCard) {
    sound.playTap();
    openCardModal(state.currentOracleCard, state.currentOracleReversed);
    return;
  }
  revealOracleCard();
}

async function revealOracleCard() {
  const [{ card, reversed }] = drawRandomCards(1);
  state.currentOracleCard = card;
  state.currentOracleReversed = reversed;
  let weight = card.yes_weight || 0;
  if (reversed) weight = -weight;

  // Wait briefly for local WebP decode so the card never flips blank
  const pre = preloadCardImage(card);
  if (pre && pre.decode) {
    await Promise.race([
      pre.decode().catch(() => {}),
      new Promise((r) => setTimeout(r, 180)),
    ]);
  }

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
    <div class="tarot-art-frame" style="border-radius:14px;">
      <span class="oracle-verdict-badge ${verdictClass}">${verdict}</span>
      <img src="${escapeHtml(card.img || '')}" alt="${escapeHtml(card.name)}" class="tarot-art-img ${reversed ? 'is-reversed' : ''}" />
      <div class="tarot-foil-glare"></div>
      <div class="tarot-caption-bar" style="padding:24px 10px 10px;">
        <div class="card-face-name" style="font-size:21px;">${escapeHtml(card.name)}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${reversed ? '🔄 Перевёрнутая' : '⬆️ Прямая'}</div>
      </div>
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
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px;">
      <button class="btn-glass-secondary" id="btn-share-oracle">Поделиться 💌</button>
      <button class="btn-glass-secondary" id="btn-oracle-again">Ещё вопрос 🔄</button>
    </div>
  `;
  panel.classList.remove('hidden');
  document.getElementById('btn-share-oracle').addEventListener('click', () => {
    const qLine = question ? `❓ Вопрос: «${question}»\n` : '';
    const txt =
      `🔮 Оракул Да/Нет — ответ: ${verdict}\n` +
      qLine +
      `🃏 Аркан: ${card.emoji} ${card.name} (${reversed ? 'перевёрнутая' : 'прямая'})\n` +
      `🎯 Совет: ${card.advice}`;
    shareContentWithPromo(
      txt,
      '✨ Задай свой вопрос Оракулу бесплатно — гадания тут 👇\n🔮 KLIM TAROT · @MysticalTarotKlimBot'
    );
  });
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
  {
    key: 'all',
    name: 'Все (78)',
    svg: '<svg class="suit-pill-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="3" width="11" height="16" rx="2"/><path d="M16 7h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-1"/></svg>',
  },
  {
    key: 'major',
    name: 'Старшие',
    svg: '<svg class="suit-pill-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" stroke-linejoin="round"/></svg>',
  },
  {
    key: 'wands',
    name: 'Жезлы',
    svg: '<svg class="suit-pill-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 19L19 5M14 5l5 0 0 5M9 11l4 4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  },
  {
    key: 'cups',
    name: 'Кубки',
    svg: '<svg class="suit-pill-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 4h12v4a6 6 0 0 1-12 0V4zM12 14v6M8 20h8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  },
  {
    key: 'swords',
    name: 'Мечи',
    svg: '<svg class="suit-pill-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v14M8 13h8M10 20h4M12 17v3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  },
  {
    key: 'pentacles',
    name: 'Пентакли',
    svg: '<svg class="suit-pill-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M12 5.5l2.1 6.2 5.4.1-4.3 3.3 1.6 5.4-4.8-3.3-4.8 3.3 1.6-5.4-4.3-3.3 5.4-.1L12 5.5z" stroke-linejoin="round"/></svg>',
  },
];

function renderDictTabs() {
  const container = document.getElementById('dict-suit-tabs');
  container.innerHTML = '';
  SUIT_TABS.forEach((tab) => {
    const btn = document.createElement('button');
    btn.className = `pill-tab ${state.activeSuit === tab.key ? 'active' : ''}`;
    btn.innerHTML = `${tab.svg}<span>${escapeHtml(tab.name)}</span>`;
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
    btn.className = 'dict-card dict-card-skeleton';
    btn.innerHTML = `
      <div class="dict-thumb-wrap">
        <img src="${escapeHtml(card.img || '')}" alt="${escapeHtml(card.name)}" class="dict-thumb-img" loading="lazy" />
      </div>
      <div class="dict-name">${escapeHtml(card.name)}</div>
    `;
    const _dImg = btn.querySelector('.dict-thumb-img');
    if (_dImg) {
      _dImg.addEventListener('load', () => btn.classList.remove('dict-card-skeleton'), { once: true });
      _dImg.addEventListener('error', () => btn.classList.remove('dict-card-skeleton'), { once: true });
    }
    btn.addEventListener('click', () => {
      sound.playTap();
      openCardModal(card, false);
    });
    container.appendChild(btn);
  });
}

function openCardModal(card, reversed = false) {
  const body = document.getElementById('modal-body');
  const isMajor = MAJOR_IDS.has(card.id);

  // Generate contextual interpretations from card data
  function contextFor(area) {
    const base = reversed ? card.reversed : card.upright;
    const keywords = base.split(',').map(s => s.trim()).filter(Boolean);
    const ctx = {
      love:     { icon: '❤️', label: 'В любви' },
      career:   { icon: '💼', label: 'В работе' },
      health:   { icon: '🌿', label: 'Здоровье' },
      spirit:   { icon: '✨', label: 'Духовный рост' },
    };
    const c = ctx[area];
    return { ...c, text: keywords.slice(0, 2).join(', ') || base.substring(0, 60) };
  }

  // Affirmation mantra based on card
  const mantras = {
    fool: 'Я открыт к новому — вселенная меня поддерживает',
    magician: 'У меня есть всё необходимое для действия прямо сейчас',
    high_priestess: 'Я доверяю своей интуиции и внутреннему голосу',
    empress: 'Я питаю и создаю изобилие в своей жизни',
    emperor: 'Я строю прочный фундамент с уверенностью',
    hierophant: 'Я нахожу мудрость в традиции и наставничестве',
    lovers: 'Я делаю выборы из любви и целостности',
    chariot: 'Я направляю свою волю к победе',
    strength: 'Моя истинная сила — в мягкости и выдержке',
    hermit: 'В тишине я нахожу путь',
    wheel: 'Я принимаю перемены как часть своего пути',
    justice: 'Я действую честно и получаю справедливый результат',
    hanged: 'Пауза открывает новый взгляд на ситуацию',
    death: 'Я отпускаю старое, давая место новому',
    temperance: 'Я нахожу баланс и поток в своей жизни',
    devil: 'Я осознаю ограничения и выбираю свободу',
    tower: 'Крах старого открывает путь к истинному',
    star: 'Я верю в свет впереди — надежда реальна',
    moon: 'Я принимаю неопределённость как часть пути',
    sun: 'Я сияю и дарю радость миру',
    judgement: 'Я слышу зов и поднимаюсь к своей высшей версии',
    world: 'Я завершаю цикл с благодарностью и мудростью',
  };
  const mantra = mantras[card.id] || (reversed
    ? 'Я принимаю теневую сторону как часть роста'
    : 'Я открыт посланию этой карты');

  const loveCtx = contextFor('love');
  const careerCtx = contextFor('career');
  const healthCtx = contextFor('health');
  const spiritCtx = contextFor('spirit');

  body.innerHTML = `
    <div class="modal-card-stage">
      <div class="modal-tarot-3d" id="modal-tarot-3d">
        <div class="tarot-art-frame" style="border-radius:11px;">
          <img src="${escapeHtml(card.img || '')}" alt="${escapeHtml(card.name)}" class="tarot-art-img ${reversed ? 'is-reversed' : ''}" />
          <div class="tarot-foil-glare"></div>
        </div>
      </div>
      <div class="modal-tilt-hint">Покрутите карту пальцем ✦ 3D-обзор</div>
      <h2 style="margin:10px 0 2px;font-family:var(--font-display);font-size:28px;">${escapeHtml(card.name)}</h2>
      <div style="font-size:12.5px;color:var(--gold);">
        ${isMajor ? `Старший Аркан ${escapeHtml(card.num)}` : `Масть · ${escapeHtml(card.suit === 'major' ? 'Старшие' : card.suit === 'cups' ? 'Кубки' : card.suit === 'wands' ? 'Жезлы' : card.suit === 'swords' ? 'Мечи' : 'Пентакли')}`}
        ${reversed ? ' · 🔄 Перевёрнутая' : ' · ↑ Прямая'}
      </div>
    </div>

    <div class="card-meaning-block upright">
      <div class="card-meaning-orient">↑ ПРЯМОЕ ЗНАЧЕНИЕ</div>
      <div class="card-meaning-text">${escapeHtml(card.upright)}</div>
    </div>
    <div class="card-meaning-block reversed">
      <div class="card-meaning-orient">🔄 ПЕРЕВЁРНУТОЕ ЗНАЧЕНИЕ</div>
      <div class="card-meaning-text">${escapeHtml(card.reversed)}</div>
    </div>

    <div class="modal-section-title">📖 История и символизм</div>
    <p class="interp-story" style="font-size:13.5px;line-height:1.6;">${escapeHtml(card.story)}</p>

    <div class="modal-section-title">🎯 Контекст по сферам жизни</div>
    <div class="card-context-grid">
      <div class="card-context-cell">
        <div class="card-context-icon">${loveCtx.icon}</div>
        <div class="card-context-label">${loveCtx.label}</div>
        <div class="card-context-text">${escapeHtml(loveCtx.text)}</div>
      </div>
      <div class="card-context-cell">
        <div class="card-context-icon">${careerCtx.icon}</div>
        <div class="card-context-label">${careerCtx.label}</div>
        <div class="card-context-text">${escapeHtml(careerCtx.text)}</div>
      </div>
      <div class="card-context-cell">
        <div class="card-context-icon">${healthCtx.icon}</div>
        <div class="card-context-label">${healthCtx.label}</div>
        <div class="card-context-text">${escapeHtml(healthCtx.text)}</div>
      </div>
      <div class="card-context-cell">
        <div class="card-context-icon">${spiritCtx.icon}</div>
        <div class="card-context-label">${spiritCtx.label}</div>
        <div class="card-context-text">${escapeHtml(spiritCtx.text)}</div>
      </div>
    </div>

    <div class="card-mantra-block">
      <div class="card-mantra-label">✨ Мантра карты</div>
      <div class="card-mantra-text">${escapeHtml(mantra)}</div>
    </div>

    <div class="synthesis-key">🎯 Совет: ${escapeHtml(card.advice)}</div>
  `;
  attach3DTilt(document.getElementById('modal-tarot-3d'), 18);
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

const HERO_MYSTIC_PHRASES = [
  "Космическая интуиция в современном ритме",
  "Вселенная уже знает ответ — доверься потоку",
  "Слушай не голос сомнений, а шёпот интуиции",
  "Звёзды подсказывают путь, но выбор за тобой",
  "В тишине колоды рождается кристальная ясность",
  "Случайных карт не бывает — есть своевременные",
  "Архетипы говорят на тайном языке твоей души",
  "То, что ты ищешь, уже направляется к тебе",
  "Сделай глубокий вдох — ответы уже внутри",
  "Энергия дня раскрывается тем, кто готов слышать",
  "Зеркало твоего подсознания в 78 древних арканах",
  "Каждая карта — это ключ к скрытой двери возможностей",
  "Мудрость веков в ритме современного дня",
  "Отпусти суету — соединись со своим истинным центром",
  "Твой внутренний компас точнее любых внешних советов",
  "Свет Луны освещает скрытое, Солнце являет истину",
  "Взгляни на вопрос с высоты небесного горизонта",
  "Позволь картам проявить то, что скрыто от глаз",
  "Сила момента — в твоём осознанном выборе",
  "Космос говорит с тобой через сакральные символы",
  "Нити судьбы плетутся из твоих сегодняшних мыслей",
  "Каждый аркан — зеркало твоей скрытой силы",
  "Гармония стихий приносит ясность в любой тупик",
  "Прислушайся к тишине: там звучит твоя правда",
  "Энергия следует за фокусом твоего внимания",
  "Расклад не диктует судьбу — он освещает развилки",
  "Там, где кончаются сомнения, начинается магия действия",
  "Древняя мудрость Таро — твой верный навигатор",
  "Сегодняшний день полон знаков — будь внимателен",
  "Ты стоишь на пороге важного инсайта — откройся ему",
  "Все стихии мира сходятся в точке твоего присутствия",
  "Твоё будущее создаётся прямо сейчас"
];

function randomizeHeroSubtitle() {
  const el = document.getElementById('hero-dynamic-subtitle');
  if (!el) return;
  const phrase = HERO_MYSTIC_PHRASES[Math.floor(Math.random() * HERO_MYSTIC_PHRASES.length)];
  el.textContent = phrase;
  el.title = "Нажмите, чтобы сменить мысль дня ✨";
  el.style.cursor = "pointer";
}

function updateSoundIcon() {
  const btn = document.getElementById('btn-sound-toggle');
  document.getElementById('icon-sound-on').classList.toggle('hidden', !sound.enabled);
  document.getElementById('icon-sound-off').classList.toggle('hidden', sound.enabled);
  btn.classList.toggle('muted', !sound.enabled);
}

function bindEvents() {
  // Hero dynamic subtitle click to rotate
  const subEl = document.getElementById('hero-dynamic-subtitle');
  if (subEl) {
    subEl.addEventListener('click', () => {
      sound.playTap();
      haptic('light');
      randomizeHeroSubtitle();
    });
  }

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

  // Smooth non-jerking loop for spreads background video
  const spreadsVid = document.querySelector('.spreads-bg-video');
  if (spreadsVid) {
    spreadsVid.addEventListener('timeupdate', () => {
      if (spreadsVid.duration && spreadsVid.currentTime > spreadsVid.duration - 0.4) {
        spreadsVid.style.opacity = '0.19';
      } else {
        spreadsVid.style.opacity = '0.24';
      }
    });
  }

  // Hero Quick Chips
  document.querySelectorAll('.hero-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const action = chip.dataset.action;
      if (action === 'card-of-day') openDailyCardReading();
      else if (action === 'spreads') navigateTo('spreads');
      else if (action === 'oracle') navigateTo('oracle');
      else if (action === 'compat') navigateTo('compat');
      else if (action === 'psych') navigateTo('psych');
      else if (action === 'friend') navigateTo('friend');
      else if (action === 'fortune') navigateTo('fortune');
      else if (action === 'invite') navigateTo('invite');
      else navigateTo('home');
    });
  });

  // Topbar controls
  document.getElementById('btn-back').addEventListener('click', goBack);
  document.getElementById('btn-to-hero').addEventListener('click', () => navigateTo('hero'));
  document.getElementById('btn-history-shortcut').addEventListener('click', () => navigateTo('history'));
  document.getElementById('btn-app-close')?.addEventListener('click', () => {
    sound.playTap();
    haptic('medium');
    if (tg?.close) {
      tg.close();
    } else {
      navigateTo('hero');
    }
  });
  document.getElementById('btn-sound-toggle').addEventListener('click', () => {
    const on = sound.toggle();
    updateSoundIcon();
    showToast(on ? '🔊 Музыка и звуки включены' : '🔇 Звук выключен');
  });

  // ⚡ Экспертный режим (PRO) переключатель в шапке и на стартовой заставке
  const toggleProHandler = () => {
    if (!hasProAccess()) {
      haptic('warning');
      const entered = window.prompt('🔒 Режим PRO доступен по подписке.\nЕсли у вас есть промокод или ключ от владельца, введите его:');
      if (entered && ['KLIM', 'KLIMPRO', 'TAROT', 'VIP', 'LOVE', 'TAROTPRO'].includes(entered.trim().toUpperCase())) {
        try {
          localStorage.setItem('klim_tarot_pro_granted', 'true');
          localStorage.setItem('klim_tarot_pro_mode', 'true');
        } catch (e) {}
        state.isProMode = true;
        haptic('success');
        updateProModeUI();
        sound.playShuffle();
        showToast('🎉 Доступ активирован! Экспертный режим PRO разблокирован навсегда!');
        return;
      }
      showToast('🔒 Режим PRO закрыт. Доступ открывается по подписке или владельцем бота!');
      return;
    }
    state.isProMode = !state.isProMode;
    localStorage.setItem('klim_tarot_pro_mode', state.isProMode ? 'true' : 'false');
    haptic(state.isProMode ? 'success' : 'light');
    updateProModeUI();
    if (state.isProMode) {
      sound.playShuffle();
      showToast('⚡ Экспертный режим (PRO) включён: открыты стихии, дно колоды, квинт и своя тема');
    } else {
      showToast('🔮 Включён базовый режим для новичков');
    }
  };
  document.getElementById('btn-pro-toggle')?.addEventListener('click', toggleProHandler);
  document.getElementById('btn-hero-pro-toggle')?.addEventListener('click', toggleProHandler);

  // PRO Tuner Chips
  document.querySelectorAll('#pro-deck-chips .pro-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#pro-deck-chips .pro-chip').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.proDeckMode = btn.dataset.deck;
      localStorage.setItem('klim_tarot_pro_deck', state.proDeckMode);
      haptic('light');
    });
  });

  document.querySelectorAll('#pro-rev-chips .pro-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#pro-rev-chips .pro-chip').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.proReversals = parseFloat(btn.dataset.rev);
      localStorage.setItem('klim_tarot_pro_rev', String(state.proReversals));
      haptic('light');
    });
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

  // Plan select buttons (ЮKassa) -> мгновенный переход к счёту на оплату
  document.querySelectorAll('.btn-plan-select').forEach((btn) => {
    btn.addEventListener('click', () => {
      sound.playTap();
      haptic('medium');
      const planKey = btn.dataset.plan || 'month';
      const checkoutUrl = `https://t.me/MysticalTarotKlimBot?start=pay_${planKey}`;
      if (tg?.openTelegramLink) {
        tg.openTelegramLink(checkoutUrl);
        try { tg.close(); } catch (_) {}
      } else {
        window.location.href = checkoutUrl;
      }
    });
  });

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
  document.getElementById('btn-share-reading').addEventListener('click', () => {
    if (!state.lastReading) return;
    shareContentWithPromo(formatReadingAsPlainText(state.lastReading));
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

  // Psychology anti-stress breathing toggle
  const breathBtn = document.getElementById('btn-breath-toggle');
  if (breathBtn) {
    breathBtn.addEventListener('click', toggleBreathing);
  }

  // Zodiac compatibility calculate button
  const compatBtn = document.getElementById('btn-calc-compat');
  if (compatBtn) {
    compatBtn.addEventListener('click', runCompatibilityCheck);
  }

  // Top-bar settings modal button
  const settingsBtn = document.getElementById('btn-settings');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', openSettingsModal);
  }

  // Custom Topic Spread Builder
  let customTopicCount = 3;
  const topicInput = document.getElementById('custom-topic-input');
  document.querySelectorAll('.topic-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      sound.playTap();
      haptic('light');
      if (topicInput) {
        topicInput.value = chip.dataset.topic || chip.textContent.trim();
        topicInput.focus();
      }
    });
  });
  document.querySelectorAll('.topic-cnt-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      sound.playTap();
      customTopicCount = Number(btn.dataset.cnt) || 3;
      document.querySelectorAll('.topic-cnt-btn').forEach((b) => b.classList.toggle('active', b === btn));
    });
  });
  document.getElementById('btn-launch-custom-topic')?.addEventListener('click', () => {
    if (!state.isProMode) {
      haptic('warning');
      showToast('⚡ «Своя тема» входит в Экспертный режим. Включите PRO вверху!');
      const pToggle = document.getElementById('btn-pro-toggle');
      if (pToggle) {
        pToggle.classList.add('is-active');
        setTimeout(() => { if (!state.isProMode) pToggle.classList.remove('is-active'); }, 1400);
      }
      return;
    }
    const topic = (topicInput?.value || '').trim();
    if (!topic) {
      haptic('warning');
      showToast('Введите тему или выберите подсказку выше ✨');
      topicInput?.focus();
      return;
    }
    const posMap = {
      3: [
        'Суть вашей темы прямо сейчас',
        'Что помогает или скрыто влияет',
        'Совет карт и ближайший исход',
      ],
      5: [
        'Суть ситуации по вашей теме',
        'Скрытый фактор, который важно учесть',
        'Главное препятствие или риск',
        'Лучший шаг, который стоит сделать',
        'Вероятный итог развития темы',
      ],
      7: [
        'Корень и предыстория вопроса',
        'Настоящий момент (точка А)',
        'Ваши внутренние ожидания и страхи',
        'Внешние обстоятельства и люди',
        'Что мешает решению',
        'Ключевой совет карт',
        'Итоговый исход по вашей теме',
      ],
    };
    const customSpread = {
      key: 'custom_topic',
      name: `✨ Тема: ${topic.length > 34 ? topic.slice(0, 34) + '…' : topic}`,
      desc: `Персональный расклад на ${customTopicCount} ${pluralCards(customTopicCount)} по вашему запросу`,
      positions: posMap[customTopicCount] || posMap[3],
      category: 'custom',
      intro: `Сосредоточьтесь на теме «${topic}» и интуитивно выберите ${customTopicCount} ${pluralCards(customTopicCount)}.`,
    };
    startDrawSession(customSpread, { customQuestion: topic });
  });
}

function openSettingsModal() {
  sound.playTap();
  haptic('light');
  const body = document.getElementById('modal-body');
  const curTrack = sound.playlist[sound.trackIndex]?.name || 'Атмосфера I';

  body.innerHTML = `
    <h2 style="margin:0 0 14px;font-family:var(--font-display);font-size:28px;">Настройки</h2>

    <div class="settings-block">
      <div class="settings-row-head">
        <span class="settings-label">Громкость музыки</span>
        <span class="settings-val" id="settings-vol-label">${sound.enabled ? sound.volumePercent : 0}%</span>
      </div>
      <input
        type="range"
        id="settings-vol-slider"
        class="volume-slider"
        min="0"
        max="100"
        step="1"
        value="${sound.enabled ? sound.volumePercent : 0}"
      />
      <div class="settings-audio-btns">
        <button class="btn-glass-secondary" id="settings-sound-toggle">
          ${sound.enabled ? 'Выключить звук' : 'Включить звук'}
        </button>
        <button class="btn-glass-secondary" id="settings-next-track">
          Трек: ${escapeHtml(curTrack)}
        </button>
      </div>
    </div>

    <div class="support-admin-card">
      <div class="support-admin-title">Возникли проблемы или вопросы?</div>
      <p class="support-admin-desc">
        Если что-то не открывается, есть идея по улучшению или нужна помощь — напишите администратору напрямую в Telegram.
      </p>
      <button class="support-admin-btn" id="btn-contact-admin">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 5L2 12.5l7 2.5 2.5 7L21 5z" stroke-linejoin="round"/>
          <path d="M9 15l12-10" stroke-linecap="round"/>
        </svg>
        <span>Связь с администратором · @im_klim</span>
      </button>
    </div>
  `;

  const slider = document.getElementById('settings-vol-slider');
  const volLabel = document.getElementById('settings-vol-label');
  const toggleBtn = document.getElementById('settings-sound-toggle');
  const trackBtn = document.getElementById('settings-next-track');

  slider?.addEventListener('input', (e) => {
    const pct = sound.setVolumePercent(e.target.value);
    if (volLabel) volLabel.textContent = `${pct}%`;
    if (toggleBtn) toggleBtn.textContent = pct > 0 ? 'Выключить звук' : 'Включить звук';
    updateSoundIcon();
  });

  toggleBtn?.addEventListener('click', () => {
    const on = sound.toggle();
    updateSoundIcon();
    const shownPct = on ? sound.volumePercent : 0;
    if (slider) slider.value = String(shownPct);
    if (volLabel) volLabel.textContent = `${shownPct}%`;
    toggleBtn.textContent = on ? 'Выключить звук' : 'Включить звук';
  });

  trackBtn?.addEventListener('click', () => {
    const info = sound.nextTrack();
    updateSoundIcon();
    trackBtn.textContent = `Трек: ${info.name}`;
    if (slider) slider.value = String(sound.volumePercent);
    if (volLabel) volLabel.textContent = `${sound.volumePercent}%`;
    if (toggleBtn) toggleBtn.textContent = 'Выключить звук';
    showToast(`🎵 ${info.name} (${info.index}/${info.total})`);
  });

  document.getElementById('btn-contact-admin')?.addEventListener('click', () => {
    sound.playTap();
    const adminUrl = 'https://t.me/im_klim';
    if (tg?.openTelegramLink) {
      tg.openTelegramLink(adminUrl);
    } else {
      window.open(adminUrl, '_blank', 'noopener');
    }
  });

  document.getElementById('card-modal').classList.remove('hidden');
}

/* ── PSYCHOLOGY & TAROT GUIDE ────────────────────────────────── */

let _breathTimer = null;
let _breathTick = 0;

function stopBreathing() {
  if (_breathTimer) {
    clearInterval(_breathTimer);
    _breathTimer = null;
  }
  const ring = document.getElementById('breath-ring');
  const counter = document.getElementById('breath-counter');
  const title = document.getElementById('breath-phase-title');
  const sub = document.getElementById('breath-phase-sub');
  const btn = document.getElementById('btn-breath-toggle');
  if (ring) ring.className = 'breath-ring';
  if (counter) counter.textContent = '4–4–4';
  if (title) title.textContent = 'Пауза от стресса · 1 мин';
  if (sub) sub.textContent = 'Спокойное дыхание перед раскладом или после смены';
  if (btn) {
    btn.textContent = 'Начать';
    btn.classList.remove('active');
  }
}

function toggleBreathing() {
  sound.playTap();
  haptic('light');
  if (_breathTimer) {
    stopBreathing();
    return;
  }
  const ring = document.getElementById('breath-ring');
  const counter = document.getElementById('breath-counter');
  const title = document.getElementById('breath-phase-title');
  const sub = document.getElementById('breath-phase-sub');
  const btn = document.getElementById('btn-breath-toggle');
  if (!ring || !btn) return;

  btn.textContent = 'Стоп';
  btn.classList.add('active');
  _breathTick = 0;

  const phases = [
    { cls: 'inhale', label: 'Спокойный вдох', hint: 'Плавно вдыхайте через нос' },
    { cls: 'hold', label: 'Задержка', hint: 'Отпустите напряжение в плечах' },
    { cls: 'exhale', label: 'Мягкий выдох', hint: 'Медленно выдыхайте всю усталость' },
  ];

  const step = () => {
    const cycleSec = _breathTick % 12;
    const phaseIdx = Math.floor(cycleSec / 4);
    const secLeft = 4 - (cycleSec % 4);
    const p = phases[phaseIdx];
    ring.className = `breath-ring ${p.cls}`;
    if (counter) counter.textContent = `${secLeft}с`;
    if (title) title.textContent = p.label;
    if (sub) sub.textContent = p.hint;
    if (cycleSec % 4 === 0) haptic('light');
    _breathTick += 1;
    if (_breathTick >= 60) {
      stopBreathing();
      showToast('Отлично — 1 минута перезагрузки завершена 🌿');
    }
  };

  step();
  _breathTimer = setInterval(step, 1000);
}

function renderPsychTabs() {
  const container = document.getElementById('psych-cat-tabs');
  if (!container) return;
  container.innerHTML = '';
  PSYCH_CATEGORIES.forEach((cat) => {
    const btn = document.createElement('button');
    btn.className = `pill-tab ${state.activePsychCat === cat.key ? 'active' : ''}`;
    btn.textContent = cat.name;
    btn.addEventListener('click', () => {
      sound.playTap();
      state.activePsychCat = cat.key;
      renderPsychTabs();
      renderPsychGuides();
    });
    container.appendChild(btn);
  });
}

function renderPsychGuides() {
  const container = document.getElementById('psych-guides-list');
  if (!container) return;
  const list =
    state.activePsychCat === 'all'
      ? PSYCH_GUIDES
      : PSYCH_GUIDES.filter((g) => g.cat === state.activePsychCat);

  container.innerHTML = '';
  list.forEach((guide) => {
    const btn = document.createElement('button');
    btn.className = 'psych-guide-card';
    btn.innerHTML = `
      <div class="psych-guide-top">
        <span class="psych-guide-badge">${escapeHtml(guide.icon)} ${escapeHtml(guide.badge)}</span>
        <svg class="chevron-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><path d="M9 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <div class="psych-guide-title">${escapeHtml(guide.title)}</div>
      <div class="psych-guide-sub">${escapeHtml(guide.subtitle)}</div>
    `;
    btn.addEventListener('click', () => {
      sound.playTap();
      haptic('light');
      openPsychGuideModal(guide);
    });
    container.appendChild(btn);
  });
}

function openPsychGuideModal(guide) {
  const body = document.getElementById('modal-body');
  const cards = (guide.relatedCards || [])
    .map((id) => ALL_CARDS.find((c) => c.id === id))
    .filter(Boolean);
  const spread = SPREADS.find((s) => s.key === guide.recommendedSpread);

  body.innerHTML = `
    <div style="margin-bottom:10px;">
      <span class="psych-guide-badge">${escapeHtml(guide.icon)} ${escapeHtml(guide.badge)}</span>
    </div>
    <h2 style="margin:0 0 8px;font-family:var(--font-display);font-size:27px;line-height:1.15;">${escapeHtml(guide.title)}</h2>
    <p style="margin:0 0 12px;font-size:13.5px;line-height:1.55;color:var(--text-muted);">${escapeHtml(guide.summary)}</p>

    <div class="field-label">Что сделать на практике</div>
    <div class="psych-step-list">
      ${guide.steps
        .map(
          (st, i) => `
        <div class="psych-step-item">
          <span class="psych-step-num">${i + 1}</span>
          <span>${escapeHtml(st)}</span>
        </div>`
        )
        .join('')}
    </div>

    ${
      cards.length
        ? `
      <div class="field-label">Ключевые арканы по теме (нажмите для разбора)</div>
      <div class="psych-card-chips" id="psych-modal-cards">
        ${cards
          .map(
            (c) => `<button class="psych-card-chip" data-card-id="${escapeHtml(c.id)}">${escapeHtml(c.emoji)} ${escapeHtml(c.name)}</button>`
          )
          .join('')}
      </div>`
        : ''
    }

    ${
      spread
        ? `<button class="btn-fusion-primary" id="btn-psych-launch-spread" style="width:100%;margin-top:4px;">${escapeHtml(guide.spreadBtnLabel || `Расклад «${spread.name}»`)}</button>`
        : ''
    }
    <button class="btn-glass-secondary" id="btn-share-psych" style="width:100%;margin-top:8px;">Поделиться практикой 💌</button>
  `;

  document.getElementById('btn-share-psych')?.addEventListener('click', () => {
    const txt =
      `${guide.icon} ${guide.title}\n` +
      `${guide.summary}\n\n` +
      guide.steps.map((s, idx) => `${idx + 1}. ${s}`).join('\n');
    shareContentWithPromo(
      txt,
      '🌿 Больше практик, карта дня и Таро бесплатно — гадания тут 👇\n🔮 KLIM TAROT · @MysticalTarotKlimBot'
    );
  });

  body.querySelectorAll('[data-card-id]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const card = ALL_CARDS.find((c) => c.id === chip.dataset.cardId);
      if (card) {
        sound.playTap();
        openCardModal(card, false);
      }
    });
  });

  const spreadBtn = document.getElementById('btn-psych-launch-spread');
  if (spreadBtn && spread) {
    spreadBtn.addEventListener('click', () => {
      document.getElementById('card-modal').classList.add('hidden');
      startDrawSession(spread);
    });
  }

  document.getElementById('card-modal').classList.remove('hidden');
}

/* ── ZODIAC COMPATIBILITY ────────────────────────────────────── */

function renderZodiacPickers() {
  const renderGrid = (containerId, selectedId, onSelect) => {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '';
    ZODIAC_SIGNS.forEach((sign) => {
      const btn = document.createElement('button');
      btn.className = `zodiac-pill ${selectedId === sign.id ? 'selected' : ''}`;
      btn.innerHTML = `
        <span class="zodiac-sym">${sign.symbol}</span>
        <span class="zodiac-name">${escapeHtml(sign.name)}</span>
        <span class="zodiac-dates">${escapeHtml(sign.dates)}</span>
      `;
      btn.addEventListener('click', () => {
        sound.playTap();
        haptic('light');
        onSelect(sign.id);
      });
      el.appendChild(btn);
    });
  };

  const signA = ZODIAC_SIGNS.find((s) => s.id === state.compatSignA) || ZODIAC_SIGNS[0];
  const signB = ZODIAC_SIGNS.find((s) => s.id === state.compatSignB) || ZODIAC_SIGNS[4];
  const lblA = document.getElementById('compat-label-a');
  const lblB = document.getElementById('compat-label-b');
  if (lblA) lblA.textContent = `${signA.symbol} ${signA.name}`;
  if (lblB) lblB.textContent = `${signB.symbol} ${signB.name}`;

  renderGrid('zodiac-grid-a', state.compatSignA, (id) => {
    state.compatSignA = id;
    renderZodiacPickers();
  });
  renderGrid('zodiac-grid-b', state.compatSignB, (id) => {
    state.compatSignB = id;
    renderZodiacPickers();
  });
}

function runCompatibilityCheck() {
  const signA = ZODIAC_SIGNS.find((s) => s.id === state.compatSignA) || ZODIAC_SIGNS[0];
  const signB = ZODIAC_SIGNS.find((s) => s.id === state.compatSignB) || ZODIAC_SIGNS[4];
  const res = calculateCompatibility(signA, signB);
  const elA = ELEMENT_LABELS[signA.el];
  const elB = ELEMENT_LABELS[signB.el];
  const talisman = ALL_CARDS.find((c) => c.id === res.talismanId) || ALL_CARDS[0];
  preloadCardImage(talisman);

  sound.playCardFlip(true, false);
  haptic(res.total >= 80 ? 'success' : 'medium');

  const r = 34;
  const circ = 2 * Math.PI * r;
  const targetOffset = circ * (1 - res.total / 100);

  const cardEl = document.getElementById('compat-result-card');
  if (!cardEl) return;

  cardEl.innerHTML = `
    <div class="compat-hero-row">
      <div class="compat-pair-info">
        <div class="compat-pair-title">${signA.symbol} ${escapeHtml(signA.name)} × ${signB.symbol} ${escapeHtml(signB.name)}</div>
        <div class="compat-pair-sub">${elA.icon} ${elA.name} + ${elB.icon} ${elB.name} · ${escapeHtml(res.tag)}</div>
        <div class="compat-verdict">${escapeHtml(res.verdict)}</div>
      </div>
      <div class="compat-gauge">
        <svg viewBox="0 0 82 82">
          <defs>
            <linearGradient id="compatGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#f43f5e"/>
              <stop offset="50%" stop-color="#e879f9"/>
              <stop offset="100%" stop-color="#f5c969"/>
            </linearGradient>
          </defs>
          <circle class="compat-gauge-bg" cx="41" cy="41" r="${r}"/>
          <circle class="compat-gauge-fill" id="compat-gauge-arc" cx="41" cy="41" r="${r}"
            stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${circ.toFixed(1)}"/>
        </svg>
        <div class="compat-gauge-val">${res.total}%</div>
      </div>
    </div>

    <div class="compat-bars">
      ${[
        { label: '❤️ Любовь и чувства', val: res.love },
        { label: '💬 Общение и доверие', val: res.comm },
        { label: '🏠 Быт и стабильность', val: res.home },
        { label: '🔥 Страсть и химия', val: res.passion },
      ]
        .map(
          (b) => `
        <div class="compat-bar-row">
          <div class="compat-bar-head"><span>${b.label}</span><span>${b.val}%</span></div>
          <div class="compat-bar-track"><div class="compat-bar-fill" style="width:${b.val}%"></div></div>
        </div>`
        )
        .join('')}
    </div>

    <div class="compat-text-block">
      <strong>✦ Сильные стороны союза</strong>
      ${escapeHtml(res.strength)}
    </div>
    <div class="compat-text-block">
      <strong>🌌 Астрологический аспект</strong>
      ${escapeHtml(res.aspectNote)}
    </div>
    <div class="compat-text-block">
      <strong>🧭 Совет психолога и Таро</strong>
      ${escapeHtml(res.watchout)} ${escapeHtml(res.advice)}
    </div>

    <button class="compat-talisman" id="btn-compat-talisman">
      <img src="${escapeHtml(talisman.img)}" alt="${escapeHtml(talisman.name)}" />
      <div>
        <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--gold-soft);">Карта-талисман пары</div>
        <div style="font-size:16px;font-weight:700;color:#fff;margin-top:2px;">${escapeHtml(talisman.emoji)} ${escapeHtml(talisman.name)}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">Нажмите, чтобы открыть 3D-разбор аркана</div>
      </div>
    </button>

    <div class="compat-actions">
      <button class="btn-glass-secondary" id="btn-share-compat">Поделиться 💌</button>
      <button class="btn-glass-secondary" id="btn-compat-love-spread">Расклад 💞</button>
    </div>
  `;

  cardEl.classList.remove('hidden');
  requestAnimationFrame(() => {
    const arc = document.getElementById('compat-gauge-arc');
    if (arc) arc.style.strokeDashoffset = targetOffset.toFixed(1);
  });

  document.getElementById('btn-compat-talisman')?.addEventListener('click', () => {
    sound.playTap();
    openCardModal(talisman, false);
  });

  document.getElementById('btn-compat-love-spread')?.addEventListener('click', () => {
    const loveSpread = SPREADS.find((s) => s.key === 'love_simple');
    if (loveSpread) startDrawSession(loveSpread);
  });

  document.getElementById('btn-share-compat')?.addEventListener('click', () => {
    const shareText =
      `✨ Совместимость ${signA.symbol} ${signA.name} + ${signB.symbol} ${signB.name} — ${res.total}%!\n` +
      `${res.verdict}\n` +
      `❤️ Любовь: ${res.love}% · 💬 Доверие: ${res.comm}% · 🏠 Быт: ${res.home}% · 🔥 Страсть: ${res.passion}%\n` +
      `🃏 Талисман пары: ${talisman.name}`;
    shareContentWithPromo(
      shareText,
      '💘 А сколько % у вас? Проверь свою пару и карту дня бесплатно — гадания тут 👇\n🔮 KLIM TAROT · @MysticalTarotKlimBot'
    );
  });

  cardEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Ensure background looping videos & ambient playlist start immediately on entry
function unlockMediaOnEntry() {
  document.querySelectorAll('video').forEach((v) => {
    v.muted = true;
    v.play().catch(() => {});
  });
  sound.startAmbience();
}
unlockMediaOnEntry();
window.addEventListener('pointerdown', unlockMediaOnEntry, { once: true });
window.addEventListener('touchstart', unlockMediaOnEntry, { once: true });

// Ставим музыку на паузу, если пользователь свернул Telegram
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (sound.bgm && !sound.bgm.paused) sound.bgm.pause();
  } else if (sound.enabled && sound.bgm) {
    sound.bgm.play().catch(() => {});
  }
});

// Boot
initCosmosCanvas();

// Seamless video loops for all background videos
requestAnimationFrame(() => {
  setTimeout(() => {
    const heroVid = document.querySelector('.hero-bg-video');
    if (heroVid) initSeamlessLoop(heroVid);
    const mainVid = document.getElementById('main-bg-video');
    if (mainVid) initSeamlessLoop(mainVid);
    const spreadsVid = document.querySelector('.spreads-bg-video');
    if (spreadsVid) initSeamlessLoop(spreadsVid);
  }, 800);
});

updateSoundIcon();
refreshHomeBanner();
setInterval(refreshHomeBanner, 1000);
updateHistoryCounter();
renderFeaturedSpreads();
renderSpreadTabs();
renderSpreadsList();
renderFriendSpreads();
renderPsychTabs();
renderPsychGuides();
renderZodiacPickers();
renderDictTabs();
renderDictGrid();
bindEvents();
randomizeHeroSubtitle();

// 🖱️ Надёжная прокрутка колёсиком мыши на компьютерах в Telegram Desktop
window.addEventListener('wheel', (e) => {
  if (e.defaultPrevented) return;
  const openModal = document.querySelector('.modal-backdrop:not(.hidden) .modal-sheet');
  if (openModal) {
    openModal.scrollTop += e.deltaY;
    return;
  }
  window.scrollBy({ top: e.deltaY, behavior: 'auto' });
}, { passive: true });
updateProModeUI();

// 🎁 Проверка и показ приветственного подарка: 3 дня PRO
function checkAndShowWelcomeGift() {
  const giftModal = document.getElementById('gift-modal');
  if (!giftModal) return;

  const alreadyClaimed = localStorage.getItem('klim_tarot_gift_claimed');
  const params = new URLSearchParams(window.location.search);
  const isTrialUrl = params.get('trial') === '1';

  if (!alreadyClaimed || isTrialUrl) {
    try {
      localStorage.setItem('klim_tarot_pro_granted', 'true');
      localStorage.setItem('klim_tarot_pro_mode', 'true');
      state.isProMode = true;
      updateProModeUI();
    } catch (e) {}

    setTimeout(() => {
      giftModal.classList.remove('hidden');
      sound.playShuffle();
      haptic('success');
    }, 450);
  }

  const closeBtn = document.getElementById('btn-close-gift-modal');
  const claimBtn = document.getElementById('btn-gift-claim');
  const inviteBtn = document.getElementById('btn-gift-invite');

  const closeGift = () => {
    giftModal.classList.add('hidden');
    localStorage.setItem('klim_tarot_gift_claimed', 'true');
    haptic('medium');
  };

  closeBtn?.addEventListener('click', closeGift);
  giftModal.addEventListener('click', (e) => {
    if (e.target === giftModal) closeGift();
  });

  claimBtn?.addEventListener('click', () => {
    closeGift();
    sound.playShuffle();
    haptic('success');
    showToast('🎉 3 дня PRO активированы! Приятных раскладов!');
  });

  inviteBtn?.addEventListener('click', () => {
    sound.playTap();
    haptic('medium');
    const uid = getTelegramUserId() || '';
    const refParam = uid ? `start=ref_${uid}` : 'start=ref';
    const refLink = `https://t.me/MysticalTarotKlimBot?${refParam}`;
    const shareText = '✨ Дарю тебе 3 дня бесплатного PRO-доступа в KLIM TAROT! 78 карт, Карта дня и расклады тут 👇';
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent(shareText)}`;
    if (tg?.openTelegramLink) {
      tg.openTelegramLink(shareUrl);
    } else {
      window.open(shareUrl, '_blank');
    }
  });
}
checkAndShowWelcomeGift();

// Preload today's card immediately if already drawn
const _savedDaily = getDailyCard();
if (_savedDaily?.card) preloadCardImage(_savedDaily.card);

/* ══════════════════════════════════════════════════════════════
   🎡 КОЛЕСО ФОРТУНЫ & ОСКОЛКИ СУДЬБЫ (X АРКАН)
   ══════════════════════════════════════════════════════════════ */
const WHEEL_SECTORS = [
  { label: '+1 Осколок', icon: '🔮', type: 'shard', val: 1, bg1: '#2e1065', bg2: '#581c87', border: '#c084fc', text: '#f3e8ff' },
  { label: 'Скидка 25%', icon: '🏷️', type: 'discount_25', code: 'FORTUNA25', bg1: '#831843', bg2: '#be185d', border: '#f472b6', text: '#fff1f2' },
  { label: 'Дно колоды', icon: '🌑', type: 'feature_shadow', bg1: '#1e1b4b', bg2: '#3730a3', border: '#818cf8', text: '#e0e7ff' },
  { label: '+2 Осколка', icon: '✨', type: 'shard', val: 2, bg1: '#3b0764', bg2: '#6b21a8', border: '#d8b4fe', text: '#faf5ff' },
  { label: 'Талисман Удачи', icon: '🍀', type: 'talisman', bg1: '#064e3b', bg2: '#047857', border: '#34d399', text: '#ecfdf5' },
  { label: '4 Стихии', icon: '🌊', type: 'feature_elements', bg1: '#164e63', bg2: '#0e7490', border: '#22d3ee', text: '#ecfeff' },
  { label: '+1 Осколок', icon: '🔮', type: 'shard', val: 1, bg1: '#4a044e', bg2: '#86198f', border: '#e879f9', text: '#fdf4ff' },
  { label: 'Мудрость Таро', icon: '🌟', type: 'wisdom', bg1: '#713f12', bg2: '#b45309', border: '#fde047', text: '#fefce8' },
];

let wheelState = {
  currentAngle: 0,
  isSpinning: false,
};

function getShardsCount() {
  return parseInt(localStorage.getItem('klim_tarot_shards') || '0', 10);
}

function setShardsCount(cnt) {
  localStorage.setItem('klim_tarot_shards', String(Math.max(0, cnt)));
  renderShardsUI();
}

function renderShardsUI() {
  const cnt = getShardsCount();
  const numEl = document.getElementById('shards-num');
  if (numEl) numEl.textContent = cnt;

  const slots = document.querySelectorAll('#shards-slots .shard-slot');
  slots.forEach((slot, idx) => {
    slot.classList.toggle('filled', idx < cnt);
  });

  const forgeBtn = document.getElementById('btn-forge-shards');
  if (forgeBtn) {
    if (cnt >= 5) {
      forgeBtn.classList.remove('disabled');
      forgeBtn.textContent = '✨ Собрать 5 осколков (+2 дня PRO)!';
    } else {
      forgeBtn.classList.add('disabled');
      forgeBtn.textContent = `✨ Собрать 5 осколков (нужно ещё ${5 - cnt})`;
    }
  }
}

function drawWheel(angle = 0) {
  const canvas = document.getElementById('wheel-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const center = size / 2;
  const radius = center - 8;
  const numSectors = WHEEL_SECTORS.length;
  const arc = (2 * Math.PI) / numSectors;

  ctx.clearRect(0, 0, size, size);

  // Outer Gold Rim with Engravings
  ctx.save();
  ctx.translate(center, center);

  // Outer metallic ring
  const outerGrad = ctx.createLinearGradient(-radius, -radius, radius, radius);
  outerGrad.addColorStop(0, '#fde047');
  outerGrad.addColorStop(0.3, '#d97706');
  outerGrad.addColorStop(0.5, '#fef08a');
  outerGrad.addColorStop(0.7, '#b45309');
  outerGrad.addColorStop(1, '#eab308');

  ctx.beginPath();
  ctx.arc(0, 0, radius + 4, 0, 2 * Math.PI);
  ctx.fillStyle = '#0f0b18';
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = outerGrad;
  ctx.stroke();

  // Rotate sectors
  ctx.rotate(angle);

  for (let i = 0; i < numSectors; i++) {
    const sec = WHEEL_SECTORS[i];
    const startAngle = i * arc;
    const endAngle = startAngle + arc;

    // Sector arc with radial gradient
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius - 3, startAngle, endAngle);
    ctx.closePath();

    const secGrad = ctx.createRadialGradient(0, 0, 20, 0, 0, radius);
    secGrad.addColorStop(0, sec.bg1);
    secGrad.addColorStop(1, sec.bg2);
    ctx.fillStyle = secGrad;
    ctx.fill();

    // Sector divider with gold trim
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(253, 224, 71, 0.45)';
    ctx.stroke();

    // Arcana X Occult runes/letters on rim (T - A - R - O / R - O - T - A)
    const midAngle = startAngle + arc / 2;
    const occultGlyphs = ['T', 'א', 'A', 'מ', 'R', 'ש', 'O', 'ה'];
    ctx.save();
    ctx.rotate(midAngle);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fde047';
    ctx.font = 'bold 11px Cinzel, serif';
    ctx.shadowColor = 'rgba(253, 224, 71, 0.6)';
    ctx.shadowBlur = 4;
    ctx.fillText(occultGlyphs[i % occultGlyphs.length], radius - 8, 4);

    // Text & icon
    ctx.shadowBlur = 0;
    ctx.fillStyle = sec.text;
    ctx.font = 'bold 11.5px sans-serif';
    ctx.fillText(`${sec.icon} ${sec.label}`, radius - 26, 4.5);
    ctx.restore();
  }

  // Inner decorative gold ring
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.38, 0, 2 * Math.PI);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = outerGrad;
  ctx.stroke();

  ctx.restore();

  // Central Mystical Pentagram Hub
  ctx.save();
  ctx.translate(center, center);

  const hubGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, 28);
  hubGrad.addColorStop(0, '#fef08a');
  hubGrad.addColorStop(0.4, '#d97706');
  hubGrad.addColorStop(0.8, '#78350f');
  hubGrad.addColorStop(1, '#1c1917');

  ctx.beginPath();
  ctx.arc(0, 0, 26, 0, 2 * Math.PI);
  ctx.fillStyle = hubGrad;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#fde047';
  ctx.shadowColor = 'rgba(253, 224, 71, 0.8)';
  ctx.shadowBlur = 8;
  ctx.stroke();

  // Hub Occult Seal (Eye / Star of Fortune)
  ctx.shadowBlur = 0;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.font = '16px sans-serif';
  ctx.fillText('☸️', 0, 0);

  ctx.restore();
}

function checkWheelCooldown() {
  const lastSpin = parseInt(localStorage.getItem('klim_tarot_wheel_last') || '0', 10);
  const now = Date.now();
  const cooldown = 24 * 3600 * 1000;
  const diff = cooldown - (now - lastSpin);

  const spinBtn = document.getElementById('btn-spin-wheel');
  const cdWrap = document.getElementById('wheel-cooldown-wrap');
  const cdTimer = document.getElementById('wheel-cooldown-timer');

  if (diff > 0) {
    if (spinBtn) spinBtn.classList.add('disabled');
    if (cdWrap) cdWrap.classList.remove('hidden');
    const hrs = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    if (cdTimer) {
      cdTimer.textContent = `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return false;
  } else {
    if (spinBtn) spinBtn.classList.remove('disabled');
    if (cdWrap) cdWrap.classList.add('hidden');
    return true;
  }
}

function spinWheel() {
  if (wheelState.isSpinning || !checkWheelCooldown()) return;
  wheelState.isSpinning = true;

  const spinBtn = document.getElementById('btn-spin-wheel');
  if (spinBtn) spinBtn.classList.add('disabled');

  sound.playShuffle();
  haptic('medium');

  const winningIndex = Math.floor(Math.random() * WHEEL_SECTORS.length);
  const numSectors = WHEEL_SECTORS.length;
  const arc = (2 * Math.PI) / numSectors;

  const totalRounds = 6 + Math.floor(Math.random() * 3);
  const targetAngle = wheelState.currentAngle + totalRounds * 2 * Math.PI + (numSectors - winningIndex) * arc - (arc / 2) - (Math.PI / 2);

  const duration = 4600;
  const startAngle = wheelState.currentAngle;
  const startTime = performance.now();

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function frame(now) {
    const elapsed = now - startTime;
    const progress = Math.min(1, elapsed / duration);
    const eased = easeOutCubic(progress);

    wheelState.currentAngle = startAngle + (targetAngle - startAngle) * eased;
    drawWheel(wheelState.currentAngle);

    if (progress < 1) {
      requestAnimationFrame(frame);
    } else {
      wheelState.isSpinning = false;
      localStorage.setItem('klim_tarot_wheel_last', String(Date.now()));
      checkWheelCooldown();
      applyWheelReward(WHEEL_SECTORS[winningIndex]);
    }
  }

  requestAnimationFrame(frame);
}

function applyWheelReward(prize) {
  sound.playCardPick(0);
  haptic('success');

  if (prize.type === 'shard') {
    const cur = getShardsCount();
    setShardsCount(cur + prize.val);
    showToast(`🔮 Вы выиграли: ${prize.label}! (Собрано: ${cur + prize.val}/5)`);
  } else if (prize.type === 'discount_25') {
    showToast(`🏷️ Вы выиграли Скидку 25%! Промокод: ${prize.code} сохранён в разделе Тарифы`);
    localStorage.setItem('klim_tarot_promo_discount', '25');
  } else if (prize.type === 'talisman') {
    showToast('🍀 Вы выиграли Талисман Удачи! Судьба благоволит вашим начинаниям');
  } else if (prize.type === 'wisdom') {
    showToast('🌟 Вы выиграли Мудрость Старших Арканов! Совет Высших сил открыт');
  } else if (prize.type === 'feature_shadow') {
    showToast('🌑 Вы выиграли Теневую карту колоды (Дно колоды)!');
  } else if (prize.type === 'feature_elements') {
    showToast('🌊 Вы выиграли Баланс 4 стихий и Квинтэссенцию раскладов!');
  }
}

function initFortuneWheel() {
  renderShardsUI();
  drawWheel(0);
  checkWheelCooldown();
  setInterval(checkWheelCooldown, 1000);

  document.getElementById('btn-spin-wheel')?.addEventListener('click', spinWheel);

  document.getElementById('btn-forge-shards')?.addEventListener('click', () => {
    const cnt = getShardsCount();
    if (cnt >= 5) {
      setShardsCount(cnt - 5);
      localStorage.setItem('klim_tarot_pro_granted', 'true');
      localStorage.setItem('klim_tarot_pro_mode', 'true');
      state.isProMode = true;
      updateProModeUI();
      sound.playShuffle();
      haptic('success');
      showToast('🎉 Осколки объединены! Вам начислено +2 дня режима PRO!');
    }
  });
}

/* ══════════════════════════════════════════════════════════════
   💌 ПРИГЛАШЕНИЕ ДРУЗЕЙ & ЛИДЕРБОРД
   ══════════════════════════════════════════════════════════════ */
const MOCK_LEADERBOARD = [
  { name: 'Klim (Владелец)', user: '@im_klim', count: 18, days: '+36 дн.', badge: '👑 Чемпион' },
  { name: 'Алина Таро', user: '@alina_tarot', count: 11, days: '+22 дн.', badge: '🌟 Мастер' },
  { name: 'Михаил С.', user: '@misha_sky', count: 8, days: '+16 дн.', badge: '✨ Искатель' },
  { name: 'София В.', user: '@sofia_v', count: 5, days: '+10 дн.', badge: '🔮 Практик' },
  { name: 'Даниил', user: '@danya_k', count: 4, days: '+8 дн.', badge: '🌿 Новичок' },
];

function initInviteAndLeaderboard() {
  const uid = getTelegramUserId() || '';
  const refLink = `https://t.me/MysticalTarotKlimBot?start=ref_${uid || 'vip'}`;

  const inputEl = document.getElementById('input-referral-link');
  if (inputEl) inputEl.value = refLink;

  const copyBtn = document.getElementById('btn-copy-link');
  copyBtn?.addEventListener('click', () => {
    sound.playTap();
    haptic('light');
    if (navigator.clipboard) {
      navigator.clipboard.writeText(refLink).then(() => {
        showToast('📋 Ссылка амбассадора скопирована!');
      });
    } else {
      inputEl?.select();
      document.execCommand('copy');
      showToast('📋 Ссылка скопирована!');
    }
  });

  const shareBtn = document.getElementById('btn-share-telegram');
  shareBtn?.addEventListener('click', () => {
    sound.playTap();
    haptic('medium');
    const shareText = '✨ Дарю тебе 3 дня бесплатного PRO-доступа в KLIM TAROT! 78 карт, Карта дня и расклады тут 👇';
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent(shareText)}`;
    if (tg?.openTelegramLink) {
      tg.openTelegramLink(shareUrl);
    } else {
      window.open(shareUrl, '_blank');
    }
  });

  renderLeaderboard();
}

function renderLeaderboard() {
  const container = document.getElementById('leaderboard-list');
  if (!container) return;

  const medals = ['🥇', '🥈', '🥉', '4', '5'];
  container.innerHTML = MOCK_LEADERBOARD.map((item, idx) => `
    <div class="leaderboard-item rank-${idx + 1}">
      <div class="leaderboard-left">
        <span class="leaderboard-rank-badge">${medals[idx] || (idx + 1)}</span>
        <div class="leaderboard-info">
          <strong>${item.name}</strong>
          <span>${item.user} · ${item.badge}</span>
        </div>
      </div>
      <div class="leaderboard-right">
        <div class="leaderboard-invited">${item.count} друзей</div>
        <div class="leaderboard-days">${item.days} PRO</div>
      </div>
    </div>
  `).join('');
}

initFortuneWheel();
initInviteAndLeaderboard();
