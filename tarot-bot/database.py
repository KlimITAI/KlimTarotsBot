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
import payments

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
    target = db_path or config.STATS_DB_PATH
    payments.init_payments_db(target)

    with get_conn(target) as conn:
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
                try:
                    conn.execute(ddl)
                except Exception:
                    pass

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
            CREATE TABLE IF NOT EXISTS user_cloud_sync (
                user_id INTEGER PRIMARY KEY,
                wheel_last REAL DEFAULT 0,
                shards INTEGER DEFAULT 0,
                daily_card_key TEXT DEFAULT '',
                updated_at TEXT
            )
            """
        )

        conn.execute("CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_events_user_ts ON events(user_id, ts DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_events_action ON events(action)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_readings_user ON readings_history(user_id, id DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_subs_expires ON subscriptions(expires_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status)")

    logger.info("📦 База данных SQLite успешно инициализирована (WAL-режим активен)")


def upsert_user(
    user_id: int,
    username: str = "",
    first_name: str = "",
    db_path: Path | None = None,
) -> None:
    now_iso = datetime.now(config.MSK_TZ).isoformat()
    clean_username = (username or "").lstrip("@")
    clean_first_name = first_name or "Без имени"

    with get_conn(db_path) as conn:
        conn.execute(
            """
            INSERT INTO users (user_id, username, first_name, first_seen, last_seen, total_events)
            VALUES (?, ?, ?, ?, ?, 1)
            ON CONFLICT(user_id) DO UPDATE SET
                username = CASE WHEN excluded.username != '' THEN excluded.username ELSE users.username END,
                first_name = CASE WHEN excluded.first_name != '' THEN excluded.first_name ELSE users.first_name END,
                last_seen = excluded.last_seen,
                total_events = users.total_events + 1
            """,
            (user_id, clean_username, clean_first_name, now_iso, now_iso),
        )


def log_user_event(
    user_id: int,
    username: str,
    first_name: str,
    action: str,
    detail: str = "",
    db_path: Path | None = None,
) -> None:
    now_iso = datetime.now(config.MSK_TZ).isoformat()
    clean_username = (username or "").lstrip("@")
    clean_first_name = first_name or ""
    with get_conn(db_path) as conn:
        conn.execute(
            """
            INSERT INTO events (ts, user_id, username, first_name, action, detail)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (now_iso, user_id, clean_username, clean_first_name, action, detail or ""),
        )
    upsert_user(user_id, clean_username, clean_first_name, db_path)


def is_user_banned(user_id: int, db_path: Path | None = None) -> bool:
    if user_id in config.ADMIN_IDS or user_id == config.OWNER_TELEGRAM_ID:
        return False
    with get_conn(db_path) as conn:
        row = conn.execute("SELECT is_banned FROM users WHERE user_id = ?", (user_id,)).fetchone()
        return bool(row["is_banned"]) if row else False


def set_user_ban_status(
    user_id: int,
    banned: bool,
    note: str = "",
    db_path: Path | None = None,
) -> None:
    with get_conn(db_path) as conn:
        conn.execute(
            """
            UPDATE users
            SET is_banned = ?,
                notes = CASE WHEN ? != '' THEN ? ELSE notes END
            WHERE user_id = ?
            """,
            (1 if banned else 0, note, note, user_id),
        )


def check_cooldown(
    user_id: int,
    kind: str,
    db_path: Path | None = None,
) -> int:
    """Возвращает оставшиеся секунды перерыва (0, если можно гадать). Для владельца всегда 0."""
    if user_id == config.OWNER_TELEGRAM_ID:
        return 0
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
    return max(0, rem)


def mark_cooldown(
    user_id: int,
    kind: str,
    db_path: Path | None = None,
) -> None:
    now = time.time()
    with get_conn(db_path) as conn:
        conn.execute(
            """
            INSERT INTO cooldowns (user_id, kind, last_ts)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id, kind) DO UPDATE SET last_ts = excluded.last_ts
            """,
            (user_id, kind, now),
        )


def get_all_cooldowns_ms(
    user_id: int,
    db_path: Path | None = None,
) -> dict[str, int]:
    if user_id == config.OWNER_TELEGRAM_ID:
        return {"spread": 0, "oracle": 0, "friend": 0}
    now = time.time()
    result = {}
    with get_conn(db_path) as conn:
        rows = conn.execute(
            "SELECT kind, last_ts FROM cooldowns WHERE user_id = ?",
            (user_id,),
        ).fetchall()
    last_map = {r["kind"]: float(r["last_ts"]) for r in rows}
    for kind, limit_sec in config.COOLDOWNS_SEC.items():
        last = last_map.get(kind, 0.0)
        rem_sec = max(0.0, limit_sec - (now - last)) if last > 0 else 0.0
        result[kind] = int(rem_sec * 1000)
    return result


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
    reversed: bool,
    db_path: Path | None = None,
) -> None:
    now_iso = datetime.now(config.MSK_TZ).isoformat()
    with get_conn(db_path) as conn:
        conn.execute(
            """
            INSERT INTO daily_cards (user_id, period_key, card_id, reversed, created_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id, period_key) DO NOTHING
            """,
            (user_id, period_key, card_id, 1 if reversed else 0, now_iso),
        )


def save_reading(
    user_id: int,
    spread_key: str,
    spread_name: str,
    cards: list[dict],
    synthesis: dict | str = "",
    question: str = "",
    friend_name: str | None = None,
    source: str = "webapp",
    db_path: Path | None = None,
) -> int:
    now_iso = datetime.now(config.MSK_TZ).strftime("%d.%m.%Y %H:%M")
    cards_json = json.dumps(cards, ensure_ascii=False)
    synth_json = json.dumps(synthesis, ensure_ascii=False) if isinstance(synthesis, dict) else str(synthesis)

    with get_conn(db_path) as conn:
        cur = conn.execute(
            """
            INSERT INTO readings_history (
                user_id, spread_key, spread_name, friend_name, question,
                cards_json, synthesis_json, source, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                spread_key,
                spread_name,
                friend_name,
                question or "",
                cards_json,
                synth_json,
                source,
                now_iso,
            ),
        )
        return int(cur.lastrowid or 0)


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


def get_referral_leaderboard(limit: int = 10, db_path: Path | None = None) -> list[dict]:
    with get_conn(db_path) as conn:
        rows = conn.execute(
            """
            SELECT user_id, username, first_name, COALESCE(referrals_count, 0) AS ref_cnt
            FROM users
            WHERE referrals_count > 0
            ORDER BY referrals_count DESC, user_id ASC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

    if not rows:
        return []

    badges = ["Мастер Рун", "Хранитель", "Звёздный Путник", "Искатель", "Адепт"]
    res = []
    for idx, r in enumerate(rows):
        name = r["first_name"] or "Таролог"
        uname = f"@{r['username']}" if r["username"] else f"id{r['user_id']}"
        badge = badges[idx] if idx < len(badges) else "Искатель"
        cnt = int(r["ref_cnt"])
        res.append({
            "name": name,
            "user": uname,
            "count": cnt,
            "days": f"+{cnt * config.REFERRAL_PRO_DAYS}",
            "badge": badge,
        })
    return res


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
                "is_pro": (r["user_id"] == config.OWNER_TELEGRAM_ID) or (pro_expires is not None),
                "pro_expires": "Навсегда (Владелец)" if r["user_id"] == config.OWNER_TELEGRAM_ID else pro_expires,
            })
        return users, page, total_pages
    except Exception as exc:
        logger.warning("Ошибка get_users_page_data: %s", exc)
        return [], 0, 1
