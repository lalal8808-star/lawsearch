import asyncio
import unittest

from services.knowledge_sync import KnowledgeSync
from services.retrieval import is_visible, search_documents


class FakeRag:
    def __init__(self, existing=()):
        self.existing = set(existing)  # {(field, value, type)}
        self.added = []
        self.fail_exists = False

    def has_document(self, field, value, doc_type=None):
        if self.fail_exists:
            raise RuntimeError("db down")
        return (field, str(value), doc_type) in self.existing

    async def add_documents(self, docs, user_id=None):
        await asyncio.sleep(0.01)
        self.added.extend(docs)
        return len(docs)

    async def detect_required_laws(self, query):
        return ["근로기준법", "중대재해처벌법"]


class FakeLawClient:
    def __init__(self):
        self.detail_calls = []

    async def search_laws(self, name):
        official = {"근로기준법": ("근로기준법", "100"), "중대재해처벌법": ("중대재해 처벌 등에 관한 법률", "200")}[name]
        return {"law": {"법령명한글": official[0], "법령일련번호": official[1]}}

    async def get_law_detail(self, mst):
        self.detail_calls.append(("law", mst))
        return {"mst": mst}

    async def search_precedents(self, query):
        return {"prec": [{"판례일련번호": "p1"}, {"판례일련번호": "p2"}]}

    async def get_precedent_detail(self, prec_id):
        self.detail_calls.append(("precedent", prec_id))
        return {"id": prec_id}


class FakeProcessor:
    @staticmethod
    def process_law_xml(detail, mst):
        return [f"law-{mst}"]

    @staticmethod
    def process_precedent_xml(detail, prec_id):
        return [f"prec-{prec_id}"]


def run(coro):
    return asyncio.run(coro)


class KnowledgeSyncTest(unittest.TestCase):
    def setUp(self):
        self.law_client = FakeLawClient()

    def test_stored_precedents_are_not_fetched_again(self):
        # 판례는 metadata.prec_id로 저장된다. 이전 코드는 mst로 확인해 매번 다시 임베딩했다.
        rag = FakeRag(existing={("prec_id", "p1", "precedent")})
        sync = KnowledgeSync(rag, self.law_client, FakeProcessor)
        self.assertEqual(run(sync.sync_related_precedents("해고 예고")), 1)
        self.assertEqual(self.law_client.detail_calls, [("precedent", "p2")])
        self.assertEqual(rag.added, ["prec-p2"])

    def test_law_known_by_exact_name_or_mst_is_skipped(self):
        rag = FakeRag(existing={("source", "근로기준법", "law"), ("mst", "200", "law")})
        sync = KnowledgeSync(rag, self.law_client, FakeProcessor)
        self.assertEqual(run(sync.sync_required_laws("산재 사고")), 0)
        self.assertEqual(self.law_client.detail_calls, [])

    def test_missing_law_is_added_without_deleting_anything(self):
        rag = FakeRag()
        sync = KnowledgeSync(rag, self.law_client, FakeProcessor)
        self.assertEqual(run(sync.sync_law("중대재해처벌법")), 1)
        self.assertEqual(rag.added, ["law-200"])

    def test_concurrent_requests_add_a_document_once(self):
        rag = FakeRag()
        sync = KnowledgeSync(rag, self.law_client, FakeProcessor)

        async def both():
            return await asyncio.gather(sync.sync_law("근로기준법"), sync.sync_law("근로기준법"))

        self.assertEqual(sorted(run(both())), [0, 1])
        self.assertEqual(rag.added, ["law-100"])

    def test_existence_check_failure_never_inserts(self):
        rag = FakeRag()
        rag.fail_exists = True
        sync = KnowledgeSync(rag, self.law_client, FakeProcessor)
        self.assertEqual(run(sync.sync_required_laws("q")), 0)
        self.assertEqual(run(sync.sync_related_precedents("q")), 0)
        self.assertEqual(rag.added, [])


class RetrievalScopeTest(unittest.TestCase):
    def test_visibility_rules(self):
        active, inactive = {"u-active"}, {"old.pdf"}
        self.assertTrue(is_visible({"type": "law"}, 1, active, inactive))
        self.assertFalse(is_visible({"type": "user_upload", "user_id": 2, "upload_id": "u-active"}, 1, active, inactive))
        self.assertTrue(is_visible({"type": "user_upload", "user_id": 1, "upload_id": "u-active"}, 1, active, inactive))
        self.assertFalse(is_visible({"type": "user_upload", "user_id": 1, "upload_id": "u-archived"}, 1, active, inactive))
        self.assertTrue(is_visible({"type": "user_upload", "user_id": "1", "source": "legacy.pdf"}, 1, active, inactive))
        self.assertFalse(is_visible({"type": "user_upload", "user_id": 1, "source": "old.pdf"}, 1, active, inactive))

    def test_rpc_fallback_filters_other_users_uploads(self):
        rows = [
            {"content": "law", "metadata": {"type": "law"}, "similarity": 0.9},
            {"content": "theirs", "metadata": {"type": "user_upload", "user_id": 2, "upload_id": "x"}, "similarity": 0.95},
            {"content": "mine", "metadata": {"type": "user_upload", "user_id": 1, "upload_id": "a"}, "similarity": 0.8},
        ]

        class Rpc:
            def __init__(self, data):
                self.data = data

            def execute(self):
                return self

        class Client:
            def rpc(self, name, params):
                self.params = params
                return Rpc(rows)

        rag = type("R", (), {"supabase_client": Client()})()
        visible, method = search_documents(None, rag, [0.1], user_id=1, active_upload_ids={"a"}, inactive_legacy_sources=set())
        self.assertEqual(method, "rpc")
        self.assertEqual([r["content"] for r in visible], ["law", "mine"])


if __name__ == "__main__":
    unittest.main()
