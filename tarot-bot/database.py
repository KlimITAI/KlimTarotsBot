"""
Оптимизированный слой работы с SQLite для KLIM TAROT.
Использует WAL-режим, busy_timeout, индексы и хранит историю,
карту дня, кулдауны, осколки, колесо фортуны и рефералов на сервере.
"""

import json
import logging
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path

import config

logger = logging.getLogger(__name__)


@contextmanager
def get_conn(db_path: Path | None = None):
    """Открывает соединение SQLite с оптимальными PRAGMA для конкурентной работы."""
    target = db_path or config.STATS_DB_PATH
    conn = sqlite3.connect(target, timeout=15.0)
    try:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = NORMAL")
        conn.execute("PRAGMA busy_timeout = 5000")
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA temp_store = MEMORY")
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db(db_path: Path | None = None) -> None:
    """Создаёт все таблицы и индексы, выполняет безопасные миграции."""
    with get_conn(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                user_id INTEGER PRIMARY KEY,
                username TEXT DEFAULT '',
                first_name TEXT DEFAULT 'Без имени',
                first_seen TEXT,
                last_seen TEXT,
                total_events INTEGER DEFAULT 0,
                is_banned INTEGER DEFAULT 0,
                notes TEXT DEFAULT '',
                shards INTEGER DEFAULT 0,
                wheel_last_spin REAL DEFAULT 0,
                invited_by INTEGER DEFAULT NULL,
                referrals_count INTEGER DEFAULT 0
            )
            """
        )
        existing_cols = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(users)").fetchall()
        }
        migrations = {
            "is_banned": "ALTER TABLE users ADD COLUMN is_banned INTEGER DEFAULT 0",
            "notes": "ALTER TABLE users ADD COLUMN notes TEXT DEFAULT ''",
            "shards": "ALTER TABLE users ADD COLUMN shards INTEGER DEFAULT 0",
            "wheel_last_spin": "ALTER TABLE users ADD COLUMN wheel_last_spin REAL DEFAULT 0",
            "invited_by": "ALTER TABLE users ADD COLUMN invited_by INTEGER DEFAULT NULL",
            "referrals_count": "ALTER TABLE users ADD COLUMN referrals_count INTEGER DEFAULT 0",
        }
        for col, ddl in migrations.items():
            if col not in existing_cols:
                conn.execute(ddl)

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                username TEXT DEFAULT '',
                first_name TEXT DEFAULT '',
                action TEXT NOT NULL,
                detail TEXT DEFAULT ''
            )
            """
        )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS readings_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                spread_key TEXT NOT NULL,
                spread_name TEXT NOT NULL,
                friend_name TEXT,
                question TEXT DEFAULT '',
                cards_json TEXT NOT NULL,
                synthesis_json TEXT DEFAULT '{}',
                source TEXT DEFAULT 'bot',
                created_at TEXT NOT NULL
            )
            """
        )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS daily_cards (
                user_id INTEGER NOT NULL,
                period_key TEXT NOT NULL,
                card_id TEXT NOT NULL,
                reversed INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                PRIMARY KEY (user_id, period_key)
            )
            """
        )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS cooldowns (
                user_id INTEGER NOT NULL,
                kind TEXT NOT NULL,
                last_ts REAL NOT NULL,
                PRIMARY KEY (user_id, kind)
            )
            """
        )

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

        # Индексы для быстрых запросов аналитики и API
        conn.execute("CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_users_referrals ON users(referrals_count DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_events_user_id ON events(user_id, id DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_events_action ON events(action, detail)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_readings_user ON readings_history(user_id, id DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_subs_expires ON subscriptions(expires_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status)")


def upsert_user(
    user_id: int,
    username: str = "",
    first_name: str = "Без имени",
    db_path: Path | None = None,
) -> None:
    """Создаёт или обновляет профиль пользователя без записи события."""
    now_iso = datetime.now(config.MSK_TZ).strftime("%Y-%m-%d %H:%M:%S")
    with get_conn(db_path) as conn:
        conn.execute(
            """
            INSERT INTO users (user_id, username, first_name, first_seen, last_seen, total_events)
            VALUES (?, ?, ?, ?, ?, 0)
            ON CONFLICT(user_id) DO UPDATE SET
                username = COALESCE(NULLIF(excluded.username, ''), users.username),
                first_name = COALESCE(NULLIF(excluded.first_name, ''), users.first_name),
                last_seen = excluded.last_seen
            """,
            (user_id, username or "", first_name or "Без имени", now_iso, now_iso),
        )


def log_user_event(
    user_id: int,
    username: str,
    first_name: str,
    action: str,
    detail: str = "",
    db_path: Path | None = None,
) -> None:
    """Атомарно обновляет счётчик пользователя и пишет событие в журнал."""
    if not user_id:
        return
    now_iso = datetime.now(config.MSK_TZ).strftime("%Y-%m-%d %H:%M:%S")
    try:
        with get_conn(db_path) as conn:
            conn.execute(
                """
                INSERT INTO users (user_id, username, first_name, first_seen, last_seen, total_events)
                VALUES (?, ?, ?, ?, ?, 1)
                ON CONFLICT(user_id) DO UPDATE SET
                    username = excluded.username,
                    first_name = excluded.first_name,
                    last_seen = excluded.last_seen,
                    total_events = users.total_events + 1
                """,
                (user_id, username or "", first_name or "Без имени", now_iso, now_iso),
            )
            conn.execute(
                """
                INSERT INTO events (ts, user_id, username, first_name, action, detail)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (now_iso, user_id, username or "", first_name or "Без имени", action, (detail or "")[:200]),
            )
    except Exception as exc:
        logger.warning("Ошибка записи в stats.db: %s", exc)


