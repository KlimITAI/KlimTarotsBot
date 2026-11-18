// Модуль совместимости по знакам зодиака (12 знаков × 12 знаков = 144 пары)

export const ZODIAC_SIGNS = [
  { id: 'aries',       idx: 0,  symbol: '♈', name: 'Овен',      dates: '21.03–19.04', el: 'fire',  mod: 'cardinal', ruler: 'Марс',   card: 'emperor' },
  { id: 'taurus',      idx: 1,  symbol: '♉', name: 'Телец',     dates: '20.04–20.05', el: 'earth', mod: 'fixed',    ruler: 'Венера', card: 'hierophant' },
  { id: 'gemini',      idx: 2,  symbol: '♊', name: 'Близнецы',  dates: '21.05–20.06', el: 'air',   mod: 'mutable',  ruler: 'Меркурий', card: 'lovers' },
  { id: 'cancer',      idx: 3,  symbol: '♋', name: 'Рак',       dates: '21.06–22.07', el: 'water', mod: 'cardinal', ruler: 'Луна',   card: 'chariot' },
  { id: 'leo',         idx: 4,  symbol: '♌', name: 'Лев',       dates: '23.07–22.08', el: 'fire',  mod: 'fixed',    ruler: 'Солнце', card: 'strength' },
  { id: 'virgo',       idx: 5,  symbol: '♍', name: 'Дева',      dates: '23.08–22.09', el: 'earth', mod: 'mutable',  ruler: 'Меркурий', card: 'hermit' },
  { id: 'libra',       idx: 6,  symbol: '♎', name: 'Весы',      dates: '23.09–22.10', el: 'air',   mod: 'cardinal', ruler: 'Венера', card: 'justice' },
  { id: 'scorpio',     idx: 7,  symbol: '♏', name: 'Скорпион',  dates: '23.10–21.11', el: 'water', mod: 'fixed',    ruler: 'Плутон', card: 'death' },
  { id: 'sagittarius', idx: 8,  symbol: '♐', name: 'Стрелец',   dates: '22.11–21.12', el: 'fire',  mod: 'mutable',  ruler: 'Юпитер', card: 'temperance' },
  { id: 'capricorn',   idx: 9,  symbol: '♑', name: 'Козерог',   dates: '22.12–19.01', el: 'earth', mod: 'cardinal', ruler: 'Сатурн', card: 'devil' },
  { id: 'aquarius',    idx: 10, symbol: '♒', name: 'Водолей',   dates: '20.01–18.02', el: 'air',   mod: 'fixed',    ruler: 'Уран',   card: 'star' },
  { id: 'pisces',      idx: 11, symbol: '♓', name: 'Рыбы',      dates: '19.02–20.03', el: 'water', mod: 'mutable',  ruler: 'Нептун', card: 'moon' },
];

export const ELEMENT_LABELS = {
  fire:  { icon: '🔥', name: 'Огонь' },
  earth: { icon: '🌍', name: 'Земля' },
  air:   { icon: '💨', name: 'Воздух' },
  water: { icon: '💧', name: 'Вода' },
};

