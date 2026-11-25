"""
Асинхронный HTTP + REST API сервер KLIM TAROT на базе aiohttp.web.
Работает в одном event loop с Telegram-ботом:
  • /health, / — проверка состояния для Render
  • /api/sync_state — обратная совместимость для CloudSync
  • /api/bootstrap — полная инициализация Mini App
  • /api/draw/daily, /api/draw/spread, /api/draw/oracle — серверный движок Таро
  • /api/wheel/spin, /api/shards/forge — Колесо Фортуны и осколки
  • /api/history — история раскладов
"""

import json
import logging
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path

from aiohttp import web

import auth
import config
import database
import payments
import tarot_engine

logger = logging.getLogger(__name__)

# Скользящий rate-limiter: IP/UID -> deque[timestamp]
_RATE_BUCKETS: dict[str, deque[float]] = defaultdict(deque)
RATE_LIMIT_MAX = 120
RATE_LIMIT_WINDOW_SEC = 60.0


def _is_rate_limited(key: str) -> bool:
    now = time.monotonic()
    bucket = _RATE_BUCKETS[key]
    while bucket and (now - bucket[0]) > RATE_LIMIT_WINDOW_SEC:
        bucket.popleft()
    if len(bucket) >= RATE_LIMIT_MAX:
        return True
    bucket.append(now)
    return False


def _cors_headers(request: web.Request) -> dict[str, str]:
    origin = request.headers.get("Origin", "*")
    return {
        "Access-Control-Allow-Origin": origin if origin else "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Telegram-Init-Data, X-Dev-User-Id, Accept",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Max-Age": "86400",
    }


@web.middleware
async def security_and_cors_middleware(request: web.Request, handler):
    if request.method == "OPTIONS":
        return web.Response(status=200, headers=_cors_headers(request))

    client_ip = request.headers.get("X-Forwarded-For", request.remote or "unknown").split(",")[0].strip()
    if _is_rate_limited(client_ip):
        return web.json_response(
            {"status": "error", "code": "rate_limited", "message": "Слишком много запросов. Подождите минуту."},
            status=429,
            headers=_cors_headers(request),
        )

    try:
        response = await handler(request)
    except web.HTTPException as exc:
        for k, v in _cors_headers(request).items():
            exc.headers[k] = v
        raise exc
    except Exception as exc:
        logger.exception("Ошибка в обработчике %s: %s", request.path, exc)
        return web.json_response(
            {"status": "error", "code": "server_error", "message": str(exc)},
            status=500,
            headers=_cors_headers(request),
        )

    for k, v in _cors_headers(request).items():
        response.headers[k] = v
    return response


async def _authenticate(request: web.Request, allow_guest: bool = True) -> dict:
    """Извлекает пользователя с поддержкой HMAC initData, UID fallback и безопасного гостевого режима."""
    user = auth.extract_user_from_request(request)
    if user:
        uid = user["id"]
        if database.is_user_banned(uid):
            raise web.HTTPForbidden(reason="user_banned")
        database.upsert_user(uid, user.get("username", ""), user.get("first_name", ""))
        return user

    if allow_guest:
        return {
            "id": 0,
            "username": "",
            "first_name": "Гость",
            "is_owner": False,
            "verified": False,
        }

    raise web.HTTPUnauthorized(reason="auth_required")


def _user_pro_status(uid: int) -> tuple[bool, str | None, int]:
    """Возвращает (is_pro, expires_at_str, remaining_days). Для владельца — всегда активен."""
    if uid == config.OWNER_TELEGRAM_ID:
        return True, "Вечный доступ (Владелец)", 9999
    if not uid:
        return False, None, 0

    sub = payments.get_subscription(uid, config.STATS_DB_PATH)
    if not sub:
        return False, None, 0

    exp_str = sub.get("expires_at")
    if not exp_str:
        return False, None, 0

    try:
        exp_dt = datetime.fromisoformat(exp_str)
        now_utc = datetime.now(timezone.utc)
        rem_days = max(1, (exp_dt - now_utc).days)
        is_pro = exp_dt > now_utc
        formatted = exp_dt.astimezone(config.MSK_TZ).strftime("%d.%m.%Y %H:%M МСК")
        return is_pro, formatted, rem_days
    except Exception:
        return True, "Активен", 30


