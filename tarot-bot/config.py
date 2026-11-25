"""
Централизованная конфигурация KLIM TAROT.
Все секреты и настройки загружаются из переменных окружения или .env.
"""

import os
from datetime import timedelta, timezone
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
WEBAPP_DIR = BASE_DIR / "webapp"
STATS_DB_PATH = Path(os.environ.get("STATS_DB_PATH", str(BASE_DIR / "stats.db")))
PROMO_SHARE_PATH = BASE_DIR / "assets" / "promo-share.mp4"


def load_local_env() -> None:
    """Загружает переменные из .env файлов, если они ещё не заданы в окружении."""
    for env_path in (Path(".env"), BASE_DIR / ".env", BASE_DIR.parent / ".env"):
        if not env_path.exists():
            continue
        try:
            for raw_line in env_path.read_text(encoding="utf-8").splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, val = line.split("=", 1)
                key = key.strip()
                val = val.strip().strip("\"'")
                if key and key not in os.environ:
                    os.environ[key] = val
        except OSError:
            pass


load_local_env()

MSK_TZ = timezone(timedelta(hours=3))

BOT_TOKEN = (
    os.environ.get("TELEGRAM_BOT_TOKEN")
    or os.environ.get("BOT_TOKEN")
    or "9210053625:AAHLc9jFQIRkgVN-QPYeKXsUrCKjTyFZk7U"
).strip()

OWNER_TELEGRAM_ID = 7446803539

_raw_admins = os.environ.get("ADMIN_USER_IDS", str(OWNER_TELEGRAM_ID))
ADMIN_IDS: set[int] = {int(x.strip()) for x in _raw_admins.split(",") if x.strip().isdigit()}
ADMIN_IDS.add(OWNER_TELEGRAM_ID)

# Важно: всегда актуальная версия кэша для GitHub Pages
DEFAULT_WEBAPP_URL = "https://klimitai.github.io/KlimTarotsBot/tarot-bot/webapp/?v=53"
WEBAPP_URL = os.environ.get("WEBAPP_URL", DEFAULT_WEBAPP_URL).strip()

PROMO_VIDEO_PUBLIC_URL = os.environ.get(
    "PROMO_VIDEO_PUBLIC_URL",
    "https://klimitai.github.io/KlimTarotsBot/tarot-bot/webapp/assets/promo-share.mp4",
).strip()
PROMO_POSTER_PUBLIC_URL = os.environ.get(
    "PROMO_POSTER_PUBLIC_URL",
    "https://klimitai.github.io/KlimTarotsBot/tarot-bot/webapp/assets/promo-poster.jpg",
).strip()

PORT = int(os.environ.get("PORT", "10000").strip() or "10000")
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",")
    if o.strip()
]

COOLDOWNS_SEC = {
    "spread": int(os.environ.get("COOLDOWN_SPREAD_SEC", str(15 * 60))),
    "oracle": int(os.environ.get("COOLDOWN_ORACLE_SEC", str(5 * 60))),
    "friend": int(os.environ.get("COOLDOWN_FRIEND_SEC", str(10 * 60))),
}

WHEEL_COOLDOWN_SEC = int(os.environ.get("WHEEL_COOLDOWN_SEC", str(24 * 3600)))
SHARDS_FOR_PRO = 5
SHARDS_PRO_DAYS = 2
REFERRAL_PRO_DAYS = 2
HISTORY_LIMIT = 25
