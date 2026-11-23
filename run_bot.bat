@echo off
chcp 65001 > nul
title KLIM TAROT BOT
echo ========================================================
echo   Запуск Telegram-бота KLIM TAROT (@MysticalTarotKlimBot)
echo ========================================================
echo.
cd /d "%~dp0tarot-bot"
python -u bot.py
pause
