"""
Модуль платежей и подписок KLIM TAROT.

Поддерживает:
  • Оплату банковскими картами РФ и СБП напрямую в Telegram (ЮKassa / Robokassa / PayMaster)
  • Тестовый режим (PAYMENTS_ENABLED=false по умолчанию — все функции бота бесплатны,
    пока вы не включите монетизацию одним флагом)
  • Хранение подписок и истории оплат в SQLite (stats.db)
  • Админ-команды /paytest и /grant <user_id> <days> для проверки и выдачи VIP
"""

import os
import sqlite3
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path

from telegram import (
    Update,
    LabeledPrice,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
)
from telegram.ext import ContextTypes
from telegram.constants import ParseMode

logger = logging.getLogger(__name__)

MSK_TZ = timezone(timedelta(hours=3))
BASE_DIR = Path(__file__).resolve().parent
STATS_DB_PATH = BASE_DIR / "stats.db"

# ─────────────────────────────────────────────────────────
#  КОНФИГУРАЦИЯ (УПРАВЛЯЕТСЯ ЧЕРЕЗ ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ)
# ─────────────────────────────────────────────────────────

# Пока False — paywall ВЫКЛЮЧЕН, все функции бота полностью бесплатны для всех.
# Когда решите включить платный доступ, задайте PAYMENTS_ENABLED=true.
PAYMENTS_ENABLED = os.environ.get("PAYMENTS_ENABLED", "false").strip().lower() == "true"

# Токен платёжного провайдера из @BotFather -> /mybots -> Payments -> ЮKassa
PAYMENT_PROVIDER_TOKEN = os.environ.get("PAYMENT_PROVIDER_TOKEN", "").strip()

# Количество бесплатных раскладов до предложения подписки (действует только при PAYMENTS_ENABLED=true)
FREE_READINGS_LIMIT = int(os.environ.get("FREE_READINGS_LIMIT", "3"))

# Тарифные планы в рублях (цены в рублях; Telegram принимает в копейках = price_rub * 100)
PLANS = {
    "trial": {
        "title": "✨ Пробный — 10 дней",
        "short": "10 дней · 199 ₽",
        "price_rub": 199,
        "days": 10,
        "desc": "Полный доступ ко всем 35 раскладам, Оракулу Да/Нет и экспертному режиму на 10 дней.",
    },
    "month": {
        "title": "🌙 Стандарт — 1 месяц",
        "short": "1 месяц · 490 ₽ (Хит)",
        "price_rub": 490,
        "days": 30,
        "desc": "Полный безлимитный доступ ко всем возможностям KLIM TAROT на 30 дней.",
    },
    "half_year": {
        "title": "⚡ Мастер — 6 месяцев",
        "short": "6 месяцев · 2 490 ₽",
        "price_rub": 2490,
        "days": 180,
        "desc": "Полгода безлимитных раскладов, личных запросов и глубокого синтеза арканов.",
    },
    "year": {
        "title": "👑 Премиум — 1 год",
        "short": "1 год · 4 490 ₽ (VIP)",
        "price_rub": 4490,
        "days": 365,
        "desc": "Годовой безлимитный VIP-доступ ко всей колоде, новым раскладам и приоритетным ответам.",
    },
}


# ─────────────────────────────────────────────────────────
#  БАЗА ДАННЫХ ПОДПИСОК И ПЛАТЕЖЕЙ
# ─────────────────────────────────────────────────────────

