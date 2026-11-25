"""
Асинхронный HTTP + REST API сервер KLIM TAROT на базе aiohttp.web.
Работает в одном event loop с Telegram-ботом:
  • /health — проверка состояния для Render
  • /api/*  — защищённое API для Telegram Mini App с проверкой initData (HMAC-SHA256)
  • /*      — раздача статики Mini App (webapp/) с корректными UTF-8 MIME-типами
"""

import logging
import mimetypes
import time
from collections import defaultdict, deque
from pathlib import Path

from aiohttp import web

import auth
import config
import database
import payments
import tarot_engine

logger = logging.getLogger(__name__)
TELEGRAM_BOT_KEY = web.AppKey("telegram_bot", object)

mimetypes.add_type("application/javascript; charset=utf-8", ".js")
mimetypes.add_type("text/css; charset=utf-8", ".css")
mimetypes.add_type("text/html; charset=utf-8", ".html")
mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("image/svg+xml", ".svg")

# Простой скользящий rate-limiter в памяти: ключ -> deque[timestamp]
_RATE_BUCKETS: dict[str, deque[float]] = defaultdict(deque)
RATE_LIMIT_MAX = 90
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


def _cors_origin(request: web.Request) -> str:
    origin = request.headers.get("Origin", "")
    if "*" in config.ALLOWED_ORIGINS:
        return origin or "*"
    if origin in config.ALLOWED_ORIGINS:
        return origin
    return config.ALLOWED_ORIGINS[0] if config.ALLOWED_ORIGINS else "*"


@web.middleware
async def security_and_cors_middleware(request: web.Request, handler):
    origin = _cors_origin(request)
    cors_headers = {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Telegram-Init-Data, X-Dev-User-Id",
        "Access-Control-Max-Age": "86400",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
    }

    if request.method == "OPTIONS":
        return web.Response(status=204, headers=cors_headers)

    if request.path.startswith("/api/"):
        client_ip = request.remote or "unknown"
        if _is_rate_limited(client_ip):
            return web.json_response(
                {"error": "rate_limited", "message": "Слишком много запросов. Подождите минуту."},
                status=429,
                headers=cors_headers,
            )

    try:
        response = await handler(request)
    except web.HTTPException as exc:
        response = web.json_response({"error": exc.reason}, status=exc.status)
    except Exception as exc:
        logger.exception("Unhandled API error on %s: %s", request.path, exc)
        response = web.json_response(
            {"error": "internal_error", "message": "Внутренняя ошибка сервера"},
            status=500,
        )

    for k, v in cors_headers.items():
        response.headers[k] = v
    return response


def _user_pro_status(user_id: int) -> tuple[bool, str | None]:
    if user_id in config.ADMIN_IDS:
        return True, None
    sub = payments.get_subscription(user_id, config.STATS_DB_PATH)
    if sub:
        return True, sub["expires_str"]
    return False, None


async def _authenticate(request: web.Request) -> dict:
    """
    Проверяет Telegram WebApp initData и возвращает словарь пользователя {id, username, first_name}.
    Бросает HTTPUnauthorized / HTTPForbidden при нарушении.
    """
    init_data = request.headers.get("X-Telegram-Init-Data", "").strip()
    user_info: dict | None = None

    if init_data:
        parsed = auth.verify_telegram_init_data(init_data, config.BOT_TOKEN)
        if not parsed or not isinstance(parsed.get("user"), dict):
            raise web.HTTPUnauthorized(reason="invalid_init_data")
        u = parsed["user"]
        user_info = {
            "id": int(u["id"]),
            "username": u.get("username") or "",
            "first_name": u.get("first_name") or "Таролог",
        }
    elif config.ALLOW_DEV_AUTH:
        dev_id = request.headers.get("X-Dev-User-Id", "").strip()
        if dev_id.isdigit():
            user_info = {
                "id": int(dev_id),
                "username": "dev_user",
                "first_name": "Dev",
            }

    if not user_info:
        raise web.HTTPUnauthorized(reason="auth_required")

    uid = user_info["id"]
    if database.is_user_banned(uid):
        raise web.HTTPForbidden(reason="user_banned")

    database.upsert_user(uid, user_info["username"], user_info["first_name"])
    return user_info