def is_user_banned(user_id: int, db_path: Path | None = None) -> bool:
    if user_id in config.ADMIN_IDS:
        return False
    try:
        with get_conn(db_path) as conn:
            row = conn.execute(
                "SELECT is_banned FROM users WHERE user_id = ?",
                (user_id,),
            ).fetchone()
            return bool(row and row["is_banned"] == 1)
    except Exception:
        return False


def set_user_ban_status(
    user_id: int,
    banned: bool,
    db_path: Path | None = None,
) -> bool:
    if user_id in config.ADMIN_IDS and banned:
        return False
    try:
        with get_conn(db_path) as conn:
            cur = conn.execute(
                "UPDATE users SET is_banned = ? WHERE user_id = ?",
                (1 if banned else 0, user_id),
            )
            return cur.rowcount > 0
    except Exception as exc:
        logger.warning("Ошибка set_user_ban_status: %s", exc)
        return False


def register_referral(
    new_user_id: int,
    referrer_id: int,
    db_path: Path | None = None,
) -> bool:
    """
    Привязывает реферала к пригласившему (только один раз, без саморефералов).
    Возвращает True, если реферал засчитан.
    """
    if not new_user_id or not referrer_id or new_user_id == referrer_id:
        return False
    now_iso = datetime.now(config.MSK_TZ).strftime("%Y-%m-%d %H:%M:%S")
    with get_conn(db_path) as conn:
        ref_exists = conn.execute(
            "SELECT 1 FROM users WHERE user_id = ?", (referrer_id,)
        ).fetchone()
        if not ref_exists:
            return False

        user_row = conn.execute(
            "SELECT invited_by FROM users WHERE user_id = ?", (new_user_id,)
        ).fetchone()
        if user_row and user_row["invited_by"] is not None:
            return False

        if not user_row:
            conn.execute(
                """
                INSERT INTO users (user_id, first_seen, last_seen, invited_by)
                VALUES (?, ?, ?, ?)
                """,
                (new_user_id, now_iso, now_iso, referrer_id),
            )
        else:
            conn.execute(
                "UPDATE users SET invited_by = ? WHERE user_id = ? AND invited_by IS NULL",
                (referrer_id, new_user_id),
            )

        conn.execute(
            "UPDATE users SET referrals_count = COALESCE(referrals_count, 0) + 1 WHERE user_id = ?",
            (referrer_id,),
        )
        return True


