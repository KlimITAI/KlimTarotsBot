import os
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TAROT_DIR = os.path.join(BASE_DIR, "tarot-bot")
if TAROT_DIR not in sys.path:
    sys.path.insert(0, TAROT_DIR)
os.chdir(TAROT_DIR)

import bot

if __name__ == "__main__":
    bot.main()
