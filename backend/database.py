from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime, ForeignKey, JSON, UniqueConstraint, BigInteger
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from datetime import datetime
import os

import urllib.parse

# Database configuration
raw_url = os.getenv("SUPABASE_DB_URL", "")

def sanitize_db_url(url: str) -> str:
    if not url:
        return ""
    
    # 1. Clean whitespace and unexpected quotes/brackets
    url = url.strip().strip("'\"[] ")
    
    # 2. Fix the prefix for SQLAlchemy 1.4+
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    
    # 3. Handle special characters in password (URL encoding)
    try:
        if "@" in url and "://" in url:
            scheme_part, rest = url.split("://", 1)
            auth_part, host_part = rest.split("@", 1)
            
            if ":" in auth_part:
                user, password = auth_part.split(":", 1)
                # Only encode if it's not already encoded (doesn't contain %)
                if "%" not in password:
                    encoded_password = urllib.parse.quote_plus(password)
                    url = f"{scheme_part}://{user}:{encoded_password}@{host_part}"
    except Exception as e:
        print(f"URL parsing/encoding utility warning: {e}")
        
    return url

SQLALCHEMY_DATABASE_URL = sanitize_db_url(raw_url)

if not SQLALCHEMY_DATABASE_URL:
    # Fallback for development if SUPABASE_DB_URL is not provided
    # Use absolute path relative to this file to avoid CWD issues
    base_dir = os.path.dirname(os.path.abspath(__file__))
    db_dir = os.getenv("DATABASE_DIR", base_dir)
    if not os.path.exists(db_dir):
        os.makedirs(db_dir, exist_ok=True)
    SQLALCHEMY_DATABASE_URL = f"sqlite:///{os.path.join(db_dir, 'law_history.db')}"
    print(f"Warning: SUPABASE_DB_URL not found. Using local SQLite at: {SQLALCHEMY_DATABASE_URL}")
else:
    # Mask password for safe logging
    safe_log_url = SQLALCHEMY_DATABASE_URL.split("@")[-1] if "@" in SQLALCHEMY_DATABASE_URL else "invalid-url"
    print(f"Database connection attempt: postgresql://****@{safe_log_url}")

try:
    engine = create_engine(
        SQLALCHEMY_DATABASE_URL,
        # Remove check_same_thread for PostgreSQL as it's SQLite specific
        connect_args={"check_same_thread": False} if SQLALCHEMY_DATABASE_URL.startswith("sqlite") else {}
    )
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
except Exception as e:
    print(f"CRITICAL: Failed to create SQLAlchemy engine: {e}")
    raise

Base = declarative_base()

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    supabase_id = Column(String, unique=True, index=True, nullable=True) # Linked Supabase UUID
    username = Column(String, unique=True, index=True)
    nickname = Column(String, nullable=True)
    hashed_password = Column(String, nullable=True) # Optional for Google users
    created_at = Column(DateTime, default=datetime.utcnow)

    reports = relationship("Report", back_populates="owner")
    subscriptions = relationship("Subscription", back_populates="owner")
    notifications = relationship("Notification", back_populates="user")
    api_keys = relationship("APIKey", back_populates="owner")

class Report(Base):
    __tablename__ = "reports"

    id = Column(Integer, primary_key=True, index=True)
    # 클라이언트 재시도 시 같은 보고서가 중복 저장되지 않도록 하는 멱등성 키.
    # 기존 보고서는 NULL을 허용한다.
    client_request_id = Column(String, unique=True, index=True, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    query = Column(Text)
    answer = Column(Text)
    engine = Column(String, nullable=True)
    sources = Column(JSON) # Store as JSON list
    evidence_manifest = Column(JSON, default=list)
    generation_job_id = Column(String, nullable=True, index=True)
    chat_history = Column(JSON, default=list) # Store list of {"role": "...", "content": "..."}
    tags = Column(JSON, default=list) # 사용자 태그 목록 (폴더는 태그로 대체)
    created_at = Column(DateTime, default=datetime.utcnow)

    owner = relationship("User", back_populates="reports")

class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    law_name = Column(String, index=True)
    mst = Column(String)
    last_enforced_date = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)

    owner = relationship("User", back_populates="subscriptions")

class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    type = Column(String) 
    title = Column(String)
    message = Column(Text)
    is_read = Column(Integer, default=0) 
    link = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="notifications")

class APIKey(Base):
    __tablename__ = "api_keys"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    key_prefix = Column(String(10), index=True) # First 8-10 chars for display
    hashed_key = Column(String, unique=True, index=True) # Securely hashed
    name = Column(String, nullable=True) # Optional label e.g., "Zapier Integration"
    created_at = Column(DateTime, default=datetime.utcnow)
    last_used_at = Column(DateTime, nullable=True)
    is_active = Column(Integer, default=1) # 1=Active, 0=Revoked

    owner = relationship("User", back_populates="api_keys")

class RateLimit(Base):
    # 서버리스에서도 인스턴스 간 공유되는 고정창(fixed-window) 레이트리밋 카운터.
    # (slowapi 인메모리는 인스턴스마다 리셋돼 무력하므로 공유 DB를 사용)
    __tablename__ = "rate_limits"
    id = Column(Integer, primary_key=True, index=True)
    user_key = Column(String, index=True)   # user id 또는 익명 식별자
    bucket = Column(String)                  # 엔드포인트 그룹
    window_key = Column(Integer)             # floor(epoch / window_seconds)
    count = Column(Integer, default=0)
    __table_args__ = (UniqueConstraint("user_key", "bucket", "window_key", name="uq_ratelimit"),)