def _parse_tz_offset(raw) -> int | None:
    if raw is None or raw == "":
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


async def handle_health(request: web.Request) -> web.Response:
    return web.json_response({"status": "ok", "service": "klim-tarot"})


async def handle_bootstrap(request: web.Request) -> web.Response:
    user = await _authenticate(request)
    uid = user["id"]
    tz_offset = _parse_tz_offset(request.query.get("tzOffset"))
    period = tarot_engine.get_day_night_period(tz_offset)

    is_pro, pro_expires = _user_pro_status(uid)
    wheel_info = database.get_wheel_and_shards(uid)
    cooldowns_ms = database.get_all_cooldowns_ms(uid)

    daily_row = database.get_daily_card(uid, period["periodKey"])
    daily_payload = None
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
        "user": {
            "id": uid,
            "username": user["username"],
            "firstName": user["first_name"],
            "isPro": is_pro,
            "proExpires": pro_expires,
            "isAdmin": uid in config.ADMIN_IDS,
            "shards": wheel_info["shards"],
            "wheelCooldownMs": wheel_info["wheel_cooldown_ms"],
            "cooldownsMs": cooldowns_ms,
        },
        "period": period,
        "dailyCard": daily_payload,
        "history": database.get_user_history(uid),
        "leaderboard": database.get_referral_leaderboard(limit=10),
        "catalog": {
            "cards": tarot_engine.ALL_CARDS,
            "spreads": tarot_engine.SPREADS_LIST,
            "categories": tarot_engine.CATEGORIES,
            "positionLeads": tarot_engine.POSITION_LEADS,
        },
    })


async def handle_daily(request: web.Request) -> web.Response:
    user = await _authenticate(request)
    uid = user["id"]
    body = await request.json() if request.can_read_body else {}
    tz_offset = _parse_tz_offset(body.get("tzOffset"))
    period = tarot_engine.get_day_night_period(tz_offset)

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

    card, rev = tarot_engine.draw_cards(1, allow_reversed=True, rev_prob=0.25)[0]
    database.save_daily_card(uid, period["periodKey"], card["id"], rev)
    synthesis = tarot_engine.build_synthesis_structured(
        period["title"], [period["position"]], [(card, rev)]
    )
    database.save_reading(
        user_id=uid,
        spread_key="card_of_day",
        spread_name=period["title"],
        cards=[{"id": card["id"], "reversed": rev}],
        synthesis=synthesis,
        source="webapp",
    )
    database.log_user_event(uid, user["username"], user["first_name"], "Mini App: Карта дня", card["name"])

    return web.json_response({
        "card": card,
        "reversed": rev,
        "already": False,
        "period": period,
        "synthesis": synthesis,
    })