const ELEMENT_SYNERGY = {
  'fire-fire': {
    tag: 'Яркая искра и драйв',
    base: 86, love: 88, comm: 82, home: 74, passion: 95,
    strength: 'Между вами мгновенно вспыхивает азарт и живая энергия. Вместе вы заряжаете друг друга смелостью, не даёте скучать и быстро двигаетесь к целям.',
    watchout: 'Оба характера любят лидировать. В споре важно не переходить на повышенные тона — договоритесь, кто за какую зону отвечает.',
    advice: 'Направляйте общий напор на совместные дела, поездки и цели, а не на борьбу за последнее слово.',
    talisman: 'sun',
  },
  'earth-earth': {
    tag: 'Надёжный тыл и опора',
    base: 90, love: 86, comm: 84, home: 96, passion: 80,
    strength: 'Один из самых крепких союзов: верность, уважение к труду, общие ценности и умение строить уютную, обеспеченную жизнь без лишней драмы.',
    watchout: 'Со временем быт и привычки могут вытеснить романтику, а упрямство с обеих сторон — затягивать мелкие обиды.',
    advice: 'Регулярно добавляйте маленькие сюрпризы и совместный отдых вне домашних дел — тогда союз будет только крепнуть.',
    talisman: 'empress',
  },
  'air-air': {
    tag: 'Лёгкость и понимание с полуслова',
    base: 87, love: 84, comm: 96, home: 76, passion: 82,
    strength: 'Вам всегда есть о чём поговорить: живой ум, чувство юмора, взаимное уважение личного пространства и лёгкость в общении.',
    watchout: 'Иногда чувства уходят в разговоры и анализ, а бытовые решения откладываются «на потом».',
    advice: 'Чаще переходите от слов к тёплым поступкам и прямо проговаривайте, когда вам нужна эмоциональная поддержка.',
    talisman: 'lovers',
  },
  'water-water': {
    tag: 'Глубина чувств и родство душ',
    base: 91, love: 95, comm: 86, home: 88, passion: 89,
    strength: 'Тонкое чутьё друг на друга: вы угадываете настроение партнёра без слов, умеете по-настоящему заботиться и создавать тёплый, защищённый мир.',
    watchout: 'Оба партнёра ранимы: недосказанность и молчаливые обиды способны быстро испортить атмосферу.',
    advice: 'Не ждите, пока партнёр догадается сам — мягко и открыто говорите о своих переживаниях сразу.',
    talisman: 'cups_2',
  },
  'fire-air': {
    tag: 'Ветер раздувает пламя',
    base: 91, love: 90, comm: 92, home: 79, passion: 93,
    strength: 'Воздух вдохновляет Огонь, а Огонь даёт Воздуху решительность. Это живой, яркий союз, полный идей, юмора и взаимного восхищения.',
    watchout: 'Оба знака не любят рутину и могут разбрасываться силами, забывая про спокойный отдых и порядок в мелочах.',
    advice: 'Выбирайте одну главную общую цель на месяц и доводите её до результата — вместе вы способны на многое.',
    talisman: 'star',
  },
  'earth-water': {
    tag: 'Плодородная гармония',
    base: 92, love: 91, comm: 85, home: 95, passion: 86,
    strength: 'Классическая пара для долгой и счастливой жизни: Вода дарит нежность и душевность, а Земля — защиту, стабильность и уверенность в завтрашнем дне.',
    watchout: 'Земле бывает трудно сразу понять эмоциональные волны Воды, а Воде иногда не хватает громких слов любви.',
    advice: 'Земле полезно чаще говорить тёплые слова вслух, а Воде — ценить молчаливую заботу и дела партнёра.',
    talisman: 'world',
  },
  'fire-earth': {
    tag: 'Страсть и здравый смысл',
    base: 72, love: 74, comm: 69, home: 80, passion: 79,
    strength: 'Сильный союз дополнения: Огонь задаёт масштаб и вдохновляет на рост, а Земля превращает смелые планы в реальные деньги и результат.',
    watchout: 'Разный темп жизни — Огню нужно всё и сразу, а Земля предпочитает семь раз отмерить. Отсюда возникают взаимные упрёки.',
    advice: 'Уважайте ритм друг друга: Огонь пусть даёт время на обдумывание, а Земля — поддерживает смелые начинания партнёра.',
    talisman: 'wheel',
  },
  'air-water': {
    tag: 'Логика и интуиция',
    base: 71, love: 75, comm: 73, home: 70, passion: 76,
    strength: 'Вы учите друг друга видеть мир шире: Воздух помогает спокойно разобрать любую тревогу, а Вода наполняет отношения глубиной и теплом.',
    watchout: 'Воздух решает вопросы головой, а Вода — сердцем. В сложных моментах Воде может казаться, что партнёр слишком холоден.',
    advice: 'Перед тем как предлагать логичный совет, сначала просто обнимите партнёра и признайте его чувства.',
    talisman: 'temperance',
  },
  'fire-water': {
    tag: 'Пар, страсть и сильные эмоции',
    base: 69, love: 76, comm: 65, home: 66, passion: 90,
    strength: 'Магнетическое притяжение противоположностей: рядом друг с другом вы испытываете глубокие, настоящие эмоции и заметно растете внутренне.',
    watchout: 'Резкое слово Огня легко ранит чувствительную Воду, а обидчивость Воды может гасить энтузиазм Огня.',
    advice: 'Берегите слова в момент злости и делайте короткую паузу перед важным разговором — тогда страсть станет вашей силой.',
    talisman: 'strength',
  },
  'earth-air': {
    tag: 'Практичность и свежий взгляд',
    base: 70, love: 69, comm: 76, home: 75, passion: 68,
    strength: 'Земля даёт фундамент и конкретику, Воздух приносит новые связи, идеи и лёгкость. Вместе вы способны создать умный, зрелый союз.',
    watchout: 'Земля ценит предсказуемость и чёткие договорённости, а Воздух любит перемены и спонтанность.',
    advice: 'Фиксируйте важные договорённости просто и заранее, оставляя место для спонтанных выходных и общения.',
    talisman: 'magician',
  },
};