class UploadSource(Base):
    """사용자 업로드 파일 단위의 관리 레지스트리.

    벡터 청크는 기존 Supabase documents 테이블에 유지하고, 이 테이블에는 파일 단위
    메타데이터와 활성/휴지통 상태만 보관한다.
    """
    __tablename__ = "upload_sources"

    id = Column(String, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    source_name = Column(String(500), nullable=False, index=True)
    content_hash = Column(String(64), nullable=True, index=True)
    file_size = Column(BigInteger, nullable=True)
    file_type = Column(String(20), nullable=True)
    version = Column(Integer, default=1, nullable=False)
    status = Column(String(20), default="processing", nullable=False, index=True)
    chunk_count = Column(Integer, default=0, nullable=False)
    preview = Column(Text, nullable=True)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    deleted_at = Column(DateTime, nullable=True)
    __table_args__ = (
        UniqueConstraint("user_id", "content_hash", name="uq_upload_user_hash"),
    )


class GenerationJob(Base):
    """AI 응답을 브라우저와 독립적으로 추적·복구하기 위한 작업 레코드."""
    __tablename__ = "generation_jobs"

    id = Column(String, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    query = Column(Text, nullable=False)
    kind = Column(String(30), default="consultation", nullable=False)
    status = Column(String(20), default="queued", nullable=False, index=True)
    stage = Column(String(100), default="요청 접수", nullable=False)
    progress = Column(Integer, default=5, nullable=False)
    model = Column(String(100), nullable=True)
    intent = Column(String(30), nullable=True)
    result = Column(Text, nullable=True)
    sources = Column(JSON, default=list)
    token_usage = Column(JSON, default=dict)
    estimated_cost_micros = Column(BigInteger, default=0, nullable=False)
    report_id = Column(Integer, ForeignKey("reports.id"), nullable=True, index=True)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


def run_migrations():
    """기존 테이블에 새 컬럼을 idempotent하게 추가한다(create_all은 컬럼 추가를 안 함).
    실패해도 부팅을 막지 않도록 예외를 삼킨다."""
    try:
        from sqlalchemy import inspect as sa_inspect, text
        insp = sa_inspect(engine)
        if "reports" in insp.get_table_names():
            cols = [c["name"] for c in insp.get_columns("reports")]
            if "tags" not in cols:
                coltype = "JSONB" if engine.dialect.name == "postgresql" else "TEXT"
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE reports ADD COLUMN tags {coltype}"))
                print(f"Migration: added reports.tags ({coltype})")
            if "client_request_id" not in cols:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE reports ADD COLUMN client_request_id VARCHAR"))
                print("Migration: added reports.client_request_id")
            if "evidence_manifest" not in cols:
                coltype = "JSONB" if engine.dialect.name == "postgresql" else "TEXT"
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE reports ADD COLUMN evidence_manifest {coltype}"))
                print(f"Migration: added reports.evidence_manifest ({coltype})")
            if "generation_job_id" not in cols:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE reports ADD COLUMN generation_job_id VARCHAR"))
                print("Migration: added reports.generation_job_id")
            # PostgreSQL/SQLite 모두 지원하는 멱등한 고유 인덱스 생성.
            with engine.begin() as conn:
                conn.execute(text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS ix_reports_client_request_id "
                    "ON reports (client_request_id)"
                ))
                conn.execute(text(
                    "CREATE INDEX IF NOT EXISTS ix_reports_generation_job_id "
                    "ON reports (generation_job_id)"
                ))
                conn.execute(text(
                    "CREATE INDEX IF NOT EXISTS ix_reports_user_created_at "
                    "ON reports (user_id, created_at DESC)"
                ))
    except Exception as e:
        print(f"Migration warning (reports.tags): {e}")

    # 이 서비스의 데이터 테이블은 브라우저가 Supabase Data API로 직접 접근하지 않고
    # 인증된 FastAPI만 사용한다. public 스키마가 PostgREST에 노출돼도 anon/authenticated가
    # 우회 조회하지 못하도록 RLS를 켜고 테이블 권한을 명시적으로 회수한다.
    if engine.dialect.name == "postgresql":
        internal_tables = [
            "users", "reports", "subscriptions", "notifications", "api_keys",
            "rate_limits", "upload_sources", "generation_jobs", "documents",
        ]
        try:
            from sqlalchemy import inspect as sa_inspect, text
            existing = set(sa_inspect(engine).get_table_names())
            with engine.begin() as conn:
                for table_name in internal_tables:
                    if table_name not in existing:
                        continue
                    conn.execute(text(f'ALTER TABLE "{table_name}" ENABLE ROW LEVEL SECURITY'))
                    conn.execute(text(f'REVOKE ALL ON TABLE "{table_name}" FROM anon, authenticated'))
            print("Migration: enabled RLS and revoked Data API roles for internal tables")
        except Exception as e:
            print(f"Security migration warning (RLS/grants): {e}")


def init_db():
    Base.metadata.create_all(bind=engine)
    run_migrations()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