def get_referral_leaderboard(limit: int = 10, db_path: Path | None = None) -> list[dict]:
    """Возвращает реальный топ амбассадоров из базы."""
    with get_conn(db_path) as conn:
        rows = conn.execute(
            """
            SELECT user_id, username, first_name, referrals_count
            FROM users
            WHERE referrals_count > 0 AND is_banned = 0
            ORDER BY referrals_count DESC, total_events DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    result = []
    for r in rows:
        cnt = r["referrals_count"] or 0
        badge = (
            "👑 Чемпион" if cnt >= 15
            else "🌟 Мастер" if cnt >= 10
            else "✨ Искатель" if cnt >= 5
            else "🔮 Практик" if cnt >= 2
            else "🌿 Новичок"
        )
        result.append({
            "name": r["first_name"] or "Таролог",
            "user": f"@{r['username']}" if r["username"] else f"ID {r['user_id']}",
            "count": cnt,
            "days": f"+{cnt * config.REFERRAL_PRO_DAYS} дн.",
            "badge": badge,
        })
    return result


# ─── Кулдауны (SQLite) ───────────────────────────────────

def check_cooldown(
    user_id: int,
    kind: str,
    db_path: Path | None = None,
) -> int:
    """Возвращает оставшиеся секунды кулдауна (0 — можно гадать)."""
    limit = config.COOLDOWNS_SEC.get(kind, 0)
    if not limit:
        return 0
    with get_conn(db_path) as conn:
        row = conn.execute(
            "SELECT last_ts FROM cooldowns WHERE user_id = ? AND kind = ?",
            (user_id, kind),
        ).fetchone()
    if not row:
        return 0
    rem = int(limit - (time.time() - float(row["last_ts"])))
    return rem if rem > 0 else 0


def mark_cooldown(
    user_id: int,
    kind: str,
    db_path: Path | None = None,
) -> None:
    with get_conn(db_path) as conn:
        conn.execute(
            """
            INSERT INTO cooldowns (user_id, kind, last_ts)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id, kind) DO UPDATE SET last_ts = excluded.last_ts
            """,
            (user_id, kind, time.time()),
        )


def get_all_cooldowns_ms(
    user_id: int,
    db_path: Path | None = None,
) -> dict[str, int]:
    now = time.time()
    result = {k: 0 for k in config.COOLDOWNS_SEC}
    with get_conn(db_path) as conn:
        rows = conn.execute(
            "SELECT kind, last_ts FROM cooldowns WHERE user_id = ?",
            (user_id,),
        ).fetchall()
    for row in rows:
        kind = row["kind"]
        limit = config.COOLDOWNS_SEC.get(kind, 0)
        if limit:
            rem_ms = int((limit - (now - float(row["last_ts"]))) * 1000)
            result[kind] = max(0, rem_ms)
    return result


# ─── Карта дня и ночи (SQLite) ───────────────────────────

def get_daily_card(
    user_id: int,
    period_key: str,
    db_path: Path | None = None,
) -> dict | None:
    with get_conn(db_path) as conn:
        row = conn.execute(
            "SELECT card_id, reversed, created_at FROM daily_cards WHERE user_id = ? AND period_key = ?",
            (user_id, period_key),
        ).fetchone()
    if not row:
        return None
    return {
        "card_id": row["card_id"],
        "reversed": bool(row["reversed"]),
        "created_at": row["created_at"],
    }


def save_daily_card(
    user_id: int,
    period_key: str,
    card_id: str,
    reversed_card: bool,
    db_path: Path | None = None,
) -> None:
    now_iso = datetime.now(config.MSK_TZ).strftime("%Y-%m-%d %H:%M:%S")
    with get_conn(db_path) as conn:
        conn.execute(
            """
            INSERT OR IGNORE INTO daily_cards (user_id, period_key, card_id, reversed, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (user_id, period_key, card_id, 1 if reversed_card else 0, now_iso),
        )


# ─── История раскладов (SQLite) ──────────────────────────