async def handle_spread_draw(request: web.Request) -> web.Response:
    user = await _authenticate(request)
    uid = user["id"]
    body = await request.json()

    spread_key = str(body.get("spreadKey") or "").strip()
    custom_topic = str(body.get("customTopic") or "").strip()[:120]
    friend_name = str(body.get("friendName") or "").strip()[:60] or None
    question = str(body.get("question") or "").strip()[:240]
    deck_mode = str(body.get("deckMode") or "all").strip()
    rev_prob = body.get("revProb", 0.33)

    is_pro, _ = _user_pro_status(uid)
    if not is_pro:
        deck_mode = "all"
        rev_prob = 0.25
        if spread_key == "custom_topic":
            return web.json_response(
                {"error": "pro_required", "message": "Своя тема доступна только в режиме PRO"},
                status=403,
            )

    cd_kind = "friend" if friend_name else "spread"
    if not is_pro:
        rem = database.check_cooldown(uid, cd_kind)
        if rem > 0:
            return web.json_response(
                {"error": "cooldown", "kind": cd_kind, "remainingMs": rem * 1000},
                status=429,
            )

    if spread_key == "custom_topic":
        if not custom_topic:
            return web.json_response({"error": "bad_request", "message": "Укажите тему расклада"}, status=400)
        count = max(1, min(7, int(body.get("customCount") or 3)))
        positions = [f"Позиция {i + 1}" for i in range(count)]
        spread_name = f"Своя тема: {custom_topic}"
        spread_desc = "Персональный расклад (PRO)"
    else:
        spread = tarot_engine.SPREADS.get(spread_key)
        if not spread:
            return web.json_response({"error": "not_found", "message": "Расклад не найден"}, status=404)
        positions = spread["positions"]
        count = int(spread.get("count") or len(positions))
        spread_name = spread["name"]
        spread_desc = spread["desc"]

    drawn = tarot_engine.draw_cards(count, allow_reversed=True, deck_mode=deck_mode, rev_prob=rev_prob)
    synthesis = tarot_engine.build_synthesis_structured(spread_name, positions, drawn)

    cards_compact = [{"id": c["id"], "reversed": rev} for c, rev in drawn]
    reading_id = database.save_reading(
        user_id=uid,
        spread_key=spread_key,
        spread_name=spread_name,
        cards=cards_compact,
        friend_name=friend_name,
        question=question or custom_topic,
        synthesis=synthesis,
        source="webapp",
    )
    if not is_pro:
        database.mark_cooldown(uid, cd_kind)
    database.log_user_event(uid, user["username"], user["first_name"], "Mini App: Расклад", spread_name)

    return web.json_response({
        "id": reading_id,
        "spreadKey": spread_key,
        "spreadName": spread_name,
        "spreadDesc": spread_desc,
        "positions": positions,
        "drawn": [{"card": c, "reversed": rev} for c, rev in drawn],
        "friendName": friend_name,
        "question": question or custom_topic,
        "synthesis": synthesis,
        "cooldownsMs": database.get_all_cooldowns_ms(uid),
    })


async def handle_oracle_ask(request: web.Request) -> web.Response:
    user = await _authenticate(request)
    uid = user["id"]
    body = await request.json() if request.can_read_body else {}
    question = str(body.get("question") or "").strip()[:240]
    is_pro, _ = _user_pro_status(uid)

    if not is_pro:
        rem = database.check_cooldown(uid, "oracle")
        if rem > 0:
            return web.json_response(
                {"error": "cooldown", "kind": "oracle", "remainingMs": rem * 1000},
                status=429,
            )

    deck_mode = str(body.get("deckMode") or "all") if is_pro else "all"
    rev_prob = body.get("revProb", 0.33) if is_pro else 0.25
    card, rev = tarot_engine.draw_cards(1, allow_reversed=True, deck_mode=deck_mode, rev_prob=rev_prob)[0]
    _, verdict_plain, verdict_class, energy_note = tarot_engine.yes_no_verdict(card, rev)

    database.save_reading(
        user_id=uid,
        spread_key="oracle_yesno",
        spread_name=f"Да / Нет → {verdict_plain}",
        cards=[{"id": card["id"], "reversed": rev}],
        question=question,
        source="webapp",
    )
    if not is_pro:
        database.mark_cooldown(uid, "oracle")
    database.log_user_event(uid, user["username"], user["first_name"], "Mini App: Оракул", verdict_plain)

    return web.json_response({
        "card": card,
        "reversed": rev,
        "verdict": verdict_plain,
        "verdictClass": verdict_class,
        "energyNote": energy_note,
        "question": question,
        "cooldownsMs": database.get_all_cooldowns_ms(uid),
    })


async def handle_history_get(request: web.Request) -> web.Response:
    user = await _authenticate(request)
    return web.json_response({"history": database.get_user_history(user["id"])})


async def handle_history_delete(request: web.Request) -> web.Response:
    user = await _authenticate(request)
    deleted = database.clear_user_history(user["id"])
    return web.json_response({"deleted": deleted})


