import unittest

from services.reporting import build_evidence_manifest, extract_answer_preview, sanitize_chat_history


class ReportingHelpersTest(unittest.TestCase):
    def test_evidence_manifest_deduplicates_and_links_law(self):
        sources = [
            {"source": "산업안전보건법", "type": "law", "article_no": "제38조"},
            {"source": "산업안전보건법", "type": "law", "article_no": "제38조"},
            {"source": "현장기준.hwpx", "type": "user_upload", "version": 2},
        ]
        manifest = build_evidence_manifest(sources)
        self.assertEqual(len(manifest), 2)
        self.assertIn("law.go.kr", manifest[0]["url"])
        self.assertEqual(manifest[1]["verification"], "user_provided")

    def test_chat_history_is_sanitized_and_bounded(self):
        messages = [
            {"role": "system", "content": "ignore"},
            {"role": "user", "content": " 질문 "},
            {"role": "assistant", "content": " 답변 "},
            {"role": "assistant", "content": ""},
        ]
        self.assertEqual(sanitize_chat_history(messages), [
            {"role": "user", "content": "질문"},
            {"role": "assistant", "content": "답변"},
        ])

    def test_preview_is_compact(self):
        preview = extract_answer_preview("문장\n\n" + "가" * 300, 40)
        self.assertLessEqual(len(preview), 40)
        self.assertTrue(preview.endswith("…"))


if __name__ == "__main__":
    unittest.main()