# ─── ХЕНДЛЕРЫ ─────────────────────────────────────────────

async def handle_health(request: web.Request) -> web.Response:
    return web.json_response({
        "status": "ok",
        "service": "klim-tarot",
        "time": datetime.now(config.MSK_TZ).isoformat(),
        "version": "v51",
    })


async def handle_legacy_sync_state(request: web.Request) -> web.Response:
    """Обратная совместимость с GET /api/sync_state?uid=... для бесшовной работы любого клиента."""
    uid_str = request.query.get("uid", "").strip()
    uid = int(uid_str) if uid_str.isdigit() else 0
    is_owner = (uid == config.OWNER_TELEGRAM_ID)

    if not uid:
        return web.json_response({"status": "ok", "pro_days": 0, "is_owner": False})

    is_pro, exp_str, pro_days = _user_pro_status(uid)
    wheel = database.get_wheel_and_shards(uid)

    return web.json_response({
        "status": "ok",
        "is_owner": is_owner,
        "is_forever": is_owner or (pro_days >= 365),
        "pro_days": 9999 if is_owner else pro_days,
        "pro_expires_at": exp_str,
        "shards": wheel["shards"],
        "wheel_last": int(time.time() * 1000) - (config.WHEEL_COOLDOWN_SEC * 1000 - wheel["wheel_cooldown_ms"]),
    })


async def handle_legacy_post_sync_state(request: web.Request) -> web.Response:
    """Обратная совместимость с POST /api/sync_state."""
    try:
        body = await request.json()
        uid = int(body.get("uid", 0))
        grant_days = int(body.get("grant_pro_days", 0))
        if uid and grant_days > 0 and uid != config.OWNER_TELEGRAM_ID:
            payments.grant_subscription(uid, "mini_app_grant", grant_days, config.STATS_DB_PATH)
        return web.json_response({"status": "ok"})
    except Exception as exc:
        return web.json_response({"status": "error", "error": str(exc)}, status=400)


async def handle_bootstrap(request: web.Request) -> web.Response:
    user = await _authenticate(request, allow_guest=True)
    uid = user["id"]
    tz_offset = None
    try:
        tz_offset = int(request.query.get("tzOffset", ""))
    except Exception:
        pass

    period = tarot_engine.get_day_night_period(tz_offset)
    is_pro, pro_expires, pro_days = _user_pro_status(uid)
    wheel_info = database.get_wheel_and_shards(uid)
    cooldowns_ms = database.get_all_cooldowns_ms(uid)

    daily_payload = None
    if uid:
        daily_row = database.get_daily_card(uid, period["periodKey"])
        if daily_row:
            card = tarot_engine.CARD_BY_ID.get(daily_row["card_id"])
            if card:
                daily_payload = {
                    "card": card,
                    "reversed": daily_row["reversed"],
                    "opened": True,
                    "period": period,
                }

    return web.json_response({
        "status": "ok",
        "user": {
            "id": uid,
            "username": user["username"],
            "firstName": user["first_name"],
            "isOwner": user["is_owner"],
            "isPro": is_pro,
            "proDays": 9999 if user["is_owner"] else pro_days,
            "proExpires": pro_expires,
            "isAdmin": uid in config.ADMIN_IDS,
            "shards": wheel_info["shards"],
            "wheelCooldownMs": wheel_info["wheel_cooldown_ms"],
            "cooldownsMs": cooldowns_ms,
        },
        "period": period,
        "dailyCard": daily_payload,
        "history": database.get_user_history(uid) if uid else [],
        "leaderboard": database.get_referral_leaderboard(limit=10),
    })


