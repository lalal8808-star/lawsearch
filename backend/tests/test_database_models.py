import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base, GenerationJob, Report, UploadSource, User


class DatabaseModelsTest(unittest.TestCase):
    def test_generation_and_upload_registry_round_trip(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        session = sessionmaker(bind=engine)()
        user = User(username="tester@example.com", supabase_id="user-1")
        session.add(user)
        session.commit()

        source = UploadSource(
            id="upload-1", user_id=user.id, source_name="기준.hwpx",
            content_hash="a" * 64, version=1, status="active", chunk_count=3,
        )
        job = GenerationJob(
            id="job-1", user_id=user.id, query="질의", status="generated",
            stage="생성 완료", progress=90, result="보고서",
        )
        report = Report(
            user_id=user.id, query="질의", answer="보고서", sources=[],
            evidence_manifest=[], generation_job_id="job-1",
        )
        session.add_all([source, job, report])
        session.commit()

        self.assertEqual(session.query(UploadSource).one().chunk_count, 3)
        self.assertEqual(session.query(GenerationJob).one().result, "보고서")
        self.assertEqual(session.query(Report).one().generation_job_id, "job-1")


if __name__ == "__main__":
    unittest.main()