function clamp(v, min = 54, max = 98) {
  return Math.max(min, Math.min(max, Math.round(v)));
}

export function calculateCompatibility(signA, signB) {
  const pairKey = [signA.el, signB.el].sort().join('-');
  const syn = ELEMENT_SYNERGY[pairKey] || ELEMENT_SYNERGY['fire-air'];

  // Точное астрологическое расстояние по кругу зодиака (0..6 знаков)
  const rawDist = Math.abs(signA.idx - signB.idx);
  const dist = Math.min(rawDist, 12 - rawDist);

  let aspectBonus = 0;
  let aspectNote = '';
  if (dist === 0) {
    aspectBonus = 2;
    aspectNote = `Соединение (${signA.name} + ${signB.name}): вы смотрите на мир похожими глазами, что даёт быстрое притяжение и понятные желания.`;
  } else if (dist === 4) {
    aspectBonus = 5;
    aspectNote = 'Трин (120°) — самый гармоничный аспект в астрологии: энергия между вами течёт естественно, без лишнего напряжения.';
  } else if (dist === 2) {
    aspectBonus = 4;
    aspectNote = 'Секстиль (60°) — аспект дружбы и лёгкого союза: вы поддерживаете идеи друг друга и быстро находите общий язык.';
  } else if (dist === 6) {
    aspectBonus = 6;
    aspectNote = 'Оппозиция (180°) — сильный магнит противоположностей: вы идеально дополняете слабые стороны друг друга, если учитесь слышать партнёра.';
  } else if (dist === 3) {
    aspectBonus = -4;
    aspectNote = 'Квадрат (90°) — аспект роста и искры: между вами много энергии и страсти, но важно уважать границы и не спорить из принципа.';
  } else if (dist === 5) {
    aspectBonus = -2;
    aspectNote = 'Квинконс (150°) — необычное притяжение: вы очень разные по привычкам, зато вместе открываете то, до чего не дошли бы поодиночке.';
  } else {
    aspectBonus = 1;
    aspectNote = 'Соседние знаки (30°): разный темперамент помогает уравновешивать друг друга в быту и делах.';
  }

  // Детерминированная тонкая поправка для уникальности каждой пары
  const seed = ((signA.idx + 1) * 13 + (signB.idx + 1) * 7) % 7 - 3;

  const love = clamp(syn.love + aspectBonus + (dist === 6 ? 4 : 0) + seed);
  const comm = clamp(syn.comm + aspectBonus - (dist === 3 ? 3 : 0) - seed);
  const home = clamp(syn.home + (signA.el === 'earth' || signB.el === 'earth' ? 3 : 0) + Math.round(aspectBonus / 2));
  const passion = clamp(syn.passion + (dist === 6 || dist === 3 ? 6 : aspectBonus) + Math.round(seed / 2));
  const total = clamp((love * 0.32 + comm * 0.24 + home * 0.22 + passion * 0.22));

  let verdict = 'Крепкий союз с потенциалом';
  if (total >= 90) verdict = 'Идеальное притяжение ✨';
  else if (total >= 82) verdict = 'Очень сильная совместимость 💫';
  else if (total >= 74) verdict = 'Хороший союз при взаимном уважении 🌿';
  else verdict = 'Яркий союз противоположностей ⚡';

  return {
    signA,
    signB,
    total,
    love,
    comm,
    home,
    passion,
    verdict,
    tag: syn.tag,
    aspectNote,
    strength: syn.strength,
    watchout: syn.watchout,
    advice: syn.advice,
    talismanId: syn.talisman,
  };
}
