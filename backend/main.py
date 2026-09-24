from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Request, Response, Query
import os
import re
import time
import logging
import json
import uuid
import hashlib
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import text as sa_text, or_, cast, Text as SAText
from datetime import datetime, timedelta, timezone

from langchain_core.documents import Document
from api.law_client import law_client
from engine.rag import rag_engine
from engine.document_processor import document_processor
from engine.legal_watch import legal_watch_engine
import database
import auth
from database import User, Report, get_db, Subscription, Notification, APIKey, UploadSource, GenerationJob
from services.reporting import build_evidence_manifest, extract_answer_preview, sanitize_chat_history
import logging

from pydantic import BaseModel, Field

# Sync request model
class SyncRequest(BaseModel):
    supabase_id: str
    username: str
    nickname: Optional[str] = None

# Setup Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def log_event(event: str, **fields):
    """Emit one-line structured logs without storing user query/report content."""
    safe = {"event": event, **{k: v for k, v in fields.items() if v is not None}}
    logger.info(json.dumps(safe, ensure_ascii=False, default=str, separators=(",", ":")))

app = FastAPI(title="JongLaw AI API")
logger.info("JongLaw AI API Starting up... [Final RPC Fix Applied]")

# Initialize DB on startup
database.init_db()

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

MAX_FILE_SIZE = 10 * 1024 * 1024 # 10MB limit for file uploads


def enforce_rate_limit(db: Session, user_key, bucket: str, limit: int, window_seconds: int = 3600):
    """공유 DB 기반 고정창(fixed-window) per-user 레이트리밋.
    서버리스에서 인스턴스 간 공유되며, 검사 자체가 실패하면 fail-open(요청 허용)한다."""
    try:
        window = int(time.time()) // window_seconds
        cnt = db.execute(sa_text("""
            INSERT INTO rate_limits (user_key, bucket, window_key, count)
            VALUES (:u, :b, :w, 1)
            ON CONFLICT (user_key, bucket, window_key)
            DO UPDATE SET count = rate_limits.count + 1
            RETURNING count
        """), {"u": str(user_key), "b": bucket, "w": window}).scalar()
        db.commit()
        if cnt and cnt > limit:
            raise HTTPException(status_code=429, detail="요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.")
    except HTTPException:
        raise
    except Exception as e:
        try:
            db.rollback()
        except Exception:
            pass
        logger.warning(f"rate limit skipped ({bucket}): {e}")

# Configure CORS
env_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001").split(",")
# Robustly clean origins: strip spaces and trailing slashes
origins = [origin.strip().rstrip("/") for origin in env_origins if origin.strip()]