def save_reading(
    user_id: int,
    spread_key: str,
    spread_name: str,
    cards: list[dict],
    friend_name: str | None = None,
    question: str = "",
    synthesis: dict | None = None,
    source: str = "bot",
    db_path: Path | None = None,
) -> int:
    now_str = datetime.now(config.MSK_TZ).strftime("%d.%m %H:%M")
    with get_conn(db_path) as conn:
        cur = conn.execute(
            """
            INSERT INTO readings_history
                (user_id, spread_key, spread_name, friend_name, question, cards_json, synthesis_json, source, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                spread_key,
                spread_name,
                friend_name,
                question or "",
                json.dumps(cards, ensure_ascii=False),
                json.dumps(synthesis or {}, ensure_ascii=False),
                source,
                now_str,
            ),
        )
        return int(cur.lastrowid)


def get_user_history(
    user_id: int,
    limit: int = config.HISTORY_LIMIT,
    db_path: Path | None = None,
) -> list[dict]:
    with get_conn(db_path) as conn:
        rows = conn.execute(
            """
            SELECT id, spread_key, spread_name, friend_name, question, cards_json, synthesis_json, source, created_at
            FROM readings_history
            WHERE user_id = ?
            ORDER BY id DESC
            LIMIT ?
            """,
            (user_id, limit),
        ).fetchall()
    out = []
    for r in rows:
        try:
            cards = json.loads(r["cards_json"])
        except (json.JSONDecodeError, TypeError):
            cards = []
        out.append({
            "id": r["id"],
            "spreadKey": r["spread_key"],
            "spreadName": r["spread_name"],
            "friendName": r["friend_name"],
            "question": r["question"] or "",
            "cards": cards,
            "source": r["source"],
            "time": r["created_at"],
        })
    return out


def clear_user_history(user_id: int, db_path: Path | None = None) -> int:
    with get_conn(db_path) as conn:
        cur = conn.execute("DELETE FROM readings_history WHERE user_id = ?", (user_id,))
        return cur.rowcount


# ─── Осколки и Колесо Фортуны (SQLite) ────────────────────

def get_wheel_and_shards(user_id: int, db_path: Path | None = None) -> dict:
    with get_conn(db_path) as conn:
        row = conn.execute(
            "SELECT shards, wheel_last_spin FROM users WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    if not row:
        return {"shards": 0, "wheel_cooldown_ms": 0}
    last_spin = float(row["wheel_last_spin"] or 0.0)
    rem_ms = int((config.WHEEL_COOLDOWN_SEC - (time.time() - last_spin)) * 1000) if last_spin > 0 else 0
    return {
        "shards": int(row["shards"] or 0),
        "wheel_cooldown_ms": max(0, rem_ms),
    }


def record_wheel_spin(
    user_id: int,
    shards_delta: int = 0,
    db_path: Path | None = None,
) -> dict:
    now = time.time()
    with get_conn(db_path) as conn:
        conn.execute(
            """
            UPDATE users
            SET wheel_last_spin = ?,
                shards = MAX(0, COALESCE(shards, 0) + ?)
            WHERE user_id = ?
            """,
            (now, shards_delta, user_id),
        )
        row = conn.execute("SELECT shards FROM users WHERE user_id = ?", (user_id,)).fetchone()
    return {
        "shards": int(row["shards"]) if row else 0,
        "wheel_cooldown_ms": config.WHEEL_COOLDOWN_SEC * 1000,
    }


def spend_shards_for_pro(
    user_id: int,
    cost: int = config.SHARDS_FOR_PRO,
    db_path: Path | None = None,
) -> bool:
    """Атомарно списывает осколки, если их достаточно."""
    with get_conn(db_path) as conn:
        cur = conn.execute(
            "UPDATE users SET shards = shards - ? WHERE user_id = ? AND COALESCE(shards, 0) >= ?",
            (cost, user_id, cost),
        )
        return cur.rowcount > 0


# ─── Админские выборки (без N+1) ──────────────────────────

def get_users_page_data(
    page: int = 0,
    per_page: int = 6,
    db_path: Path | None = None,
) -> tuple[list[dict], int, int]:
    now_iso = datetime.now(config.MSK_TZ).isoformat()
    try:
        with get_conn(db_path) as conn:
            total = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            total_pages = max(1, (total + per_page - 1) // per_page)
            page = max(0, min(page, total_pages - 1))
            offset = page * per_page
            rows = conn.execute(
                """
                SELECT
                    u.user_id,
                    u.username,
                    u.first_name,
                    u.last_seen,
                    u.total_events,
                    u.is_banned,
                    s.expires_at AS sub_expires
                FROM users u
                LEFT JOIN subscriptions s
                    ON s.user_id = u.user_id AND s.expires_at > ?
                ORDER BY u.last_seen DESC
                LIMIT ? OFFSET ?
                """,
                (now_iso, per_page, offset),
            ).fetchall()
        users = []
        for r in rows:
            sub_exp = r["sub_expires"]
            pro_expires = None
            if sub_exp:
                try:
                    pro_expires = datetime.fromisoformat(sub_exp).strftime("%d.%m.%Y %H:%M МСК")
                except ValueError:
                    pass
            users.append({
                "user_id": r["user_id"],
                "username": r["username"] or "",
                "first_name": r["first_name"] or "Без имени",
                "last_seen": r["last_seen"] or "—",
                "total_events": r["total_events"] or 0,
                "is_banned": bool(r["is_banned"]),
                "is_pro": pro_expires is not None,
                "pro_expires": pro_expires,
            })
        return users, page, total_pages
    except Exception as exc:
        logger.warning("Ошибка get_users_page_data: %s", exc)
        return [], 0, 1
