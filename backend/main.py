from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends
import os
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from typing import List, Optional
from sqlalchemy.orm import Session
from datetime import datetime

from api.law_client import law_client
from engine.rag import rag_engine, vision_engine
from engine.document_processor import document_processor
from engine.legal_watch import legal_watch_engine
import database
import auth
from database import User, Report, get_db, Subscription, Notification
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

# Configure CORS
env_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001").split(",")
# Robustly clean origins: strip spaces and trailing slashes
origins = [origin.strip().rstrip("/") for origin in env_origins if origin.strip()]

logger.info(f"Allowed Origins: {origins}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {"message": "JongLaw AI API is running"}

# --- Auth Endpoints ---

@app.post("/auth/signup")
async def signup(
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
async def login(username: str = Form(...), password: str = Form(...), db: Session = Depends(get_db)):
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
async def sync_user(request: SyncRequest, db: Session = Depends(get_db)):
    # Check if user already exists in our DB by supabase_id
    user = db.query(User).filter(User.supabase_id == request.supabase_id).first()
    
    if not user:
        # Check if a legacy user with the same email (username) exists
        user = db.query(User).filter(User.username == request.username).first()
        if user:
            # Link existing user to Supabase
            user.supabase_id = request.supabase_id
        else:
            # Create new user record
            user = User(
                supabase_id=request.supabase_id,
                username=request.username,
                nickname=request.nickname
            )
            db.add(user)
    else:
        # Just update nickname if provided and different
        if request.nickname and user.nickname != request.nickname:
            user.nickname = request.nickname
            
    db.commit()
    db.refresh(user)
    return {"status": "synced", "nickname": user.nickname}

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
async def upload_document(file: UploadFile = File(...)):
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")
    
    content = await file.read()
    docs = document_processor.process_pdf(content, file.filename)
    rag_engine.add_documents(docs)
    return {"message": f"File {file.filename} uploaded and processed"}

@app.get("/uploads")
async def get_uploads():
    return rag_engine.get_user_uploads()

@app.delete("/uploads/{source}")
async def delete_upload(source: str):
    # source is the unique filename/source name
    rag_engine.delete_user_upload(source)
    return {"message": f"Source {source} deleted"}

@app.post("/analyze-image")
@app.post("/analyze-document")
async def analyze_document(
    file: UploadFile = File(...),
    description: Optional[str] = Form(None)
):
    valid_image_types = ["image/jpeg", "image/png", "image/jpg", "image/webp"]
    
    if file.content_type in valid_image_types:
        image_bytes = await file.read()
        result = await vision_engine.analyze_contract_document(image_bytes=image_bytes, user_description=description)
        return result
    elif file.content_type == "application/pdf" or file.filename.lower().endswith(".pdf"):
        pdf_bytes = await file.read()
        docs = document_processor.process_pdf(pdf_bytes, file.filename)
        full_text = "\n".join([doc.page_content for doc in docs])
        result = await vision_engine.analyze_contract_document(text_content=full_text, user_description=description)
        return result
    else:
        raise HTTPException(status_code=400, detail="Only image or PDF files are supported")

@app.post("/query")
async def query_ai(
    query: str = Form(...), 
    db: Session = Depends(get_db), 
    current_user: Optional[User] = Depends(auth.get_current_user_optional) # Custom optional helper
):
    logger.info(f"DEBUG: /query received. user={'Anonymous' if not current_user else current_user.username}")
    try:
        # 1. Autonomous Syncing Logic
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
                                    rag_engine.add_documents(docs)
                    except Exception as sync_e:
                        print(f"Warning: Auto-sync failed for law {law_name}: {sync_e}")

        # 2. Autonomous Precedent Syncing
        try:
            # We use the user query to find relevant precedents
            # Limit to top 3 for performance
            prec_search = await law_client.search_precedents(query)
            prec_list = prec_search.get("prec", [])
            if isinstance(prec_list, dict): prec_list = [prec_list]
            
            synced_msts = rag_engine.get_synced_msts() # For precedents, we use ID as MST field
            
            for prec_item in prec_list[:3]:
                prec_id = prec_item.get("판례일련번호")
                if prec_id and str(prec_id) not in synced_msts:
                    print(f"Auto-syncing precedent: {prec_item.get('사건명')} ({prec_id})")
                    prec_detail = await law_client.get_precedent_detail(prec_id)
                    if prec_detail:
                        docs = document_processor.process_precedent_xml(prec_detail, prec_id)
                        if docs:
                            rag_engine.add_documents(docs)
        except Exception as prec_sync_e:
            print(f"Warning: Precedent auto-sync failed: {prec_sync_e}")

        # 3. Final RAG Query
        result = await rag_engine.query(query, target_laws=required_laws)
        
        # 3. Save to history if logged in AND intent is REPORT
        intent = result.get("intent", "").upper()
        logger.info(f"DEBUG: Query result intent={intent}, user_logged_in={current_user is not None}")
        
        if current_user and intent == "REPORT":
            logger.info(f"DEBUG: Saving report to history for user_id={current_user.id}")
            new_report = Report(
                user_id=current_user.id,
                query=query,
                answer=result["answer"],
                engine=result.get("engine"),
                sources=result["sources"]
            )
            try:
                db.add(new_report)
                db.commit()
                db.refresh(new_report)
                result["report_id"] = new_report.id
                logger.info(f"DEBUG: Report saved successfully with id={new_report.id}")
            except Exception as save_err:
                logger.error(f"DEBUG: Database SAVE ERROR: {save_err}")
                db.rollback()
        elif intent == "REPORT" and not current_user:
            logger.info("DEBUG: Intent is REPORT but user not logged in. skipping save.")
        elif current_user and intent != "REPORT":
            logger.info(f"DEBUG: User logged in but intent {intent} is not REPORT. skipping save.")

        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- History Endpoints ---

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

@app.post("/chat/report/{report_id}")
async def report_followup_chat(
    report_id: int,
    query: str = Form(...),
    current_user: User = Depends(auth.get_current_user_optional),
    db: Session = Depends(get_db)
):
    logger.info(f"DEBUG: report_followup_chat received. report_id={report_id}, query={query}")
    if not current_user:
        logger.info("DEBUG: No current user found (Unauthorized)")
        raise HTTPException(status_code=401, detail="Authentication required")
        
    logger.info(f"DEBUG: Authenticated user_id={current_user.id}")
    report = db.query(Report).filter(Report.id == report_id).first()
    
    if not report:
        logger.info(f"DEBUG: Report {report_id} not found in database")
        raise HTTPException(status_code=404, detail="Report not found")
        
    if report.user_id != current_user.id:
        logger.info(f"DEBUG: Owner mismatch. Report {report_id} belongs to {report.user_id}, but current user is {current_user.id}")
        raise HTTPException(status_code=403, detail="You do not have permission to view this report")
    
    # Context is the report's answer
    report_context = report.answer
    chat_history = report.chat_history or []
    
    result = await rag_engine.query_followup(query, report_context, chat_history)
    
    # Update history in DB
    new_history = list(chat_history)
    new_history.append({"role": "user", "content": query})
    new_history.append({"role": "assistant", "content": result["answer"]})
    
    report.chat_history = new_history
    db.commit()
    
    return result

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
    db: Session = Depends(get_db)
):
    # This might be restricted to admin in production
    results = await legal_watch_engine.check_updates(db)
    return {"status": "success", "updates_found": len(results), "details": results}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