logger.info(f"Allowed Origins: {origins}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    # 이 프로젝트의 Vercel 프리뷰/브랜치 배포 URL(예: lawsearch-<hash>-...vercel.app)도 허용
    # 정식 도메인 + 이 팀(jongwha-ims-projects)의 프리뷰/프로덕션 배포만 허용한다.
    # (기존 lawsearch-*.vercel.app 정규식은 제3자의 lawsearch-evil.vercel.app 까지 허용됐음)
    allow_origin_regex=r"https://(lawsearch-seven|lawsearch-[a-z0-9-]+-jongwha-ims-projects)\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 텍스트 응답(히스토리/컨텍스트 등) 압축 — 원거리 전송량을 크게 줄인다
from fastapi.middleware.gzip import GZipMiddleware
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.middleware("http")
async def request_observability(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        log_event(
            "http_request_error",
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            duration_ms=round((time.perf_counter() - started) * 1000),
        )
        raise
    response.headers["X-Request-Id"] = request_id
    log_event(
        "http_request",
        request_id=request_id,
        method=request.method,
        path=request.url.path,
        status=response.status_code,
        duration_ms=round((time.perf_counter() - started) * 1000),
    )
    return response

@app.get("/")
async def root():
    return {"message": "JongLaw AI API is running"}

# --- Auth Endpoints ---

@app.post("/auth/signup")
@limiter.limit("5/minute")
async def signup(
    request: Request,
    username: str = Form(...), 
    password: str = Form(...), 
    nickname: str = Form(...), 
    db: Session = Depends(get_db)
):
    # 아이디/비밀번호 가입은 이메일 소유를 확인하지 않는다. 남의 이메일로 먼저 가입해 두면
    # 그 사람이 나중에 Google로 로그인할 때 같은 계정에 연결되므로 신규 가입을 막는다.
    raise HTTPException(status_code=410, detail="신규 가입은 Google 로그인으로만 가능합니다.")

@app.post("/auth/login")
@limiter.limit("5/minute")
async def login(request: Request, username: str = Form(...), password: str = Form(...), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == username).first()
    if not user or not auth.verify_password(password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect username or password")
    if user.supabase_id:
        raise HTTPException(status_code=400, detail="이 계정은 Google 로그인으로 전환되었습니다. Google로 로그인해 주세요.")
    
    access_token = auth.create_access_token(data={"sub": user.username})
    return {"access_token": access_token, "token_type": "bearer", "username": user.username, "nickname": user.nickname}

@app.get("/auth/me")
async def get_me(current_user: User = Depends(auth.get_current_user)):
    return {"username": current_user.username, "nickname": current_user.nickname}

@app.patch("/auth/profile")
async def update_profile(
    nickname: Optional[str] = Form(None),
    current_password: Optional[str] = Form(None),
    new_password: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.get_current_user)
):
    if nickname:
        current_user.nickname = nickname
    
    if new_password:
        if not current_password:
            raise HTTPException(status_code=400, detail="Current password is required to set a new password")
        if not auth.verify_password(current_password, current_user.hashed_password):
            raise HTTPException(status_code=400, detail="Incorrect current password")
        current_user.hashed_password = auth.get_password_hash(new_password)
    
    db.commit()
    db.refresh(current_user)
    return {"username": current_user.username, "nickname": current_user.nickname, "detail": "Profile updated successfully"}

@app.post("/auth/sync")
async def sync_user(
    request: SyncRequest, 
    token: str = Depends(auth.oauth2_scheme),
    db: Session = Depends(get_db)
):
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required for sync")
        
    try:
        payload, token_kind = auth.decode_token(token)
        # 레거시 토큰은 sub가 임의의 username이고 이메일도 없어서, 이를 허용하면 남의 이메일을
        # 보내 그 계정의 supabase_id를 자기 username으로 바꿔치기(계정 탈취)할 수 있다.
        # 계정 연결은 이메일 소유가 확인된 Supabase 토큰으로만 한다.
        if token_kind != auth.TOKEN_KIND_SUPABASE or payload.get("is_anonymous"):
            raise HTTPException(status_code=403, detail="Supabase login is required for sync")
        if payload.get("sub") != request.supabase_id:
            raise HTTPException(status_code=403, detail="Token sub does not match requested supabase_id")
        token_email = (payload.get("email") or "").strip().lower()
        if not token_email or token_email != (request.username or "").strip().lower():
            raise HTTPException(status_code=403, detail="Token email does not match requested username")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"DEBUG: Token validation failed in sync: {e}")
        raise HTTPException(status_code=401, detail="Invalid token")

    logger.debug(f"DEBUG: /auth/sync received for supabase_id={request.supabase_id}, email={request.username}")
    
    # 1. 먼저 supabase_id로 검색
    user = db.query(User).filter(User.supabase_id == request.supabase_id).first()
    
    if not user:
        # 2. 없으면 이메일(username)로 기존 레거시 유저가 있는지 검색
        user = db.query(User).filter(User.username == request.username).first()
        if user:
            # 기존 유저가 있으면 supabase_id만 연결 (업데이트). 위에서 이메일 소유가 확인된
            # Supabase 토큰임을 검증했으므로, 다른 값이 들어 있던 경우(재가입, 과거 탈취 흔적)도
            # 이메일 소유자에게 되돌린다.
            log_event("auth_account_linked", user_id=user.id, relinked=bool(user.supabase_id))
            user.supabase_id = request.supabase_id
            if request.nickname:
                user.nickname = request.nickname
        else:
            # 3. 둘 다 없으면 완전히 새로운 유저 생성
            logger.debug(f"DEBUG: Creating new user record for {request.username}")
            user = User(
                supabase_id=request.supabase_id,
                username=request.username,
                nickname=request.nickname
            )
            db.add(user)
    else:
        # 이미 연동된 유저라면 닉네임만 업데이트
        if request.nickname and user.nickname != request.nickname:
            user.nickname = request.nickname
            
    try:
        db.commit()
        db.refresh(user)
    except Exception as e:
        logger.error(f"Sync failed: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail="Sync failed")
        
    return {"status": "synced", "nickname": user.nickname}

@app.post("/auth/api-keys")
async def create_api_key(
    name: str = Form(...),
    current_user: User = Depends(auth.get_current_user), 
    db: Session = Depends(get_db)
):
    """
    Generate a new API Key.
    The key is returned ONLY ONCE. The client must save it immediately.
    """
    plain_key, hashed_key = auth.generate_api_key()
    
    new_key = APIKey(
        user_id=current_user.id,
        key_prefix=plain_key[:10],
        hashed_key=hashed_key,
        name=name,
        is_active=1
    )
    db.add(new_key)
    db.commit()
    db.refresh(new_key)
    
    return {"api_key": plain_key, "name": name, "prefix": new_key.key_prefix}

@app.get("/auth/api-keys")
async def list_api_keys(
    current_user: User = Depends(auth.get_current_user), 
    db: Session = Depends(get_db)
):
    keys = db.query(APIKey).filter(APIKey.user_id == current_user.id, APIKey.is_active == 1).all()
    return [{"id": k.id, "name": k.name, "prefix": k.key_prefix, "created_at": k.created_at, "last_used_at": k.last_used_at} for k in keys]

@app.delete("/auth/api-keys/{key_id}")
async def delete_api_key(
    key_id: int,
    current_user: User = Depends(auth.get_current_user), 
    db: Session = Depends(get_db)
):
    key = db.query(APIKey).filter(APIKey.id == key_id, APIKey.user_id == current_user.id).first()
    if not key:
        raise HTTPException(status_code=404, detail="API Key not found")
        
    key.is_active = 0
    db.commit()
    return {"message": "API Key deleted"}

# --- Law Endpoints ---

# law.go.kr 프록시 + LLM(recommend)을 타는 엔드포인트들. 익명 남용(외부 API 쿼터/LLM 비용)
# 방지를 위해 모두 인증을 요구한다.
@app.get("/laws/article")
async def get_law_article(law_name: str, article_no: str, current_user: User = Depends(auth.get_current_user)):
    text = rag_engine.get_article_text(law_name, article_no)
    if not text:
        raise HTTPException(status_code=404, detail="Article not found")
    return {"text": text}

@app.get("/laws/synced")
async def get_synced_laws(current_user: User = Depends(auth.get_current_user)):
    return rag_engine.get_synced_msts()

@app.post("/laws/recommend")
async def recommend_laws(case: str = Form(...), current_user: User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    enforce_rate_limit(db, current_user.id, "laws-recommend", 30)
    return await rag_engine.recommend_laws(case)

@app.get("/laws/search")
async def search_laws(query: str, page: int = 1, current_user: User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    enforce_rate_limit(db, current_user.id, "laws-search", 60)
    return await law_client.search_laws(query, page=page)


def _legacy_upload_id(user_id: int, source_name: str) -> str:
    return "legacy-" + hashlib.sha256(f"{user_id}:{source_name}".encode("utf-8")).hexdigest()[:32]


def _sync_legacy_upload_sources(db: Session, user_id: int):
    """Backfill the file registry from existing vector metadata without rewriting chunks."""
    details = rag_engine.get_user_upload_details(user_id)
    existing_ids = {
        row[0] for row in db.query(UploadSource.id).filter(UploadSource.user_id == user_id).all()
    }
    changed = False
    for item in details:
        source_id = str(item.get("upload_id") or _legacy_upload_id(user_id, item["source"]))
        if source_id in existing_ids:
            continue
        uploaded_at = None
        if item.get("uploaded_at"):
            try:
                uploaded_at = datetime.fromisoformat(str(item["uploaded_at"]).replace("Z", "+00:00")).replace(tzinfo=None)
            except ValueError:
                uploaded_at = None
        db.add(UploadSource(
            id=source_id,
            user_id=user_id,
            source_name=item["source"],
            content_hash=item.get("content_hash"),
            file_size=item.get("file_size"),
            file_type=item.get("file_type"),
            version=item.get("version") or 1,
            status="active",
            chunk_count=item.get("chunk_count") or 0,
            preview=item.get("preview") or "",
            created_at=uploaded_at or datetime.utcnow(),
        ))
        changed = True
    if changed:
        try:
            db.commit()
        except Exception:
            db.rollback()
            logger.exception("legacy upload registry sync failed")


def _serialize_upload(source: UploadSource):
    return {
        "id": source.id,
        "source": source.source_name,
        "file_size": source.file_size,
        "file_type": source.file_type,
        "version": source.version,
        "status": source.status,
        "chunk_count": source.chunk_count,
        "preview": source.preview or "",
        "created_at": source.created_at,
        "updated_at": source.updated_at,
        "deleted_at": source.deleted_at,
    }

@app.post("/upload")
@limiter.limit("10/minute")
async def upload_document(
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db)
):
    enforce_rate_limit(db, current_user.id, "upload", 20)  # 시간당 20건
    original_filename = (file.filename or "upload").strip()[:500]
    filename = original_filename.lower()
    is_pdf = filename.endswith(".pdf")
    is_hwpx = filename.endswith(".hwpx")

    if not (is_pdf or is_hwpx):
        raise HTTPException(status_code=400, detail="PDF 또는 HWPX 파일만 업로드할 수 있습니다.")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File too large. Maximum size is 10MB.")

    content_hash = hashlib.sha256(content).hexdigest()
    duplicate = db.query(UploadSource).filter(
        UploadSource.user_id == current_user.id,
        UploadSource.content_hash == content_hash,
    ).first()
    if duplicate:
        action = "휴지통에서 복원" if duplicate.status == "deleted" else "기존 소스를 사용"
        raise HTTPException(
            status_code=409,
            detail=f"동일한 파일이 이미 등록되어 있습니다(v{duplicate.version}). {action}해 주세요.",
        )

    latest_version = db.query(UploadSource).filter(
        UploadSource.user_id == current_user.id,
        UploadSource.source_name == original_filename,
    ).order_by(UploadSource.version.desc()).first()
    version = (latest_version.version + 1) if latest_version else 1
    upload_id = str(uuid.uuid4())
    source_row = UploadSource(
        id=upload_id,
        user_id=current_user.id,
        source_name=original_filename,
        content_hash=content_hash,
        file_size=len(content),
        file_type="pdf" if is_pdf else "hwpx",
        version=version,
        status="processing",
    )
    db.add(source_row)
    db.commit()

    try:
        if is_pdf:
            docs = document_processor.process_pdf(content, original_filename)
        else:
            docs = document_processor.process_hwpx(content, original_filename)
    except Exception as exc:
        source_row.status = "error"
        source_row.error = str(exc)[:1000]
        db.commit()
        raise HTTPException(status_code=400, detail="문서 처리 중 오류가 발생했습니다.")

    if not docs:
        source_row.status = "error"
        source_row.error = "문서에서 텍스트를 추출하지 못했습니다."
        db.commit()
        raise HTTPException(
            status_code=400,
            detail="문서에서 텍스트를 추출하지 못했습니다. 스캔본(이미지) PDF이거나 텍스트 레이어가 없는 파일일 수 있습니다. 텍스트 기반 PDF로 다시 시도해 주세요."
        )

    # 서버리스(Vercel Fluid)에서는 응답 후 백그라운드 실행이 보장되지 않으므로 요청 안에서 처리한다.
    # 함수 타임아웃 300s, 50청크 배치 임베딩이라 대형 문서(200+청크)도 1~2분 내 완료된다.
    uploaded_at = datetime.now(timezone.utc).isoformat()
    for doc in docs:
        doc.metadata.update({
            "upload_id": upload_id,
            "source": original_filename,
            "type": "user_upload",
            "content_hash": content_hash,
            "file_size": len(content),
            "file_type": "pdf" if is_pdf else "hwpx",
            "version": version,
            "uploaded_at": uploaded_at,
        })
    try:
        chunk_count = await rag_engine.add_documents(docs, user_id=current_user.id)
    except Exception as exc:
        try:
            rag_engine.purge_user_upload(original_filename, current_user.id, upload_id=upload_id)
        except Exception:
            pass
        source_row.status = "error"
        source_row.error = str(exc)[:1000]
        db.commit()
        log_event("upload_failed", user_id=current_user.id, upload_id=upload_id, file_type=source_row.file_type)
        raise HTTPException(status_code=502, detail="임베딩 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.")

    # 같은 파일명의 이전 버전은 보존하되 검색에서는 제외한다.
    db.query(UploadSource).filter(
        UploadSource.user_id == current_user.id,
        UploadSource.source_name == original_filename,
        UploadSource.id != upload_id,
        UploadSource.status == "active",
    ).update({"status": "archived", "updated_at": datetime.utcnow()}, synchronize_session=False)
    source_row.status = "active"
    source_row.chunk_count = chunk_count
    source_row.preview = (docs[0].page_content if docs else "")[:600]
    db.commit()
    log_event("upload_completed", user_id=current_user.id, upload_id=upload_id, chunks=chunk_count, version=version)
    return {
        "message": f"File {original_filename} uploaded and processed",
        "status": "done",
        "source": _serialize_upload(source_row),
    }

@app.get("/uploads")
async def get_uploads(
    q: str = Query(default="", max_length=200),
    status: str = Query(default="active", pattern="^(active|archived|deleted|error|all)$"),
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    _sync_legacy_upload_sources(db, current_user.id)
    query = db.query(UploadSource).filter(UploadSource.user_id == current_user.id)
    if status != "all":
        query = query.filter(UploadSource.status == status)
    if q.strip():
        query = query.filter(UploadSource.source_name.ilike(f"%{q.strip()}%"))
    rows = query.order_by(UploadSource.created_at.desc()).all()
    return {"items": [_serialize_upload(row) for row in rows], "total": len(rows)}


@app.get("/uploads/{source_id}/preview")
async def preview_upload(
    source_id: str,
    q: str = Query(default="", max_length=200),
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    source = db.query(UploadSource).filter(
        UploadSource.id == source_id,
        UploadSource.user_id == current_user.id,
    ).first()
    if not source:
        raise HTTPException(status_code=404, detail="학습 소스를 찾을 수 없습니다.")
    upload_id = None if source.id.startswith("legacy-") else source.id
    chunks = rag_engine.get_upload_chunks(source.source_name, current_user.id, upload_id, q, limit=5)
    return {"source": _serialize_upload(source), "chunks": chunks, "query": q}


@app.delete("/uploads/{source_id}")
async def trash_upload(
    source_id: str,
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    source = db.query(UploadSource).filter(
        UploadSource.id == source_id,
        UploadSource.user_id == current_user.id,
    ).first()
    if not source:
        raise HTTPException(status_code=404, detail="삭제할 학습 소스를 찾을 수 없습니다.")
    source.status = "deleted"
    source.deleted_at = datetime.utcnow()
    db.commit()
    log_event("upload_trashed", user_id=current_user.id, upload_id=source.id)
    return {"message": "Source moved to trash", "source": _serialize_upload(source)}


@app.post("/uploads/{source_id}/restore")
async def restore_upload(
    source_id: str,
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    source = db.query(UploadSource).filter(
        UploadSource.id == source_id,
        UploadSource.user_id == current_user.id,
    ).first()
    if not source or source.status != "deleted":
        raise HTTPException(status_code=404, detail="복원할 학습 소스를 찾을 수 없습니다.")
    db.query(UploadSource).filter(
        UploadSource.user_id == current_user.id,
        UploadSource.source_name == source.source_name,
        UploadSource.id != source.id,
        UploadSource.status == "active",
    ).update({"status": "archived", "updated_at": datetime.utcnow()}, synchronize_session=False)
    source.status = "active"
    source.deleted_at = None
    db.commit()
    log_event("upload_restored", user_id=current_user.id, upload_id=source.id)
    return {"message": "Source restored", "source": _serialize_upload(source)}


@app.post("/uploads/{source_id}/activate")
async def activate_upload_version(
    source_id: str,
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    source = db.query(UploadSource).filter(
        UploadSource.id == source_id,
        UploadSource.user_id == current_user.id,
        UploadSource.status == "archived",
    ).first()
    if not source:
        raise HTTPException(status_code=404, detail="활성화할 이전 버전을 찾을 수 없습니다.")
    db.query(UploadSource).filter(
        UploadSource.user_id == current_user.id,
        UploadSource.source_name == source.source_name,
        UploadSource.id != source.id,
        UploadSource.status == "active",
    ).update({"status": "archived", "updated_at": datetime.utcnow()}, synchronize_session=False)
    source.status = "active"
    source.deleted_at = None
    db.commit()
    log_event("upload_version_activated", user_id=current_user.id, upload_id=source.id, version=source.version)
    return {"message": "Source version activated", "source": _serialize_upload(source)}


@app.delete("/uploads/{source_id}/purge")
async def purge_upload(
    source_id: str,
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    source = db.query(UploadSource).filter(
        UploadSource.id == source_id,
        UploadSource.user_id == current_user.id,
        UploadSource.status == "deleted",
    ).first()
    if not source:
        raise HTTPException(status_code=404, detail="휴지통의 학습 소스를 찾을 수 없습니다.")
    upload_id = None if source.id.startswith("legacy-") else source.id
    deleted_chunks = rag_engine.purge_user_upload(source.source_name, current_user.id, upload_id)
    db.delete(source)
    db.commit()
    log_event("upload_purged", user_id=current_user.id, upload_id=source_id, chunks=deleted_chunks)
    return {"message": "Source permanently deleted", "deleted_chunks": deleted_chunks}

@app.delete("/uploads")
async def delete_upload(
    source: str = Query(..., min_length=1, max_length=500),
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    # 이전 프론트엔드와의 호환 경로. 영구 삭제 대신 동일하게 휴지통으로 이동한다.
    _sync_legacy_upload_sources(db, current_user.id)
    rows = db.query(UploadSource).filter(
        UploadSource.user_id == current_user.id,
        UploadSource.source_name == source,
        UploadSource.status != "deleted",
    ).all()
    if not rows:
        raise HTTPException(status_code=404, detail="삭제할 학습 소스를 찾을 수 없습니다.")
    now = datetime.utcnow()
    for row in rows:
        row.status = "deleted"
        row.deleted_at = now
    db.commit()
    return {
        "message": f"Source {source} moved to trash",
        "source": source,
        "affected_versions": len(rows),
    }

@app.get("/query-context")
async def query_context(
    query: str,
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db)
):
    # 인증 필수: Gemini(의도·법령탐지·임베딩) + law.go.kr 조회 + Supabase 쓰기까지 수행하는
    # 비싼 엔드포인트다. 익명 접근을 막고 per-user 유량을 제한해 비용/DoS 남용을 차단한다.
    enforce_rate_limit(db, current_user.id, "query-context", 60)  # 시간당 60회
    try:
        required_laws = await rag_engine.detect_required_laws(query)
        if required_laws:
            synced_sources = rag_engine._get_synced_sources()
            for law_name in required_laws:
                is_synced = any(law_name in s or s in law_name for s in synced_sources)
                if not is_synced:
                    try:
                        search_results = await law_client.search_laws(law_name)
                        law_list = search_results.get("law", [])
                        if isinstance(law_list, dict): law_list = [law_list]
                        best_match = None
                        if law_list:
                            for l in law_list:
                                if l.get("법령명한글") == law_name:
                                    best_match = l
                                    break
                            if not best_match: best_match = law_list[0]
                        if best_match:
                            mst = best_match.get("법령일련번호")
                            law_data = await law_client.get_law_detail(mst)
                            if law_data:
                                docs = document_processor.process_law_xml(law_data, mst)
                                if docs:
                                    rag_engine.delete_documents_by_mst(mst)
                                    await rag_engine.add_documents(docs)
                    except Exception as sync_e:
                        print(f"Warning: Auto-sync failed for law {law_name}: {sync_e}")

        # 2. Autonomous Precedent Syncing
        try:
            prec_search = await law_client.search_precedents(query)
            prec_list = prec_search.get("prec", [])
            if isinstance(prec_list, dict): prec_list = [prec_list]
            synced_msts = rag_engine.get_synced_msts()
            for prec_item in prec_list[:3]:
                prec_id = prec_item.get("판례일련번호")
                if prec_id and str(prec_id) not in synced_msts:
                    prec_detail = await law_client.get_precedent_detail(prec_id)
                    if prec_detail:
                        docs = document_processor.process_precedent_xml(prec_detail, prec_id)
                        if docs:
                            await rag_engine.add_documents(docs)
        except Exception as prec_sync_e:
            print(f"Warning: Precedent auto-sync failed: {prec_sync_e}")

        # 3. Retrieve context and sources from RAGEngine
        intent = await rag_engine.detect_intent(query)
        keywords = [k for k in re.split(r'\s+', query) if len(k) > 1]
        docs = []
        if rag_engine.supabase_client:
            user_id_str = str(current_user.id) if current_user else None
            upload_registry = db.query(UploadSource).filter(UploadSource.user_id == current_user.id).all()
            active_upload_ids = {s.id for s in upload_registry if s.status == "active" and not s.id.startswith("legacy-")}
            inactive_legacy_sources = {
                s.source_name for s in upload_registry
                if s.id.startswith("legacy-") and s.status != "active"
            }
            response = rag_engine.supabase_client.rpc(
                "match_documents",
                {
                    "query_embedding": await rag_engine.embeddings.aembed_query(query),
                    "match_threshold": 0.3,
                    "match_count": 30
                }
            ).execute()

            for row in response.data:
                metadata = row.get('metadata', {})
                # 업로드 자료는 본인 것만 (user_id는 JSON 숫자라 문자열로 맞춰 비교)
                if metadata.get("type") == "user_upload":
                    if str(metadata.get("user_id")) != str(user_id_str):
                        continue
                    upload_id = metadata.get("upload_id")
                    if upload_id and str(upload_id) not in active_upload_ids:
                        continue
                    if not upload_id and metadata.get("source") in inactive_legacy_sources:
                        continue
                metadata['similarity'] = row.get('similarity')
                docs.append(Document(page_content=row.get('content', ''), metadata=metadata))

        # 업로드 자료 관련성 판단: 임베딩 유사도로는 같은 도메인(변전 vs 지중송전)을 못 가르므로
        # (관련 없어도 0.7로 붙음), 후보 업로드 파일 제목을 LLM에게 물어 무관한 자료는 제외한다.
        upload_sources = {d.metadata.get("source") for d in docs if d.metadata.get("type") == "user_upload"}
        if upload_sources:
            relevant = await rag_engine.filter_relevant_uploads(query, list(upload_sources))
            before = len(docs)
            docs = [d for d in docs
                    if d.metadata.get("type") != "user_upload" or d.metadata.get("source") in relevant]
            logger.info("[query-context] upload relevance selected=%s docs_before=%s docs_after=%s", len(relevant), before, len(docs))

        # 키워드 겹침 + 유사도로 재정렬한 뒤 상위 15개 선택
        # (정렬 전에 자르면 법령이 업로드 청크에 밀려 잘리므로 반드시 정렬 후 슬라이스)
        for doc in docs:
            doc.metadata['boost'] = sum(10 for kw in keywords if kw in doc.page_content)
        docs.sort(key=lambda d: (d.metadata.get('boost', 0), d.metadata.get('similarity') or 0), reverse=True)
        docs = docs[:15]

        context_parts = []
        seen_contents = set()
        sources_list = []
        
        for doc in docs:
            content = doc.page_content.strip()
            src = doc.metadata.get("source", "Unknown").strip()
            src_type = doc.metadata.get("type", "unknown")
            if content not in seen_contents:
                context_parts.append(f"[{src}] {content}")
                seen_contents.add(content)
                source_key = (src, doc.metadata.get("article_no") or "")
                if source_key not in [(s['source'], s.get('article_no') or "") for s in sources_list]:
                    sources_list.append({
                        "source": src,
                        "type": src_type,
                        "article_no": doc.metadata.get("article_no"),
                        "mst": doc.metadata.get("mst"),
                        "url": doc.metadata.get("url"),
                        "upload_id": doc.metadata.get("upload_id"),
                        "version": doc.metadata.get("version"),
                        "retrieved_at": datetime.now(timezone.utc).isoformat(),
                    })

        context = "\n\n".join(context_parts[:10])
        
        return {
            "context": context,
            "sources": sources_list,
            "intent": intent,
            "evidence_manifest": build_evidence_manifest(sources_list),
        }
    except Exception as e:
        logger.error(f"Error in query-context: {e}")
        raise HTTPException(status_code=500, detail="컨텍스트 생성 중 오류가 발생했습니다.")

# --- HWPX 내보내기 ---

class ExportRequest(BaseModel):
    reportId: Optional[str] = None
    query: Optional[str] = None
    answer: str
    sources: Optional[List[dict]] = None

def _clean_line(line: str) -> str:
    line = re.sub(r'^\s*#{1,6}\s*', '', line)   # 마크다운 헤더 마커 제거
    line = line.replace('**', '')               # 볼드 마커 제거
    return line

@app.post("/export/hwpx")
async def export_hwpx(payload: ExportRequest, current_user: User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    """보고서를 한글(HWPX) 파일로 생성해 다운로드로 반환한다."""
    enforce_rate_limit(db, current_user.id, "export-hwpx", 120)
    from hwpx import HwpxDocument
    from urllib.parse import quote

    doc = HwpxDocument.new()
    doc.add_paragraph("법률 자문 보고서")
    if payload.query:
        doc.add_paragraph("")
        doc.add_paragraph(f"[질의] {payload.query}")
    doc.add_paragraph("")
    for line in (payload.answer or "").split("\n"):
        doc.add_paragraph(_clean_line(line))
    if payload.sources:
        doc.add_paragraph("")
        doc.add_paragraph("[참고 자료]")
        for s in payload.sources:
            name = (s or {}).get("source", "")
            if name:
                doc.add_paragraph(f"- {name}")

    data = doc.to_bytes()
    filename = f"{payload.reportId or 'report'}.hwpx"
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )

# --- Citation Verification (환각 검증) ---

CITATION_RE = re.compile(r'([가-힣]{2,20}(?:법률|법|령|규칙))\s*(제\d+조(?:의\d+)?)')

class VerifyCitationsRequest(BaseModel):
    text: str

@app.post("/verify-citations")
async def verify_citations(payload: VerifyCitationsRequest, current_user: User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    """보고서 본문의 '<법령명> 제N조' 인용을 law.go.kr 실제 조문과 대조해 환각을 검증한다."""
    enforce_rate_limit(db, current_user.id, "verify-citations", 60)
    text = payload.text or ""
    seen = set()
    by_law = {}
    for law, article in CITATION_RE.findall(text):
        law = law.strip()
        key = (law, article)
        if key in seen:
            continue
        seen.add(key)
        by_law.setdefault(law, []).append(article)

    results = []
    for law_name, articles in list(by_law.items())[:8]:  # 과도한 외부 호출 방지
        try:
            search = await law_client.search_laws(law_name)
            law_list = search.get("law", [])
            if isinstance(law_list, dict):
                law_list = [law_list]
            if not law_list:
                for a in articles:
                    results.append({"law": law_name, "article": a, "status": "law_not_found"})
                continue
            best = next((l for l in law_list if l.get("법령명한글") == law_name), law_list[0])
            mst = best.get("법령일련번호")
            actual_name = best.get("법령명한글", law_name)
            detail = await law_client.get_law_detail(mst)
            jo_list = detail.get("조문", {}).get("조문단위", [])
            if isinstance(jo_list, dict):
                jo_list = [jo_list]
            article_set = set()
            for jo in jo_list:
                t = (jo.get("조문제목") or "") + " " + (jo.get("조문내용") or "")
                m = re.search(r'제\d+조(?:의\d+)?', t)
                if m:
                    article_set.add(m.group(0))
            for a in articles:
                results.append({
                    "law": actual_name,
                    "article": a,
                    "status": "verified" if a in article_set else "article_not_found",
                    "url": f"https://www.law.go.kr/법령/{actual_name}",
                })
        except Exception as e:
            logger.error(f"verify-citations error for {law_name}: {e}")
            for a in articles:
                results.append({"law": law_name, "article": a, "status": "error"})
    return {"citations": results}

# --- Persistent AI Generation Jobs & Usage ---

ACTIVE_JOB_STATUSES = {"queued", "running", "generated"}
FINAL_JOB_STATUSES = {"complete", "error", "cancelled"}


def _serialize_job(job: GenerationJob, include_result: bool = True):
    payload = {
        "id": job.id,
        "query": job.query,
        "kind": job.kind,
        "status": job.status,
        "stage": job.stage,
        "progress": job.progress,
        "model": job.model,
        "intent": job.intent,
        "sources": job.sources or [],
        "token_usage": job.token_usage or {},
        "estimated_cost_micros": job.estimated_cost_micros or 0,
        "report_id": job.report_id,
        "error": job.error,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
    }
    if include_result:
        payload["result"] = job.result
    return payload


def _usage_value(usage: dict, *keys: str) -> int:
    for key in keys:
        value = (usage or {}).get(key)
        if isinstance(value, (int, float)):
            return max(0, int(value))
    return 0


def _estimate_cost_micros(usage: dict) -> int:
    input_tokens = _usage_value(usage, "inputTokens", "input_tokens", "promptTokens", "prompt_tokens")
    output_tokens = _usage_value(usage, "outputTokens", "output_tokens", "completionTokens", "completion_tokens")
    input_rate = float(os.getenv("AI_INPUT_USD_PER_MILLION", "0") or 0)
    output_rate = float(os.getenv("AI_OUTPUT_USD_PER_MILLION", "0") or 0)
    usd = (input_tokens * input_rate + output_tokens * output_rate) / 1_000_000
    return max(0, int(round(usd * 1_000_000)))


def _usage_total(usage: dict) -> int:
    total = _usage_value(usage, "totalTokens", "total_tokens")
    if total:
        return total
    return (_usage_value(usage, "inputTokens", "input_tokens", "promptTokens", "prompt_tokens")
            + _usage_value(usage, "outputTokens", "output_tokens", "completionTokens", "completion_tokens"))


def _monthly_usage(db: Session, user_id: int):
    now = datetime.utcnow()
    month_start = datetime(now.year, now.month, 1)
    jobs = db.query(GenerationJob).filter(
        GenerationJob.user_id == user_id,
        GenerationJob.created_at >= month_start,
    ).all()
    input_tokens = output_tokens = total_tokens = cost_micros = 0
    for job in jobs:
        usage = job.token_usage or {}
        input_tokens += _usage_value(usage, "inputTokens", "input_tokens", "promptTokens", "prompt_tokens")
        output_tokens += _usage_value(usage, "outputTokens", "output_tokens", "completionTokens", "completion_tokens")
        total_tokens += _usage_value(usage, "totalTokens", "total_tokens")
        cost_micros += job.estimated_cost_micros or 0
    if total_tokens == 0:
        total_tokens = input_tokens + output_tokens
    limit = int(os.getenv("MONTHLY_AI_TOKEN_LIMIT", "2000000") or 2000000)
    return {
        "period": month_start.strftime("%Y-%m"),
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens,
        "estimated_cost_micros": cost_micros,
        "token_limit": limit,
        "remaining_tokens": max(0, limit - total_tokens),
        "request_count": len(jobs),
    }


class CreateJobRequest(BaseModel):
    query: str = Field(min_length=1, max_length=20000)
    kind: str = Field(default="consultation", max_length=30)
    model: str = Field(default="openai/gpt-5.6-sol", max_length=100)


class UpdateJobRequest(BaseModel):
    status: Optional[str] = Field(default=None, max_length=20)
    stage: Optional[str] = Field(default=None, max_length=100)
    progress: Optional[int] = Field(default=None, ge=0, le=100)
    intent: Optional[str] = Field(default=None, max_length=30)
    result: Optional[str] = Field(default=None, max_length=150000)
    sources: Optional[List[dict]] = None
    token_usage: Optional[dict] = None
    report_id: Optional[int] = None
    error: Optional[str] = Field(default=None, max_length=2000)


@app.post("/jobs")
async def create_generation_job(
    payload: CreateJobRequest,
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    enforce_rate_limit(db, current_user.id, "generation-job", 60)
    usage = _monthly_usage(db, current_user.id)
    if usage["total_tokens"] >= usage["token_limit"]:
        raise HTTPException(status_code=429, detail="이번 달 AI 사용 한도에 도달했습니다.")
    job = GenerationJob(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        query=payload.query,
        kind=payload.kind,
        model=payload.model,
        status="queued",
        stage="요청 접수",
        progress=5,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    log_event("generation_job_created", user_id=current_user.id, job_id=job.id, kind=job.kind, model=job.model)
    return _serialize_job(job)


@app.post("/jobs/{job_id}/start")
async def start_generation_job(
    job_id: str,
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    """AI 생성 직전에 서버(Next API 라우트)가 호출한다. 대기 중인 작업 하나를 원자적으로
    실행 상태로 바꿔, 작업 하나당 모델 호출 한 번만 허용하고 월 한도를 다시 확인한다."""
    usage = _monthly_usage(db, current_user.id)
    if usage["total_tokens"] >= usage["token_limit"]:
        raise HTTPException(status_code=429, detail="이번 달 AI 사용 한도에 도달했습니다.")
    claimed = db.query(GenerationJob).filter(
        GenerationJob.id == job_id,
        GenerationJob.user_id == current_user.id,
        GenerationJob.status == "queued",
    ).update({
        "status": "running",
        "stage": "관련 법령·소스 검색",
        "progress": 20,
        "updated_at": datetime.utcnow(),
    }, synchronize_session=False)
    db.commit()
    if not claimed:
        raise HTTPException(status_code=409, detail="이미 처리되었거나 찾을 수 없는 작업입니다.")
    job = db.query(GenerationJob).filter(GenerationJob.id == job_id).first()
    log_event("generation_job_started", user_id=current_user.id, job_id=job_id)
    return _serialize_job(job)


@app.patch("/jobs/{job_id}")
async def update_generation_job(
    job_id: str,
    payload: UpdateJobRequest,
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    job = db.query(GenerationJob).filter(
        GenerationJob.id == job_id,
        GenerationJob.user_id == current_user.id,
    ).first()
    if not job:
        raise HTTPException(status_code=404, detail="AI 작업을 찾을 수 없습니다.")
    # AI 생성이 이미 끝난 뒤 브라우저 스트림만 끊긴 경우, 늦게 도착한
    # 클라이언트 오류가 생성 결과를 덮어쓰지 못하게 한다. result는 서버가
    # 보관하고 있으므로 아직 저장 전이면 generated 상태로 복구할 수 있다.
    protect_generated_result = bool(payload.status == "error" and job.result)
    if payload.status:
        allowed = ACTIVE_JOB_STATUSES | FINAL_JOB_STATUSES
        if payload.status not in allowed:
            raise HTTPException(status_code=400, detail="지원하지 않는 작업 상태입니다.")
        # queued→running 전환은 /jobs/{id}/start만 한다. 끝난 작업을 다시 대기·실행 상태로
        # 돌려 한 번 받은 생성 허가를 재사용하지 못하게 한다.
        if payload.status in {"queued", "running"} and payload.status != job.status:
            raise HTTPException(status_code=409, detail="작업 상태를 되돌릴 수 없습니다.")
        if protect_generated_result:
            job.status = "complete" if job.report_id else "generated"
        else:
            job.status = payload.status
    if payload.stage is not None and not protect_generated_result:
        job.stage = payload.stage
    if payload.progress is not None:
        job.progress = payload.progress
    if payload.intent is not None:
        job.intent = payload.intent
    if payload.result is not None:
        job.result = payload.result
    if payload.sources is not None:
        job.sources = payload.sources
    # 월 한도는 기록된 사용량으로 계산되므로 사용량은 줄어드는 방향으로 덮어쓰지 않는다.
    if payload.token_usage is not None and _usage_total(payload.token_usage) >= _usage_total(job.token_usage or {}):
        job.token_usage = payload.token_usage
        job.estimated_cost_micros = _estimate_cost_micros(payload.token_usage)
    if payload.report_id is not None:
        owned_report = db.query(Report).filter(
            Report.id == payload.report_id,
            Report.user_id == current_user.id,
        ).first()
        if not owned_report:
            raise HTTPException(status_code=400, detail="연결할 보고서를 찾을 수 없습니다.")
        job.report_id = payload.report_id
    if payload.error is not None:
        job.error = payload.error
    job.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(job)
    log_event("generation_job_updated", user_id=current_user.id, job_id=job.id, status=job.status, progress=job.progress)
    return _serialize_job(job)


@app.get("/jobs")
async def list_generation_jobs(
    recoverable: bool = False,
    limit: int = Query(default=10, ge=1, le=50),
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    stale_before = datetime.utcnow() - timedelta(minutes=20)
    stale = db.query(GenerationJob).filter(
        GenerationJob.user_id == current_user.id,
        GenerationJob.status.in_(["queued", "running"]),
        GenerationJob.updated_at < stale_before,
    ).all()
    for job in stale:
        job.status = "error"
        job.stage = "작업 중단"
        job.error = "응답 완료 전에 작업이 중단되었습니다. 다시 실행해 주세요."
    if stale:
        db.commit()
    query = db.query(GenerationJob).filter(GenerationJob.user_id == current_user.id)
    if recoverable:
        query = query.filter(
            GenerationJob.status.in_(list(ACTIVE_JOB_STATUSES))
            | (
                GenerationJob.result.isnot(None)
                & GenerationJob.report_id.is_(None)
            )
        )
    rows = query.order_by(GenerationJob.created_at.desc()).limit(limit).all()
    return {"items": [_serialize_job(row) for row in rows]}


@app.get("/jobs/{job_id}")
async def get_generation_job(
    job_id: str,
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    job = db.query(GenerationJob).filter(
        GenerationJob.id == job_id,
        GenerationJob.user_id == current_user.id,
    ).first()
    if not job:
        raise HTTPException(status_code=404, detail="AI 작업을 찾을 수 없습니다.")
    return _serialize_job(job)


@app.get("/usage")
async def get_ai_usage(
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    return _monthly_usage(db, current_user.id)


# --- History Endpoints ---

class SaveReportRequest(BaseModel):
    query: str
    answer: str
    engine: Optional[str] = None
    sources: Optional[List[dict]] = None
    client_request_id: Optional[str] = Field(default=None, max_length=64)
    generation_job_id: Optional[str] = Field(default=None, max_length=64)

@app.post("/history")
async def save_report_history(
    payload: SaveReportRequest,
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db)
):
    # 채팅이 Vercel /api/chat(GPT-5.6 Sol)로 옮겨가면서 백엔드 /query의 히스토리 저장이
    # 더 이상 호출되지 않으므로, REPORT 생성 후 프론트가 이 엔드포인트로 저장한다.
    # 네트워크 타임아웃 뒤 클라이언트가 재시도해도 같은 사용자의 동일 보고서를
    # 다시 만들지 않고 기존 ID를 반환한다.
    if payload.client_request_id:
        existing = db.query(Report).filter(
            Report.user_id == current_user.id,
            Report.client_request_id == payload.client_request_id,
        ).first()
        if existing:
            return {"id": existing.id, "saved": True, "duplicate": True}

    new_report = Report(
        user_id=current_user.id,
        client_request_id=payload.client_request_id,
        query=payload.query,
        answer=payload.answer,
        engine=payload.engine,
        sources=payload.sources or [],
        evidence_manifest=build_evidence_manifest(payload.sources or []),
        generation_job_id=payload.generation_job_id,
    )
    db.add(new_report)
    db.commit()
    db.refresh(new_report)
    if payload.generation_job_id:
        job = db.query(GenerationJob).filter(
            GenerationJob.id == payload.generation_job_id,
            GenerationJob.user_id == current_user.id,
        ).first()
        if job:
            job.report_id = new_report.id
            job.status = "complete"
            job.stage = "보고서 저장 완료"
            job.progress = 100
            db.commit()
    return {"id": new_report.id, "saved": True, "duplicate": False}

@app.get("/history")
async def get_history(
    q: str = Query(default="", max_length=200),
    tag: str = Query(default="", max_length=30),
    date_from: Optional[str] = Query(default=None),
    date_to: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=50),
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(Report).filter(Report.user_id == current_user.id)
    if q.strip():
        pattern = f"%{q.strip()}%"
        query = query.filter(or_(Report.query.ilike(pattern), Report.answer.ilike(pattern)))
    if tag.strip():
        query = query.filter(cast(Report.tags, SAText).ilike(f'%"{tag.strip()}"%'))
    try:
        if date_from:
            query = query.filter(Report.created_at >= datetime.fromisoformat(date_from))
        if date_to:
            end = datetime.fromisoformat(date_to) + timedelta(days=1)
            query = query.filter(Report.created_at < end)
    except ValueError:
        raise HTTPException(status_code=400, detail="날짜 형식은 YYYY-MM-DD여야 합니다.")

    total = query.count()
    reports = query.order_by(Report.created_at.desc()).offset((page - 1) * limit).limit(limit).all()
    # 이메일/질의 내용은 남기지 않고 내부 사용자 ID와 건수만 기록한다.
    # 기기별 계정 매핑 문제와 실제 빈 히스토리를 운영 로그에서 구분하기 위함이다.
    log_event("history_list", user_id=current_user.id, result_count=len(reports), total=total, page=page)
    all_tag_rows = db.query(Report.tags).filter(Report.user_id == current_user.id).all()
    available_tags = sorted({tag for row in all_tag_rows for tag in (row[0] or []) if isinstance(tag, str)})
    items = [
        {
            "id": r.id,
            "query": r.query,
            "answer_preview": extract_answer_preview(r.answer),
            "engine": r.engine,
            "tags": r.tags or [],
            "created_at": r.created_at,
        }
        for r in reports
    ]
    return {
        "items": items,
        "total": total,
        "page": page,
        "limit": limit,
        "has_more": page * limit < total,
        "available_tags": available_tags,
    }

@app.get("/history/{report_id}")
async def get_report_detail(report_id: int, current_user: User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    report = db.query(Report).filter(Report.id == report_id, Report.user_id == current_user.id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return report

@app.delete("/history/{report_id}")
async def delete_report(report_id: int, current_user: User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    report = db.query(Report).filter(Report.id == report_id, Report.user_id == current_user.id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    db.delete(report)
    db.commit()
    return {"message": "Report deleted successfully"}

class UpdateTagsRequest(BaseModel):
    tags: List[str]

@app.patch("/history/{report_id}/tags")
async def update_report_tags(
    report_id: int,
    payload: UpdateTagsRequest,
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db)
):
    report = db.query(Report).filter(Report.id == report_id, Report.user_id == current_user.id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    clean = []
    for t in (payload.tags or []):
        t = (t or "").strip()[:30]
        if t and t not in clean:
            clean.append(t)
        if len(clean) >= 10:
            break
    report.tags = clean
    db.commit()
    return {"id": report.id, "tags": clean}


class UpdateChatHistoryRequest(BaseModel):
    messages: List[dict]


@app.put("/history/{report_id}/chat")
async def update_report_chat_history(
    report_id: int,
    payload: UpdateChatHistoryRequest,
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    report = db.query(Report).filter(Report.id == report_id, Report.user_id == current_user.id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    report.chat_history = sanitize_chat_history(payload.messages)
    db.commit()
    log_event("report_chat_saved", user_id=current_user.id, report_id=report.id, messages=len(report.chat_history or []))
    return {"id": report.id, "chat_history": report.chat_history}


class UpdateEvidenceVerificationRequest(BaseModel):
    citations: List[dict]


@app.put("/history/{report_id}/evidence-verification")
async def update_evidence_verification(
    report_id: int,
    payload: UpdateEvidenceVerificationRequest,
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    report = db.query(Report).filter(Report.id == report_id, Report.user_id == current_user.id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    manifest = list(report.evidence_manifest or build_evidence_manifest(report.sources or []))
    now = datetime.now(timezone.utc).isoformat()
    for citation in (payload.citations or [])[:50]:
        law = str(citation.get("law") or "").strip()
        article = str(citation.get("article") or "").strip()
        status = str(citation.get("status") or "error")
        if not law or not article:
            continue
        target = next((item for item in manifest
                       if law in str(item.get("source") or "") and str(item.get("article_no") or "") == article), None)
        if target is None:
            target = {
                "source": law,
                "type": "law",
                "article_no": article,
                "url": citation.get("url"),
                "retrieved_at": now,
            }
            manifest.append(target)
        target["verification"] = status
        target["verified_at"] = now
        if citation.get("url"):
            target["url"] = citation["url"]
    report.evidence_manifest = manifest
    db.commit()
    return {"id": report.id, "evidence_manifest": manifest}

# --- Legal Watch Endpoints ---

@app.get("/subscriptions")
async def get_subscriptions(
    current_user: User = Depends(auth.get_current_user), 
    db: Session = Depends(get_db)
):
    return legal_watch_engine.get_subscriptions(db, current_user.id)

@app.post("/subscriptions")
async def add_subscription(
    law_name: str = Form(...),
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db)
):
    sub = await legal_watch_engine.subscribe_law(db, current_user.id, law_name)
    if not sub:
        raise HTTPException(status_code=400, detail="Failed to subscribe. Law might not exist.")
    return sub

@app.delete("/subscriptions")
async def remove_subscription(
    law_name: str,
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db)
):
    success = await legal_watch_engine.unsubscribe_law(db, current_user.id, law_name)
    if not success:
        raise HTTPException(status_code=404, detail="Subscription not found")
    return {"message": f"Successfully unsubscribed from {law_name}"}

@app.get("/notifications")
async def get_notifications(
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db)
):
    return legal_watch_engine.get_notifications(db, current_user.id)

@app.patch("/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: int,
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db)
):
    success = legal_watch_engine.mark_notification_as_read(db, current_user.id, notification_id)
    if not success:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"message": "Notification marked as read"}

@app.post("/notifications/read-all")
async def mark_all_notifications_read(
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db)
):
    count = legal_watch_engine.mark_all_notifications_as_read(db, current_user.id)
    return {"message": f"{count} notifications marked as read"}

@app.get("/legal-watch/check-cron")
async def legal_watch_cron(request: Request, db: Session = Depends(get_db)):
    """Vercel Cron이 매일 호출하는 법령 개정 감시 잡.
    CRON_SECRET 환경변수가 설정돼 있으면 Vercel이 Authorization: Bearer <secret>을 보낸다."""
    secret = os.getenv("CRON_SECRET")
    if not secret or request.headers.get("Authorization") != f"Bearer {secret}":
        raise HTTPException(status_code=401, detail="Unauthorized")
    results = await legal_watch_engine.check_updates(db)
    return {"status": "success", "updates_found": len(results)}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
