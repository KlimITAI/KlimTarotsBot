"""
Криптографическая проверка Telegram WebApp initData (HMAC-SHA256)
согласно официальной спецификации Telegram Bot API.
"""

import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl


def verify_telegram_init_data(
    init_data: str,
    bot_token: str,
    max_age_sec: int = 86400,
) -> dict | None:
    """
    Проверяет подпись `initData` от Telegram Mini App.
    Возвращает словарь с распарсенными полями (включая `user` dict) или None при ошибке.
    """
    if not init_data or not bot_token:
        return None

    try:
        pairs = dict(parse_qsl(init_data, keep_blank_values=True))
    except ValueError:
        return None

    received_hash = pairs.pop("hash", None)
    if not received_hash:
        return None

    # Проверка свежести auth_date
    auth_date_raw = pairs.get("auth_date")
    if auth_date_raw and auth_date_raw.isdigit():
        auth_date = int(auth_date_raw)
        if max_age_sec > 0 and (time.time() - auth_date) > max_age_sec:
            return None

    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
    secret_key = hmac.new(
        b"WebAppData",
        bot_token.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    expected_hash = hmac.new(
        secret_key,
        data_check_string.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected_hash, received_hash):
        return None

    result: dict = dict(pairs)
    if "user" in pairs:
        try:
            result["user"] = json.loads(pairs["user"])
        except (json.JSONDecodeError, TypeError):
            return None

    return result
