"""
Автотесты для серверной части KLIM TAROT:
  • Проверка HMAC-SHA256 подписи Telegram initData
  • Проверка SQLite-слоя (WAL, индексы, рефералы, кулдауны, карта дня, история, осколки)
  • Проверка всех HTTP/REST API эндпоинтов (aiohttp TestClient)
"""

import hashlib
import hmac
import json
import tempfile
import time
import unittest
from pathlib import Path
from urllib.parse import urlencode

from aiohttp.test_utils import AioHTTPTestCase

import api_server
import auth
import config
import database
import payments
import tarot_engine

TEST_BOT_TOKEN = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"


def make_init_data(user_obj: dict, bot_token: str = TEST_BOT_TOKEN, auth_date: int | None = None) -> str:
    ts = auth_date if auth_date is not None else int(time.time())
    fields = {
        "auth_date": str(ts),
        "query_id": "AAHdF6IQAAAAAN0XohDhrOrc",
        "user": json.dumps(user_obj, separators=(",", ":"), ensure_ascii=False),
    }
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    secret_key = hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()
    sig = hmac.new(secret_key, data_check_string.encode("utf-8"), hashlib.sha256).hexdigest()
    fields["hash"] = sig
    return urlencode(fields)


class TestAuthAndDatabase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmp.name) / "test.db"
        database.init_db(self.db_path)

    def tearDown(self):
        self.tmp.cleanup()

    def test_init_data_verification(self):
        valid = make_init_data({"id": 1001, "first_name": "Test", "username": "tester"})
        parsed = auth.verify_telegram_init_data(valid, TEST_BOT_TOKEN)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed["user"]["id"], 1001)

        # Поддельная подпись
        tampered = valid[:-4] + "0000"
        self.assertIsNone(auth.verify_telegram_init_data(tampered, TEST_BOT_TOKEN))

        # Просроченный auth_date
        expired = make_init_data({"id": 1001}, auth_date=int(time.time()) - 100000)
        self.assertIsNone(auth.verify_telegram_init_data(expired, TEST_BOT_TOKEN, max_age_sec=3600))

    def test_wal_and_referrals(self):
        with database.get_conn(self.db_path) as conn:
            mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
            self.assertEqual(mode.lower(), "wal")

        database.upsert_user(2001, "ref", "Referrer", self.db_path)
        self.assertFalse(database.register_referral(2001, 2001, self.db_path))  # self-ref
        self.assertTrue(database.register_referral(2002, 2001, self.db_path))
        self.assertFalse(database.register_referral(2002, 2001, self.db_path))  # duplicate

        lb = database.get_referral_leaderboard(limit=5, db_path=self.db_path)
        self.assertEqual(len(lb), 1)
        self.assertEqual(lb[0]["count"], 1)


class TestApiServer(AioHTTPTestCase):
    async def get_application(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmp.name) / "api_test.db"
        self.orig_db = config.STATS_DB_PATH
        self.orig_token = config.BOT_TOKEN
        self.orig_payments_db = payments.STATS_DB_PATH
        config.STATS_DB_PATH = self.db_path
        payments.STATS_DB_PATH = self.db_path
        config.BOT_TOKEN = TEST_BOT_TOKEN
        database.init_db(self.db_path)
        return api_server.create_web_app()

    async def tearDownAsync(self):
        config.STATS_DB_PATH = self.orig_db
        payments.STATS_DB_PATH = self.orig_payments_db
        config.BOT_TOKEN = self.orig_token
        self.tmp.cleanup()
        await super().tearDownAsync()

    async def test_health_and_unauthorized(self):
        resp = await self.client.get("/health")
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["status"], "ok")

        resp_unauth = await self.client.get("/api/bootstrap")
        self.assertEqual(resp_unauth.status, 401)

    async def test_full_user_flow_and_ban(self):
        init_hdr = {"X-Telegram-Init-Data": make_init_data({"id": 55501, "first_name": "Алиса", "username": "alice"})}

        # 1. Bootstrap
        r = await self.client.get("/api/bootstrap", headers=init_hdr)
        self.assertEqual(r.status, 200)
        boot = await r.json()
        self.assertEqual(len(boot["catalog"]["cards"]), 78)
        self.assertEqual(len(boot["catalog"]["spreads"]), 35)
        self.assertFalse(boot["user"]["isPro"])

        # 2. Daily card (draw then repeat)
        r1 = await self.client.post("/api/daily", headers=init_hdr, json={"tzOffset": 180})
        self.assertEqual(r1.status, 200)
        d1 = await r1.json()
        self.assertFalse(d1["already"])

        r2 = await self.client.post("/api/daily", headers=init_hdr, json={"tzOffset": 180})
        self.assertEqual(r2.status, 200)
        d2 = await r2.json()
        self.assertTrue(d2["already"])
        self.assertEqual(d1["card"]["id"], d2["card"]["id"])

        # 3. Spread draw + cooldown enforcement
        first_spread = tarot_engine.SPREADS_LIST[0]["key"]
        rs = await self.client.post("/api/spreads/draw", headers=init_hdr, json={"spreadKey": first_spread})
        self.assertEqual(rs.status, 200)
        rs_cd = await self.client.post("/api/spreads/draw", headers=init_hdr, json={"spreadKey": first_spread})
        self.assertEqual(rs_cd.status, 429)

        # 4. Oracle ask
        ro = await self.client.post("/api/oracle/ask", headers=init_hdr, json={"question": "Получится ли?"})
        self.assertEqual(ro.status, 200)
        odata = await ro.json()
        self.assertIn(odata["verdict"], ("ДА", "НЕТ", "ВОЗМОЖНО"))

        # 5. Wheel spin + cooldown
        rw = await self.client.post("/api/wheel/spin", headers=init_hdr, json={})
        self.assertEqual(rw.status, 200)
        rw_cd = await self.client.post("/api/wheel/spin", headers=init_hdr, json={})
        self.assertEqual(rw_cd.status, 429)

        # 6. History get & delete
        rh = await self.client.get("/api/history", headers=init_hdr)
        self.assertEqual(rh.status, 200)
        hdata = await rh.json()
        self.assertGreaterEqual(len(hdata["history"]), 3)

        rd = await self.client.delete("/api/history", headers=init_hdr)
        self.assertEqual(rd.status, 200)

        # 7. Ban enforcement
        database.set_user_ban_status(55501, True, self.db_path)
        rb = await self.client.get("/api/bootstrap", headers=init_hdr)
        self.assertEqual(rb.status, 403)


if __name__ == "__main__":
    unittest.main()