async def handle_daily(request: web.Request) -> web.Response:
    user = await _authenticate(request, allow_guest=True)
    uid = user["id"]
    body = await request.json() if request.can_read_body else {}
    tz_offset = body.get("tzOffset")
    period = tarot_engine.get_day_night_period(tz_offset)

    if uid:
        existing = database.get_daily_card(uid, period["periodKey"])
        if existing:
            card = tarot_engine.CARD_BY_ID.get(existing["card_id"])
            if card:
                synthesis = tarot_engine.build_synthesis_structured(
                    period["title"], [period["position"]], [(card, existing["reversed"])]
                )
                return web.json_response({
                    "card": card,
                    "reversed": existing["reversed"],
                    "already": True,
                    "period": period,
                    "synthesis": synthesis,
                })

    # Вытягиваем новую карту дня
    cards_drawn = tarot_engine.draw_cards(n=1, deck_mode="all", rev_prob=0.25)
    card, rev = cards_drawn[0]
    if uid:
        database.save_daily_card(uid, period["periodKey"], card["id"], rev)
        database.log_user_event(uid, user["username"], user["first_name"], "daily_card", f"{card['id']}:{rev}")

    synthesis = tarot_engine.build_synthesis_structured(
        period["title"], [period["position"]], [(card, rev)]
    )
    return web.json_response({
        "card": card,
        "reversed": rev,
        "already": False,
        "period": period,
        "synthesis": synthesis,
    })


async def handle_spread_draw(request: web.Request) -> web.Response:
    user = await _authenticate(request, allow_guest=True)
    uid = user["id"]
    body = await request.json() if request.can_read_body else {}

    spread_key = body.get("spreadKey", "three_cards")
    custom_topic = body.get("customTopic", "")
    custom_count = int(body.get("customCount", 3))
    friend_name = body.get("friendName")
    question = body.get("question", "")
    deck_mode = body.get("deckMode", "all")
    rev_prob = float(body.get("revProb", 0.5))

    cooldown_kind = "friend" if friend_name else "spread"
    if uid and uid != config.OWNER_TELEGRAM_ID:
        rem_sec = database.check_cooldown(uid, cooldown_kind)
        if rem_sec > 0:
            return web.json_response(
                {
                    "status": "cooldown",
                    "kind": cooldown_kind,
                    "remainingMs": rem_sec * 1000,
                    "cooldownsMs": database.get_all_cooldowns_ms(uid),
                },
                status=429,
            )

    reading = tarot_engine.perform_spread_reading(
        spread_key=spread_key,
        custom_topic=custom_topic,
        custom_count=custom_count,
        friend_name=friend_name,
        question=question,
        deck_mode=deck_mode,
        rev_prob=rev_prob,
    )

    if uid:
        database.mark_cooldown(uid, cooldown_kind)
        database.save_reading(
            user_id=uid,
            spread_key=reading["spreadKey"],
            spread_name=reading["spreadName"],
            cards=reading["drawn"],
            synthesis=reading.get("synthesis", {}),
            question=question,
            friend_name=friend_name,
            source="webapp",
        )
        database.log_user_event(
            uid, user["username"], user["first_name"], f"spread:{spread_key}", f"cards={len(reading['drawn'])}"
        )

    reading["cooldownsMs"] = database.get_all_cooldowns_ms(uid) if uid else {}
    return web.json_response(reading)


async def handle_oracle_ask(request: web.Request) -> web.Response:
    user = await _authenticate(request, allow_guest=True)
    uid = user["id"]
    body = await request.json() if request.can_read_body else {}
    question = body.get("question", "")

    if uid and uid != config.OWNER_TELEGRAM_ID:
        rem_sec = database.check_cooldown(uid, "oracle")
        if rem_sec > 0:
            return web.json_response(
                {"status": "cooldown", "kind": "oracle", "remainingMs": rem_sec * 1000},
                status=429,
            )

    result = tarot_engine.perform_oracle(question=question)
    if uid:
        database.mark_cooldown(uid, "oracle")
        database.save_reading(
            user_id=uid,
            spread_key="oracle",
            spread_name="Оракул Да / Нет",
            cards=[{"card": result["card"], "reversed": result["reversed"]}],
            synthesis=result["verdict"],
            question=question,
            source="webapp",
        )
        database.log_user_event(uid, user["username"], user["first_name"], "oracle", result["verdict"]["verdict"])

    result["cooldownsMs"] = database.get_all_cooldowns_ms(uid) if uid else {}
    return web.json_response(result)


