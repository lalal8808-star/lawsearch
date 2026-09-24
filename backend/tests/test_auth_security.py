import os
import tempfile
import time
import unittest
import uuid

_database_dir = tempfile.TemporaryDirectory()
os.environ.setdefault("DATABASE_DIR", _database_dir.name)
os.environ.setdefault("SUPABASE_DB_URL", "")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "")
os.environ.setdefault("GOOGLE_API_KEY", "test-only-key")
os.environ.setdefault("SECRET_KEY", "integration-test-secret-key-that-is-long-enough")

import jwt
from fastapi.testclient import TestClient

import auth
import main
from database import SessionLocal, User

SUPABASE_TEST_SECRET = "supabase-test-jwt-secret-that-is-long-enough"


def supabase_token(sub: str, email: str | None) -> str:
    claims = {"sub": sub, "aud": "authenticated", "role": "authenticated", "exp": int(time.time()) + 600}
    if email is not None:
        claims["email"] = email
    return jwt.encode(claims, SUPABASE_TEST_SECRET, algorithm="HS256")


def legacy_token(username: str) -> str:
    return auth.create_access_token({"sub": username})


class AuthSecurityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._saved_overrides = dict(main.app.dependency_overrides)
        main.app.dependency_overrides.clear()
        cls._saved_secret = auth.SUPABASE_JWT_SECRET
        auth.SUPABASE_JWT_SECRET = SUPABASE_TEST_SECRET
        cls.client = TestClient(main.app)

    @classmethod
    def tearDownClass(cls):
        auth.SUPABASE_JWT_SECRET = cls._saved_secret
        main.app.dependency_overrides.update(cls._saved_overrides)

    def setUp(self):
        self.victim_uuid = str(uuid.uuid4())
        self.victim_email = f"victim-{uuid.uuid4().hex[:8]}@example.com"
        db = SessionLocal()
        db.add(User(username=self.victim_email, supabase_id=self.victim_uuid, nickname="victim"))
        db.commit()
        db.close()

    def _victim_supabase_id(self):
        db = SessionLocal()
        try:
            return db.query(User).filter(User.username == self.victim_email).one().supabase_id
        finally:
            db.close()

    def _add_legacy_user(self, username: str, password: str = "legacy-password-1"):
        db = SessionLocal()
        db.add(User(username=username, hashed_password=auth.get_password_hash(password), nickname="legacy"))
        db.commit()
        db.close()

    def test_new_password_signup_is_closed(self):
        response = self.client.post("/auth/signup", data={
            "username": f"new-{uuid.uuid4().hex[:6]}@example.com", "password": "password-123", "nickname": "n",
        })
        self.assertEqual(response.status_code, 410)

    def test_legacy_token_cannot_relink_someone_elses_account(self):
        # 공격: 레거시 계정 토큰으로 sync에 피해자 이메일을 보내 피해자 계정의 supabase_id를
        # 자신의 username으로 바꾸고, 같은 토큰으로 피해자 계정에 로그인한다.
        attacker = f"attacker-{uuid.uuid4().hex[:6]}"
        self._add_legacy_user(attacker)
        token = legacy_token(attacker)
        response = self.client.post(
            "/auth/sync",
            json={"supabase_id": attacker, "username": self.victim_email},
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self._victim_supabase_id(), self.victim_uuid)
        me = self.client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.json()["username"], attacker)

    def test_legacy_token_subject_never_matches_a_supabase_id(self):
        forged = legacy_token(self.victim_uuid)
        self.assertEqual(self.client.get("/auth/me", headers={"Authorization": f"Bearer {forged}"}).status_code, 401)
        # username이 피해자 UUID인 레거시 계정이 있어도 그 레거시 계정으로만 해석된다.
        self._add_legacy_user(self.victim_uuid)
        me = self.client.get("/auth/me", headers={"Authorization": f"Bearer {forged}"})
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.json()["username"], self.victim_uuid)

    def test_supabase_sync_requires_the_token_email(self):
        other = str(uuid.uuid4())
        for email in (None, "", "someone-else@example.com"):
            response = self.client.post(
                "/auth/sync",
                json={"supabase_id": other, "username": self.victim_email},
                headers={"Authorization": f"Bearer {supabase_token(other, email)}"},
            )
            self.assertEqual(response.status_code, 403, email)
        self.assertEqual(self._victim_supabase_id(), self.victim_uuid)

    def test_verified_google_login_takes_over_a_prehijacked_legacy_account(self):
        # 선점 공격: 공격자가 피해자 이메일로 레거시 계정을 먼저 만들어 둔 경우.
        email = f"future-{uuid.uuid4().hex[:6]}@example.com"
        self._add_legacy_user(email, password="attacker-password")
        attacker_token = legacy_token(email)
        self.assertEqual(self.client.get("/auth/me", headers={"Authorization": f"Bearer {attacker_token}"}).status_code, 200)

        owner_uuid = str(uuid.uuid4())
        synced = self.client.post(
            "/auth/sync",
            json={"supabase_id": owner_uuid, "username": email},
            headers={"Authorization": f"Bearer {supabase_token(owner_uuid, email)}"},
        )
        self.assertEqual(synced.status_code, 200)
        owner = self.client.get("/auth/me", headers={"Authorization": f"Bearer {supabase_token(owner_uuid, email)}"})
        self.assertEqual(owner.status_code, 200)
        # 연결 이후에는 선점자의 기존 토큰도 비밀번호 로그인도 통하지 않는다.
        self.assertEqual(self.client.get("/auth/me", headers={"Authorization": f"Bearer {attacker_token}"}).status_code, 401)
        login = self.client.post("/auth/login", data={"username": email, "password": "attacker-password"})
        self.assertEqual(login.status_code, 400)

    def test_manual_global_legal_watch_trigger_is_removed(self):
        token = supabase_token(self.victim_uuid, self.victim_email)
        response = self.client.post("/legal-watch/check", headers={"Authorization": f"Bearer {token}"})
        self.assertIn(response.status_code, (404, 405))


if __name__ == "__main__":
    unittest.main()
