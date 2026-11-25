"""
Серверный движок Таро KLIM TAROT.
Содержит:
  • Полную колоду (78 карт), 35 раскладов и категории из tarot_catalog.json
  • Вытягивание карт с настройками колоды (all / major / minor) и вероятности перевёрнутых
  • Глубокий синтез расклада (структурированный для API и текстовый для бота)
  • Оракул Да/Нет, расчёт периода День/Ночь (с поддержкой часового пояса клиента)
  • Серверное Колесо Фортуны (X Аркан)
"""

import json
import random
from datetime import datetime, timedelta, timezone

import config

_CATALOG_PATH = config.BASE_DIR / "tarot_catalog.json"
_CATALOG = json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))

ALL_CARDS: list[dict] = _CATALOG["cards"]
CARD_BY_ID: dict[str, dict] = {c["id"]: c for c in ALL_CARDS}
MAJOR_IDS: set[str] = {c["id"] for c in ALL_CARDS if c.get("suit") == "major"}

SPREADS_LIST: list[dict] = _CATALOG["spreads"]
SPREADS: dict[str, dict] = {s["key"]: s for s in SPREADS_LIST}
CATEGORIES: list[dict] = _CATALOG["categories"]
POSITION_LEADS: dict[str, str] = _CATALOG["position_leads"]

WHEEL_SECTORS = [
    {"index": 0, "label": "+1 Осколок", "icon": "🔮", "type": "shard", "val": 1},
    {"index": 1, "label": "Скидка 25%", "icon": "🏷️", "type": "discount_25", "code": "FORTUNA25"},
    {"index": 2, "label": "Дно колоды", "icon": "🌑", "type": "feature_shadow"},
    {"index": 3, "label": "+2 Осколка", "icon": "✨", "type": "shard", "val": 2},
    {"index": 4, "label": "Талисман Удачи", "icon": "🍀", "type": "talisman"},
    {"index": 5, "label": "4 Стихии", "icon": "🌊", "type": "feature_elements"},
    {"index": 6, "label": "+1 Осколок", "icon": "🔮", "type": "shard", "val": 1},
    {"index": 7, "label": "Мудрость Таро", "icon": "🌟", "type": "wisdom"},
]


def get_day_night_period(tz_offset_minutes: int | None = None) -> dict:
    """
    Определяет период День (06:00–21:00) или Ночь (21:00–06:00).
    Если tz_offset_minutes не передан, используется МСК (UTC+3).
    """
    if tz_offset_minutes is None:
        tz = config.MSK_TZ
        tz_suffix = " МСК"
    else:
        clamped = max(-720, min(840, int(tz_offset_minutes)))
        tz = timezone(timedelta(minutes=clamped))
        tz_suffix = ""

    now = datetime.now(tz)
    h, m, s = now.hour, now.minute, now.second
    is_day = 6 <= h < 21

    anchor_date = now.date()
    if h < 6:
        anchor_date = anchor_date - timedelta(days=1)
    period_key = f"{anchor_date.isoformat()}-{'day' if is_day else 'night'}"

    cur_secs = h * 3600 + m * 60 + s
    target_secs = 21 * 3600 if is_day else (30 * 3600 if h >= 21 else 6 * 3600)
    diff_secs = max(1, target_secs - cur_secs)
    rem_h, rem_rem = divmod(diff_secs, 3600)
    rem_m, rem_s = divmod(rem_rem, 60)
    rem_clock = f"{rem_h:02d}:{rem_m:02d}:{rem_s:02d}"
    rem_text = f"{rem_h} ч {rem_m} мин" if rem_h else f"{rem_m} мин"

    return {
        "isDay": is_day,
        "mode": "day" if is_day else "night",
        "periodKey": period_key,
        "dateStr": now.strftime("%d.%m.%Y"),
        "timeStr": f"{now.strftime('%H:%M')}{tz_suffix}",
        "remClock": rem_clock,
        "remShort": f"⏳ {rem_h}ч {rem_m:02d}м" if rem_h else f"⏳ {rem_m}м",
        "nextIcon": "🌙" if is_day else "🌅",
        "nextShortLabel": "Ночная" if is_day else "Дневная",
        "title": "🌅 Карта дня" if is_day else "🌙 Карта этой ночи",
        "badge": "КАРТА ДНЯ" if is_day else "КАРТА ЭТОЙ НОЧИ",
        "position": "Послание этого дня" if is_day else "Послание этой ночи",
        "message_label": "Послание дня" if is_day else "Послание этой ночи",
        "promptDesc": (
            "Дневной аркан (06:00–21:00) — энергия и фокус вашего дня"
            if is_day
            else "Ночной аркан (21:00–06:00) — подсказка интуиции и снов на эту ночь"
        ),
        "already_note": (
            "_Это ваша карта на этот день — она не меняется до 21:00 МСК._"
            if is_day
            else "_Это ваша карта на эту ночь — она не меняется до 06:00 МСК._"
        ),
        "nextNote": (
            f"Карта этой ночи откроется в 21:00 (через {rem_text})"
            if is_day
            else f"Карта дня откроется в 06:00 (через {rem_text})"
        ),
    }