def init_payments_db(db_path: Path = STATS_DB_PATH) -> None:
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS subscriptions (
                user_id INTEGER PRIMARY KEY,
                plan_id TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                username TEXT,
                plan_id TEXT NOT NULL,
                amount_rub INTEGER NOT NULL,
                currency TEXT NOT NULL,
                provider_charge_id TEXT,
                status TEXT NOT NULL
            )
            """
        )
        conn.commit()


def grant_subscription(user_id: int, plan_id: str, days: int, db_path: Path = STATS_DB_PATH) -> datetime:
    """Активирует или продлевает подписку пользователю на указанное число дней."""
    now = datetime.now(MSK_TZ)
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            "SELECT expires_at FROM subscriptions WHERE user_id = ?", (user_id,)
        ).fetchone()
        base = now
        if row:
            try:
                existing_exp = datetime.fromisoformat(row[0])
                if existing_exp > now:
                    base = existing_exp
            except ValueError:
                pass
        new_exp = base + timedelta(days=days)
        conn.execute(
            """
            INSERT INTO subscriptions (user_id, plan_id, expires_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                plan_id = excluded.plan_id,
                expires_at = excluded.expires_at,
                updated_at = excluded.updated_at
            """,
            (user_id, plan_id, new_exp.isoformat(), now.isoformat()),
        )
        conn.commit()
    return new_exp


def revoke_subscription(user_id: int, db_path: Path = STATS_DB_PATH) -> bool:
    """Аннулирует подписку пользователя."""
    with sqlite3.connect(db_path) as conn:
        cur = conn.execute("DELETE FROM subscriptions WHERE user_id = ?", (user_id,))
        conn.commit()
        return cur.rowcount > 0


def get_subscription(user_id: int, db_path: Path = STATS_DB_PATH) -> dict | None:
    """Возвращает активную подписку пользователя или None."""
    now = datetime.now(MSK_TZ)
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            "SELECT plan_id, expires_at FROM subscriptions WHERE user_id = ?", (user_id,)
        ).fetchone()
    if not row:
        return None
    try:
        exp = datetime.fromisoformat(row[1])
    except ValueError:
        return None
    if exp <= now:
        return None
    return {
        "plan_id": row[0],
        "expires_at": exp,
        "expires_str": exp.strftime("%d.%m.%Y %H:%M МСК"),
    }


def is_premium(user_id: int, admin_ids: set[int] | None = None) -> bool:
    """Если paywall выключен (PAYMENTS_ENABLED=False), все пользователи имеют свободный доступ."""
    if not PAYMENTS_ENABLED:
        return True
    if admin_ids and user_id in admin_ids:
        return True
    return get_subscription(user_id) is not None


def record_payment(
    user_id: int,
    username: str,
    plan_id: str,
    amount_rub: int,
    currency: str,
    provider_charge_id: str,
    status: str = "paid",
    db_path: Path = STATS_DB_PATH,
) -> None:
    now_str = datetime.now(MSK_TZ).strftime("%Y-%m-%d %H:%M:%S")
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO payments (ts, user_id, username, plan_id, amount_rub, currency, provider_charge_id, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (now_str, user_id, username or "", plan_id, amount_rub, currency, provider_charge_id, status),
        )
        conn.commit()


def get_revenue_summary(db_path: Path = STATS_DB_PATH) -> dict:
    now_iso = datetime.now(MSK_TZ).isoformat()
    with sqlite3.connect(db_path) as conn:
        total_rub = conn.execute(
            "SELECT COALESCE(SUM(amount_rub), 0) FROM payments WHERE status = 'paid'"
        ).fetchone()[0]
        paid_count = conn.execute(
            "SELECT COUNT(*) FROM payments WHERE status = 'paid'"
        ).fetchone()[0]
        active_subs = conn.execute(
            "SELECT COUNT(*) FROM subscriptions WHERE expires_at > ?", (now_iso,)
        ).fetchone()[0]
    return {
        "total_rub": total_rub,
        "paid_count": paid_count,
        "active_subs": active_subs,
    }


# ─────────────────────────────────────────────────────────
#  UI ТАРИФОВ И ОБРАБОТЧИКИ TELEGRAM PAYMENTS (ЮKassa / СБП)
# ─────────────────────────────────────────────────────────

def plans_keyboard() -> InlineKeyboardMarkup:
    rows = [
        [InlineKeyboardButton(f"💳 {plan['short']}", callback_data=f"pay_plan_{key}")]
        for key, plan in PLANS.items()
    ]
    rows.append([InlineKeyboardButton("🏠 Главное меню", callback_data="main_menu")])
    return InlineKeyboardMarkup(rows)


def plans_text(user_id: int) -> str:
    sub = get_subscription(user_id)
    status_line = (
        f"✅ *Ваш статус:* Premium активен до `{sub['expires_str']}`\n\n"
        if sub
        else "🔓 *Текущий статус:* Бесплатный доступ\n\n"
    )
    mode_note = (
        ""
        if PAYMENTS_ENABLED
        else "🧪 _Режим преднастройки: для обычных пользователей оплата пока отключена._\n\n"
    )
    return (
        "💎 *KLIM TAROT Premium*\n\n"
        f"{mode_note}"
        f"{status_line}"
        "Откройте полный доступ без ограничений:\n"
        "• Все 21 расклад и 78 классических 3D-карт\n"
        "• Глубокий синтез всех карт вместе\n"
        "• Неограниченный Оракул «Да или Нет»\n"
        "• Гадания для друзей с пересылкой\n\n"
        "💳 Оплата банковской картой РФ / СБП прямо в Telegram.\n"
        "Выберите тариф:"
    )


async def send_plan_invoice(query, plan_key: str) -> None:
    """Выставляет счёт на оплату выбранного тарифа через подключённого провайдера (ЮKassa)."""
    if plan_key not in PLANS:
        await query.message.reply_text("❌ Тариф не найден.")
        return

    plan = PLANS[plan_key]
    if not PAYMENT_PROVIDER_TOKEN:
        await query.message.reply_text(
            f"💳 *Тариф: {plan['title']}*\n\n"
            f"💰 Стоимость: *{plan['price_rub']} ₽*\n"
            f"⏳ Срок действия: *{plan['days']} дней*\n"
            f"📝 Описание: _{plan['desc']}_\n\n"
            "🔒 Оплата защищена через официальный шлюз ЮKassa (банковские карты РФ, МИР, Visa, Mastercard, СБП).\n\n"
            "_(Приём платежей активируется автоматически после одобрения договора ЮKassa)_",
            parse_mode=ParseMode.MARKDOWN,
        )
        return

    await query.message.reply_invoice(
        title=plan["title"],
        description=plan["desc"],
        payload=f"klim_tarot_{plan_key}",
        provider_token=PAYMENT_PROVIDER_TOKEN,
        currency="RUB",
        prices=[LabeledPrice(label=plan["title"], amount=plan["price_rub"] * 100)],
        start_parameter=f"tarot_{plan_key}",
    )


async def handle_pre_checkout(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Подтверждает готовность принять платёж перед списанием средств."""
    query = update.pre_checkout_query
    if query.invoice_payload.startswith("klim_tarot_"):
        await query.answer(ok=True)
    else:
        await query.answer(ok=False, error_message="Неизвестный тариф. Попробуйте снова.")


async def handle_successful_payment(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Активирует подписку сразу после успешной оплаты."""
    payment = update.message.successful_payment
    user = update.effective_user
    payload = payment.invoice_payload
    plan_key = payload.replace("klim_tarot_", "")
    plan = PLANS.get(plan_key, {"title": "Premium", "days": 30, "price_rub": payment.total_amount // 100})

    expires_at = grant_subscription(user.id, plan_key, plan["days"])
    record_payment(
        user_id=user.id,
        username=user.username or "",
        plan_id=plan_key,
        amount_rub=payment.total_amount // 100,
        currency=payment.currency,
        provider_charge_id=payment.provider_payment_charge_id,
        status="paid",
    )

    await update.message.reply_text(
        f"🎉 *Оплата прошла успешно!*\n\n"
        f"Тариф: *{plan['title']}*\n"
        f"Доступ активен до: `{expires_at.strftime('%d.%m.%Y %H:%M МСК')}`\n\n"
        f"Спасибо за поддержку KLIM TAROT ✨",
        parse_mode=ParseMode.MARKDOWN,
    )
