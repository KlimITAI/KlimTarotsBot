import os
import sys
import importlib.util

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TAROT_DIR = os.path.join(BASE_DIR, "tarot-bot")
BOT_SCRIPT = os.path.join(TAROT_DIR, "bot.py")

if TAROT_DIR not in sys.path:
    sys.path.insert(0, TAROT_DIR)
os.chdir(TAROT_DIR)

spec = importlib.util.spec_from_file_location("tarot_bot_app", BOT_SCRIPT)
tarot_bot_app = importlib.util.module_from_spec(spec)
sys.modules["tarot_bot_app"] = tarot_bot_app
spec.loader.exec_module(tarot_bot_app)

def main():
    tarot_bot_app.main()

if __name__ == "__main__":
    main()