async def handle_wheel_spin(request: web.Request) -> web.Response:
    user = await _authenticate(request)
    uid = user["id"]
    wheel_info = database.get_wheel_and_shards(uid)
    if wheel_info["wheel_cooldown_ms"] > 0:
        return web.json_response(
            {"error": "cooldown", "wheelCooldownMs": wheel_info["wheel_cooldown_ms"]},
            status=429,
        )

    prize = tarot_engine.spin_fortune_wheel()
    shards_delta = int(prize.get("val", 0)) if prize["type"] == "shard" else 0
    updated = database.record_wheel_spin(uid, shards_delta=shards_delta)
    database.log_user_event(uid, user["username"], user["first_name"], "Mini App: Колесо", prize["label"])

    return web.json_response({
        "sectorIndex": prize["index"],
        "prize": prize,
        "shards": updated["shards"],
        "wheelCooldownMs": updated["wheel_cooldown_ms"],
    })


async def handle_wheel_forge(request: web.Request) -> web.Response:
    user = await _authenticate(request)
    uid = user["id"]
    ok = database.spend_shards_for_pro(uid, cost=config.SHARDS_FOR_PRO)
    if not ok:
        return web.json_response(
            {"error": "insufficient_shards", "message": f"Нужно минимум {config.SHARDS_FOR_PRO} осколков"},
            status=400,
        )
    exp = payments.grant_subscription(uid, "shards_forge", config.SHARDS_PRO_DAYS)
    wheel_info = database.get_wheel_and_shards(uid)
    database.log_user_event(uid, user["username"], user["first_name"], "Mini App: Крафт PRO", "+2 дня")
    return web.json_response({
        "shards": wheel_info["shards"],
        "isPro": True,
        "proExpires": exp.strftime("%d.%m.%Y %H:%M МСК"),
    })


async def handle_send_reading_to_chat(request: web.Request) -> web.Response:
    user = await _authenticate(request)
    bot = request.app.get(TELEGRAM_BOT_KEY)
    if not bot:
        return web.json_response({"error": "bot_unavailable"}, status=503)
    body = await request.json()
    summary = str(body.get("summary") or "").strip()
    if not summary:
        return web.json_response({"error": "empty_summary"}, status=400)
    if "@MysticalTarotKlimBot" not in summary:
        summary += "\n\n🔮 KLIM TAROT · @MysticalTarotKlimBot"
    await bot.send_message(chat_id=user["id"], text=summary[:4000])
    return web.json_response({"sent": True})


async def handle_static_webapp(request: web.Request) -> web.StreamResponse:
    rel = request.match_info.get("path", "").lstrip("/")
    if not rel:
        rel = "index.html"
    webapp_root = config.WEBAPP_DIR.resolve()
    target = (webapp_root / rel).resolve()
    if webapp_root not in target.parents and target != webapp_root:
        raise web.HTTPForbidden()
    if target.is_dir():
        target = target / "index.html"
    if not target.exists() or not target.is_file():
        raise web.HTTPNotFound()
    resp = web.FileResponse(target)
    resp.headers["Cache-Control"] = "no-cache"
    return resp


def create_web_app(telegram_bot=None) -> web.Application:
    app = web.Application(middlewares=[security_and_cors_middleware])
    app[TELEGRAM_BOT_KEY] = telegram_bot

    app.router.add_get("/health", handle_health)
    app.router.add_get("/api/bootstrap", handle_bootstrap)
    app.router.add_post("/api/daily", handle_daily)
    app.router.add_post("/api/spreads/draw", handle_spread_draw)
    app.router.add_post("/api/oracle/ask", handle_oracle_ask)
    app.router.add_get("/api/history", handle_history_get)
    app.router.add_delete("/api/history", handle_history_delete)
    app.router.add_post("/api/wheel/spin", handle_wheel_spin)
    app.router.add_post("/api/wheel/forge", handle_wheel_forge)
    app.router.add_post("/api/reading/send", handle_send_reading_to_chat)

    app.router.add_get("/", handle_static_webapp)
    app.router.add_get("/{path:.*}", handle_static_webapp)
    return app


async def start_api_server(telegram_bot=None) -> web.AppRunner:
    """Запускает aiohttp-сервер в текущем asyncio event loop."""
    web_app = create_web_app(telegram_bot=telegram_bot)
    runner = web.AppRunner(web_app, access_log=None)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", config.PORT)
    await site.start()
    logger.info("🌐 API и WebApp-сервер запущен на http://0.0.0.0:%s", config.PORT)
    return runner
