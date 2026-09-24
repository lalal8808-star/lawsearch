import asyncio
import os
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest import mock

_database_dir = tempfile.TemporaryDirectory()
os.environ.setdefault("DATABASE_DIR", _database_dir.name)
os.environ.setdefault("SUPABASE_DB_URL", "")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "")
os.environ.setdefault("GOOGLE_API_KEY", "test-only-key")
os.environ.setdefault("SECRET_KEY", "integration-test-secret-key-that-is-long-enough")

from fastapi.testclient import TestClient

import auth
import main
import uuid

from database import GenerationJob, RateLimit, SessionLocal, User

STEP_SECONDS = 0.3


async def slow(value):
    await asyncio.sleep(STEP_SECONDS)
    return value


class QueryContextTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        db = SessionLocal()
        user = User(username="qc-test@example.com", supabase_id="qc-test-user")
        db.add(user)
        db.commit()
        cls.user_id = user.id
        db.close()
        main.app.dependency_overrides[auth.get_current_user] = lambda: SimpleNamespace(id=cls.user_id)
        cls.client = TestClient(main.app)

    @classmethod
    def tearDownClass(cls):
        main.app.dependency_overrides.pop(auth.get_current_user, None)

    def setUp(self):
        db = SessionLocal()
        db.query(RateLimit).delete()
        db.commit()
        db.close()

    def test_independent_steps_run_concurrently_and_duplicates_are_merged(self):
        rows = [
            {"content": "근로기준법 제26조 해고의 예고", "metadata": {"type": "law", "source": "근로기준법", "article_no": "제26조"}, "similarity": 0.9},
            {"content": "근로기준법 제26조 해고의 예고", "metadata": {"type": "law", "source": "근로기준법", "article_no": "제26조"}, "similarity": 0.9},
            {"content": "대법원 판례 해고 예고수당", "metadata": {"type": "precedent", "source": "해고예고수당 청구"}, "similarity": 0.8},
        ]
        fake_sync = SimpleNamespace(
            sync_required_laws=lambda q: slow(0),
            sync_related_precedents=lambda q: slow(1),
        )
        fake_embeddings = SimpleNamespace(aembed_query=lambda q: slow([0.1] * 768))
        with mock.patch.object(main, "knowledge_sync", fake_sync), \
                mock.patch.object(main.rag_engine, "detect_intent", lambda q: slow("REPORT")), \
                mock.patch.object(main.rag_engine, "embeddings", fake_embeddings), \
                mock.patch.object(main, "search_documents", lambda *a, **k: (rows, "sql")):
            started = time.perf_counter()
            response = self.client.get("/query-context", params={"query": "해고 예고 없이 해고"})
            elapsed = time.perf_counter() - started

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["intent"], "REPORT")
        # 순차 실행이면 4 × 0.3초 = 1.2초 이상이다.
        self.assertLess(elapsed, STEP_SECONDS * 2.5)
        self.assertEqual(body["context"].count("해고의 예고"), 1)
        self.assertEqual([s["source"] for s in body["sources"]], ["근로기준법", "해고예고수당 청구"])

    def test_sub_stage_progress_is_recorded_on_the_running_job(self):
        job_id = str(uuid.uuid4())
        db = SessionLocal()
        db.add(GenerationJob(id=job_id, user_id=self.user_id, query="q", kind="consultation",
                             model="m", status="running", stage="관련 법령·소스 검색", progress=20))
        db.commit()
        db.close()
        fake_sync = SimpleNamespace(
            sync_required_laws=lambda q: slow(0),
            sync_related_precedents=lambda q: slow(0),
        )
        with mock.patch.object(main, "knowledge_sync", fake_sync), \
                mock.patch.object(main.rag_engine, "detect_intent", lambda q: slow("CHAT")), \
                mock.patch.object(main.rag_engine, "embeddings", SimpleNamespace(aembed_query=lambda q: slow([0.1]))), \
                mock.patch.object(main, "search_documents", lambda *a, **k: ([], "sql")):
            response = self.client.get("/query-context", params={"query": "질의", "job_id": job_id})
        self.assertEqual(response.status_code, 200)

        deadline = time.time() + 3
        job = None
        while time.time() < deadline:
            db = SessionLocal()
            job = db.query(GenerationJob).filter(GenerationJob.id == job_id).one()
            db.close()
            if job.progress >= 45:
                break
            time.sleep(0.05)
        self.assertEqual(job.progress, 45)
        self.assertEqual(job.stage, "근거 자료 정리 중")


if __name__ == "__main__":
    unittest.main()
