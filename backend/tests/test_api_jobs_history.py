import os
import tempfile
import unittest
from types import SimpleNamespace

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
from database import GenerationJob, RateLimit, Report, SessionLocal, User


class JobsHistoryApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        db = SessionLocal()
        user = User(username="api-test@example.com", supabase_id="api-test-user")
        db.add(user)
        db.commit()
        db.refresh(user)
        cls.user_id = user.id
        db.close()
        main.app.dependency_overrides[auth.get_current_user] = lambda: SimpleNamespace(id=cls.user_id)
        cls.client = TestClient(main.app)

    @classmethod
    def tearDownClass(cls):
        main.app.dependency_overrides.pop(auth.get_current_user, None)

    def setUp(self):
        db = SessionLocal()
        db.query(Report).delete()
        db.query(GenerationJob).delete()
        db.query(RateLimit).delete()
        db.commit()
        db.close()

    def test_job_report_history_and_usage_round_trip(self):
        response = self.client.post("/jobs", json={
            "query": "변전공사 인허가 기준",
            "kind": "consultation",
            "model": "openai/gpt-5.6-sol",
        })
        self.assertEqual(response.status_code, 200)
        job_id = response.json()["id"]

        response = self.client.patch(f"/jobs/{job_id}", json={
            "status": "generated",
            "stage": "생성 완료",
            "progress": 90,
            "result": "## 결론\n검토 결과",
            "token_usage": {"inputTokens": 100, "outputTokens": 50, "totalTokens": 150},
        })
        self.assertEqual(response.status_code, 200)

        response = self.client.post("/history", json={
            "query": "변전공사 인허가 기준",
            "answer": "## 법률 분석\n산업안전보건법 제38조\n## 결론\n검토 필요",
            "sources": [{"source": "산업안전보건법", "type": "law", "article_no": "제38조"}],
            "client_request_id": job_id,
            "generation_job_id": job_id,
        })
        self.assertEqual(response.status_code, 200)
        report_id = response.json()["id"]

        history = self.client.get("/history", params={"q": "변전공사", "page": 1, "limit": 20})
        self.assertEqual(history.status_code, 200)
        self.assertEqual(history.json()["total"], 1)
        self.assertNotIn("answer", history.json()["items"][0])

        chat = self.client.put(f"/history/{report_id}/chat", json={"messages": [
            {"role": "user", "content": "추가 질문"},
            {"role": "assistant", "content": "추가 답변"},
        ]})
        self.assertEqual(chat.status_code, 200)

        usage = self.client.get("/usage")
        self.assertEqual(usage.status_code, 200)
        self.assertEqual(usage.json()["total_tokens"], 150)
        linked = self.client.get(f"/jobs/{job_id}").json()
        self.assertEqual(linked["status"], "complete")
        self.assertEqual(linked["report_id"], report_id)

    def test_generated_report_survives_late_client_stream_error(self):
        response = self.client.post("/jobs", json={
            "query": "변전공사 인허가 기준",
            "kind": "consultation",
            "model": "openai/gpt-5.6-sol",
        })
        self.assertEqual(response.status_code, 200)
        job_id = response.json()["id"]

        generated = self.client.patch(f"/jobs/{job_id}", json={
            "status": "generated",
            "stage": "보고서 생성 완료·저장 대기",
            "progress": 90,
            "intent": "REPORT",
            "result": "## 법률 분석\n산업안전보건법 제38조\n## 결론\n검토 결과",
            "sources": [{"source": "산업안전보건법", "type": "law"}],
        })
        self.assertEqual(generated.status_code, 200)

        late_error = self.client.patch(f"/jobs/{job_id}", json={
            "status": "error",
            "stage": "클라이언트 수신 실패",
            "error": "Load failed",
        })
        self.assertEqual(late_error.status_code, 200)
        self.assertEqual(late_error.json()["status"], "generated")
        self.assertEqual(late_error.json()["stage"], "보고서 생성 완료·저장 대기")
        self.assertIn("법률 분석", late_error.json()["result"])

        recoverable = self.client.get("/jobs", params={"recoverable": True, "limit": 3})
        self.assertEqual(recoverable.status_code, 200)
        self.assertIn(job_id, [item["id"] for item in recoverable.json()["items"]])

    def _create_job(self):
        response = self.client.post("/jobs", json={"query": "질의", "kind": "consultation"})
        self.assertEqual(response.status_code, 200)
        return response.json()["id"]

    def test_job_can_be_started_only_once(self):
        job_id = self._create_job()
        started = self.client.post(f"/jobs/{job_id}/start")
        self.assertEqual(started.status_code, 200)
        self.assertEqual(started.json()["status"], "running")
        self.assertEqual(self.client.post(f"/jobs/{job_id}/start").status_code, 409)
        # 끝난 작업을 대기 상태로 되돌려 다시 시작하는 것도 막는다.
        self.assertEqual(self.client.patch(f"/jobs/{job_id}", json={"status": "complete"}).status_code, 200)
        self.assertEqual(self.client.patch(f"/jobs/{job_id}", json={"status": "queued"}).status_code, 409)
        self.assertEqual(self.client.patch(f"/jobs/{job_id}", json={"status": "running"}).status_code, 409)
        self.assertEqual(self.client.post(f"/jobs/{job_id}/start").status_code, 409)

    def test_recorded_usage_cannot_be_lowered(self):
        job_id = self._create_job()
        self.client.post(f"/jobs/{job_id}/start")
        self.client.patch(f"/jobs/{job_id}", json={"token_usage": {"inputTokens": 900, "outputTokens": 100, "totalTokens": 1000}})
        lowered = self.client.patch(f"/jobs/{job_id}", json={"status": "complete", "token_usage": {"totalTokens": 0}})
        self.assertEqual(lowered.status_code, 200)
        self.assertEqual(lowered.json()["status"], "complete")
        self.assertEqual(self.client.get("/usage").json()["total_tokens"], 1000)

    def test_start_rechecks_the_monthly_limit(self):
        pending = self._create_job()
        spent = self._create_job()
        self.client.post(f"/jobs/{spent}/start")
        previous = os.environ.get("MONTHLY_AI_TOKEN_LIMIT")
        os.environ["MONTHLY_AI_TOKEN_LIMIT"] = "500"
        try:
            self.client.patch(f"/jobs/{spent}", json={"status": "complete", "token_usage": {"totalTokens": 600}})
            self.assertEqual(self.client.post(f"/jobs/{pending}/start").status_code, 429)
            self.assertEqual(self.client.post("/jobs", json={"query": "질의"}).status_code, 429)
        finally:
            if previous is None:
                os.environ.pop("MONTHLY_AI_TOKEN_LIMIT", None)
            else:
                os.environ["MONTHLY_AI_TOKEN_LIMIT"] = previous


if __name__ == "__main__":
    unittest.main()
