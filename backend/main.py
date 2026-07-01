from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Request, BackgroundTasks
import os
import re
import logging
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from typing import List, Optional
from sqlalchemy.orm import Session
from datetime import datetime

from langchain_core.documents import Document
from api.law_client import law_client
from engine.rag import rag_engine
from engine.document_processor import document_processor
from engine.legal_watch import legal_watch_engine
import database
import auth
from database import User, Report, get_db, Subscription, Notification, APIKey
import logging

from pydantic import BaseModel

# Sync request model
class SyncRequest(BaseModel):
    supabase_id: str
    username: str
    nickname: Optional[str] = None

# Setup Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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

# Configure CORS
env_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001").split(",")
# Robustly clean origins: strip spaces and trailing slashes
origins = [origin.strip().rstrip("/") for origin in env_origins if origin.strip()]

logger.info(f"Allowed Origins: {origins}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    # 이 프로젝트의 Vercel 프리뷰/브랜치 배포 URL(예: lawsearch-<hash>-...vercel.app)도 허용
    allow_origin_regex=r"https://lawsearch-[a-z0-9-]+\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
    db_user = db.query(User).filter(User.username == username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")
    
    hashed_password = auth.get_password_hash(password)
    new_user = User(username=username, nickname=nickname, hashed_password=hashed_password)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    access_token = auth.create_access_token(data={"sub": new_user.username})
    return {"access_token": access_token, "token_type": "bearer", "username": new_user.username, "nickname": new_user.nickname}

@app.post("/auth/login")
@limiter.limit("5/minute")
async def login(request: Request, username: str = Form(...), password: str = Form(...), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == username).first()
    if not user or not auth.verify_password(password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect username or password")
    
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
        payload = auth.decode_token_payload(token)
        if payload.get("sub") != request.supabase_id:
            raise HTTPException(status_code=403, detail="Token sub does not match requested supabase_id")
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
            # 기존 유저가 있으면 supabase_id만 연결 (업데이트)
            logger.debug(f"DEBUG: Linking existing legacy user {user.username} to supabase_id {request.supabase_id}")
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
        logger.error(f"DEBUG: Sync failed: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Sync failed: {str(e)}")
        
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

@app.get("/laws/article")
async def get_law_article(law_name: str, article_no: str):
    text = rag_engine.get_article_text(law_name, article_no)
    if not text:
        raise HTTPException(status_code=404, detail="Article not found")
    return {"text": text}

@app.get("/laws/synced")
async def get_synced_laws():
    return rag_engine.get_synced_msts()

@app.post("/laws/recommend")
async def recommend_laws(case: str = Form(...)):
    return await rag_engine.recommend_laws(case)

@app.get("/laws/search")
async def search_laws(query: str, page: int = 1):
    return await law_client.search_laws(query, page=page)

@app.post("/upload")
@limiter.limit("10/minute")
async def upload_document(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    current_user: User = Depends(auth.get_current_user)
):
    filename = file.filename.lower()
    is_pdf = filename.endswith(".pdf")
    is_hwpx = filename.endswith(".hwpx")

    if not (is_pdf or is_hwpx):
        raise HTTPException(status_code=400, detail="PDF 또는 HWPX 파일만 업로드할 수 있습니다.")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File too large. Maximum size is 10MB.")

    if is_pdf:
        docs = document_processor.process_pdf(content, file.filename)
    else:
        docs = document_processor.process_hwpx(content, file.filename)

    if not docs:
        raise HTTPException(
            status_code=400,
            detail="문서에서 텍스트를 추출하지 못했습니다. 스캔본(이미지) PDF이거나 텍스트 레이어가 없는 파일일 수 있습니다. 텍스트 기반 PDF로 다시 시도해 주세요."
        )

    # 임베딩은 청크 수에 비례해 수 분까지 걸릴 수 있어 HTTP 요청 안에서 처리하면
    # 연결 타임아웃("Network Error")이 난다. 백그라운드로 넘기고 즉시 응답한다.
    background_tasks.add_task(rag_engine.add_documents, docs, current_user.id)
    return {"message": f"File {file.filename} accepted and is being processed", "status": "processing"}

@app.get("/uploads")
async def get_uploads(current_user: User = Depends(auth.get_current_user)):
    return rag_engine.get_user_uploads(user_id=current_user.id)

@app.delete("/uploads/{source}")
async def delete_upload(source: str, current_user: User = Depends(auth.get_current_user)):
    # source is the unique filename/source name
    rag_engine.delete_user_upload(source, user_id=current_user.id)
    return {"message": f"Source {source} deleted"}

@app.get("/query-context")
async def query_context(
    query: str,
    current_user: Optional[User] = Depends(auth.get_current_user_optional)
):
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
                if metadata.get("type") == "user_upload" and str(metadata.get("user_id")) != str(user_id_str):
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
            logger.info(f"[query-context] upload relevance kept={relevant} docs {before}->{len(docs)}")

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
                if src not in [s['source'] for s in sources_list]:
                    sources_list.append({"source": src, "type": src_type})

        context = "\n\n".join(context_parts[:10])
        
        return {
            "context": context,
            "sources": sources_list,
            "intent": intent
        }
    except Exception as e:
        logger.error(f"Error in query-context: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# --- History Endpoints ---

class SaveReportRequest(BaseModel):
    query: str
    answer: str
    engine: Optional[str] = None
    sources: Optional[List[dict]] = None

@app.post("/history")
async def save_report_history(
    payload: SaveReportRequest,
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db)
):
    # 채팅이 Vercel /api/chat(gpt-5.5)로 옮겨가면서 백엔드 /query의 히스토리 저장이
    # 더 이상 호출되지 않으므로, REPORT 생성 후 프론트가 이 엔드포인트로 저장한다.
    new_report = Report(
        user_id=current_user.id,
        query=payload.query,
        answer=payload.answer,
        engine=payload.engine,
        sources=payload.sources or []
    )
    db.add(new_report)
    db.commit()
    db.refresh(new_report)
    return {"id": new_report.id}

@app.get("/history")
async def get_history(current_user: User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    reports = db.query(Report).filter(Report.user_id == current_user.id).order_by(Report.created_at.desc()).all()
    return reports

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

@app.post("/legal-watch/check")
async def trigger_legal_watch_check(
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db)
):
    # This might be restricted to admin in production
    results = await legal_watch_engine.check_updates(db)
    return {"status": "success", "updates_found": len(results), "details": results}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