def draw_cards(
    n: int,
    allow_reversed: bool = True,
    deck_mode: str = "all",
    rev_prob: float = 0.33,
) -> list[tuple[dict, bool]]:
    """Вытягивает n уникальных карт из выбранного пула колоды."""
    if deck_mode == "major":
        pool = [c for c in ALL_CARDS if c["id"] in MAJOR_IDS]
    elif deck_mode == "minor":
        pool = [c for c in ALL_CARDS if c["id"] not in MAJOR_IDS]
    else:
        pool = ALL_CARDS

    count = max(1, min(n, len(pool)))
    chosen = random.sample(pool, count)
    prob = max(0.0, min(1.0, float(rev_prob))) if allow_reversed else 0.0
    return [(card, random.random() < prob) for card in chosen]


def yes_no_verdict(card: dict, reversed_card: bool) -> tuple[str, str, str, str]:
    """Возвращает (verdict_md, verdict_plain, verdict_class, energy_note)."""
    weight = int(card.get("yes_weight", 0))
    if reversed_card:
        weight = -weight
    if weight > 0:
        return (
            "✅ *ДА*",
            "ДА",
            "verdict-yes",
            "Карта несёт открытую, поддерживающую энергию — путь открыт.",
        )
    if weight < 0:
        return (
            "❌ *НЕТ*",
            "НЕТ",
            "verdict-no",
            "Карта предупреждает о препятствии или неверном моменте.",
        )
    return (
        "🔄 *ВОЗМОЖНО*",
        "ВОЗМОЖНО",
        "verdict-maybe",
        "Исход не предопределён — многое зависит от вашего следующего шага.",
    )


def get_position_lead(position: str) -> str:
    lower = position.lower()
    for key, phrase in POSITION_LEADS.items():
        if key in lower:
            return phrase
    return "здесь открывается"