async def handle_wheel_spin(request: web.Request) -> web.Response:
    user = await _authenticate(request, allow_guest=False)
    uid = user["id"]

    info = database.get_wheel_and_shards(uid)
    if info["wheel_cooldown_ms"] > 0 and uid != config.OWNER_TELEGRAM_ID:
        return web.json_response(
            {"status": "cooldown", "wheelCooldownMs": info["wheel_cooldown_ms"]},
            status=429,
        )

    sector_index, sector = tarot_engine.spin_wheel_server()
    shards_gain = sector.get("val", 0) if sector.get("type") in ("shard", "jackpot") else 0
    updated = database.record_wheel_spin(uid, shards_delta=shards_gain)
    database.log_user_event(uid, user["username"], user["first_name"], "wheel_spin", f"sector={sector['label']}")

    return web.json_response({
        "status": "ok",
        "sectorIndex": sector_index,
        "sector": sector,
        "shards": updated["shards"],
        "wheelCooldownMs": updated["wheel_cooldown_ms"],
    })


async def handle_wheel_forge(request: web.Request) -> web.Response:
    user = await _authenticate(request, allow_guest=False)
    uid = user["id"]

    success = database.spend_shards_for_pro(uid, cost=config.SHARDS_FOR_PRO)
    if not success and uid != config.OWNER_TELEGRAM_ID:
        return web.json_response(
            {"status": "error", "message": "Недостаточно осколков (нужно 5)."},
            status=400,
        )

    payments.grant_subscription(uid, "shards_forge", config.SHARDS_PRO_DAYS, config.STATS_DB_PATH)
    wheel = database.get_wheel_and_shards(uid)
    database.log_user_event(uid, user["username"], user["first_name"], "forge_shards", "+2_days")

    return web.json_response({
        "status": "ok",
        "shards": wheel["shards"],
        "isPro": True,
        "grantedDays": config.SHARDS_PRO_DAYS,
    })


async def handle_history_get(request: web.Request) -> web.Response:
    user = await _authenticate(request, allow_guest=True)
    uid = user["id"]
    return web.json_response({
        "status": "ok",
        "history": database.get_user_history(uid) if uid else [],
    })


async def handle_history_delete(request: web.Request) -> web.Response:
    user = await _authenticate(request, allow_guest=False)
    uid = user["id"]
    deleted = database.clear_user_history(uid)
    return web.json_response({"status": "ok", "deleted": deleted})


def create_api_app() -> web.Application:
    app = web.Application(middlewares=[security_and_cors_middleware])
    app.router.add_get("/", handle_health)
    app.router.add_get("/health", handle_health)
    app.router.add_get("/api/sync_state", handle_legacy_sync_state)
    app.router.add_post("/api/sync_state", handle_legacy_post_sync_state)
    app.router.add_get("/api/bootstrap", handle_bootstrap)
    app.router.add_post("/api/draw/daily", handle_daily)
    app.router.add_post("/api/daily", handle_daily)
    app.router.add_post("/api/draw/spread", handle_spread_draw)
    app.router.add_post("/api/spreads/draw", handle_spread_draw)
    app.router.add_post("/api/draw/oracle", handle_oracle_ask)
    app.router.add_post("/api/oracle/ask", handle_oracle_ask)
    app.router.add_post("/api/wheel/spin", handle_wheel_spin)
    app.router.add_post("/api/wheel/forge", handle_wheel_forge)
    app.router.add_post("/api/shards/forge", handle_wheel_forge)
    app.router.add_get("/api/history", handle_history_get)
    app.router.add_delete("/api/history", handle_history_delete)
    return app


async def start_api_server() -> web.AppRunner:
    app = create_api_app()
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", config.PORT)
    await site.start()
    logger.info("🌐 Асинхронный REST API сервер KLIM TAROT запущен на порту %s", config.PORT)
    return runner