def build_synthesis_structured(
    spread_name: str,
    positions: list[str],
    drawn: list[tuple[dict, bool]],
) -> dict:
    """Возвращает структурированный глубокий синтез {intro, arc, keyAdvice} для Mini App и бота."""
    n = len(drawn)
    if n == 0:
        return {"intro": "", "arc": "", "keyAdvice": ""}

    if n == 1:
        card, rev = drawn[0]
        kw = (card["reversed"] if rev else card["upright"]).split(",")[0].strip().lower()
        intro = (
            f"Аркан «{card['name']}» лёг в теневой (перевёрнутой) позиции. Это призыв не торопить внешние события, "
            f"а обратить внимание на тему «{kw}» и внутренне перенастроиться."
            if rev
            else f"Аркан «{card['name']}» задаёт чистый прямой вектор. Ваша ключевая опора сейчас — «{kw}», "
                 f"доверяйте естественному течению дел."
        )
        return {
            "intro": intro,
            "arc": card.get("story", ""),
            "keyAdvice": card.get("advice", ""),
        }

    first_c, first_r = drawn[0]
    last_c, last_r = drawn[-1]
    middle = drawn[1:-1]
    first_kw = (first_c["reversed"] if first_r else first_c["upright"]).split(",")[0].strip().lower()
    last_kw = (last_c["reversed"] if last_r else last_c["upright"]).split(",")[0].strip().lower()

    suit_counts = {"major": 0, "wands": 0, "cups": 0, "swords": 0, "pentacles": 0}
    for c, _ in drawn:
        suit = c.get("suit", "major")
        if suit in suit_counts:
            suit_counts[suit] += 1

    major_drawn = [c for c, _ in drawn if c["id"] in MAJOR_IDS]
    rev_count = sum(1 for _, r in drawn if r)

    half_ceil = (n + 1) // 2
    forty_ceil = max(1, int(-(-n * 0.4 // 1)))

    if len(major_drawn) >= half_ceil:
        names = " и ".join(f"«{c['name']}»" for c in major_drawn)
        intro = (
            f"Ситуация носит судьбоносный, кармический характер: сразу {len(major_drawn)} из {n} карт — "
            f"Старшие Арканы ({names}). Происходящее сейчас формирует ваш долгосрочный фундамент и не зависит от мелких случайностей."
        )
    elif suit_counts["wands"] >= forty_ceil:
        intro = (
            "В раскладе ярко доминирует стихия Огня (Жезлы) — импульс воли, амбиций и активных шагов. "
            "Время сомнений прошло: ситуация ждёт от вас смелости, инициативы и прямого движения вперёд."
        )
    elif suit_counts["cups"] >= forty_ceil:
        intro = (
            "Главенствует стихия Воды (Кубки) — сфера сердца, интуиции и искренних связей. "
            "Ключ к ответу лежит не в сухих расчётах, а в вашем эмоциональном комфорте и доверии собственному чутью."
        )
    elif suit_counts["swords"] >= forty_ceil:
        intro = (
            "Ведущая энергия — стихия Воздуха (Мечи). Происходит ментальная трансформация: "
            "пора отсечь лишние иллюзии, посмотреть правде в глаза и принять взвешенное, принципиальное решение."
        )
    elif suit_counts["pentacles"] >= forty_ceil:
        intro = (
            "Расклад опирается на стихию Земли (Пентакли) — материальные ресурсы, финансовую устойчивость и практический результат. "
            "Фокус на стабильности, надёжности и пошаговом укреплении позиций."
        )
    elif rev_count >= half_ceil:
        intro = (
            f"Большинство карт ({rev_count} из {n}) выпали в теневом (перевёрнутом) положении. "
            "Это период внутренней настройки: видимая пауза на деле даёт вам шанс вовремя исправить скрытые ошибки."
        )
    else:
        intro = (
            "Перед вами сбалансированный полифоничный расклад: энергии распределены гармонично, "
            "соединяя и практические действия, и искреннее эмоциональное участие."
        )

    first_pos_name = (positions[0] if positions else "Исходная точка").split("(")[0].strip()
    last_pos_name = (positions[min(n - 1, len(positions) - 1)] if positions else "Итог").split("(")[0].strip()

    middle_clause = ""
    if middle:
        mid_c, mid_r = middle[0]
        mid_kw = (mid_c["reversed"] if mid_r else mid_c["upright"]).split(",")[0].strip().lower()
        middle_clause = f" проходя через призму «{mid_c['name']}» ({mid_kw}),"

    if first_r and not last_r:
        arc = (
            f"Сюжет начинается с преодоления («{first_c['name']}» в {first_pos_name}: {first_kw}), "
            f"но{middle_clause} уверенно выводит вас к созидательному финалу «{last_c['name']}» "
            f"({last_pos_name}: {last_kw}). Это сильная дуга освобождения от сложностей."
        )
    elif not first_r and last_r:
        arc = (
            f"Старт уверенный («{first_c['name']}» в {first_pos_name}: {first_kw}), однако{middle_clause} "
            f"завершающий аркан «{last_c['name']}» выпал перевёрнутым. Это совет: не форсируйте события на финише и перепроверьте детали."
        )
    elif last_c.get("yes_weight", 0) > 0 and not last_r:
        arc = (
            f"Вектор развивается последовательно и гармонично: от стартовой энергии «{first_c['name']}» ({first_kw})"
            f"{middle_clause} к прямому успеху в позиции «{last_pos_name}» («{last_c['name']}»: {last_kw}). Путь свободен."
        )
    else:
        arc = (
            f"Линия от «{first_c['name']}» ({first_kw}){middle_clause} к финальной позиции «{last_c['name']}» ({last_kw}) "
            "советует действовать взвешенно, сохраняя внутреннее равновесие."
        )

    key_advice = last_c.get("advice", "")
    if last_r:
        key_advice = f"Учтите теневой намёк карты «{last_c['name']}»: {last_kw}. {key_advice}"
    elif first_c.get("advice") and first_c.get("advice") != last_c.get("advice"):
        key_advice = f"{key_advice} Опирайтесь на силу «{first_c['name']}» ({first_kw})."

    return {"intro": intro, "arc": arc, "keyAdvice": key_advice}


def spin_fortune_wheel() -> dict:
    """Выбирает выигрышный сектор Колеса Фортуны на сервере."""
    idx = random.randrange(len(WHEEL_SECTORS))
    return dict(WHEEL_SECTORS[idx])


def perform_spread_reading(
    spread_key: str,
    custom_topic: str = "",
    custom_count: int = 3,
    friend_name: str | None = None,
    question: str = "",
    deck_mode: str = "all",
    rev_prob: float = 0.5,
) -> dict:
    if spread_key == "custom_topic":
        spread_name = f"Своя тема: {custom_topic}" if custom_topic else "Расклад на свою тему"
        count = min(10, max(1, custom_count))
        positions = [f"Позиция {i + 1}" for i in range(count)]
        desc = "Индивидуальный расклад по вашей теме"
    else:
        spread = SPREADS.get(spread_key, SPREADS.get("three_cards"))
        spread_name = spread["name"]
        positions = spread["positions"]
        desc = spread.get("desc", "")
        count = len(positions)

    drawn_cards = draw_cards(n=count, deck_mode=deck_mode, rev_prob=rev_prob)
    drawn_payload = [{"card": c, "reversed": r} for c, r in drawn_cards]

    synthesis = build_synthesis_structured(spread_name, positions, drawn_cards)

    return {
        "spreadKey": spread_key,
        "spreadName": spread_name,
        "spreadDesc": desc,
        "positions": positions,
        "drawn": drawn_payload,
        "synthesis": synthesis,
        "friendName": friend_name,
        "question": question,
    }


def perform_oracle(question: str = "") -> dict:
    drawn = draw_cards(n=1, deck_mode="all", rev_prob=0.35)
    card, reversed_card = drawn[0]
    verdict, energy, lead, nuance = yes_no_verdict(card, reversed_card)

    return {
        "card": card,
        "reversed": reversed_card,
        "question": question,
        "verdict": {
            "verdict": verdict,
            "energy": energy,
            "lead": lead,
            "nuance": nuance,
        },
    }


def spin_wheel_server() -> tuple[int, dict]:
    idx = random.randrange(len(WHEEL_SECTORS))
    return idx, dict(WHEEL_SECTORS[idx])
