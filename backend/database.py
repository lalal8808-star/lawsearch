from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime, ForeignKey, JSON
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
    db_dir = os.getenv("DATABASE_DIR", ".")
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

class Report(Base):
    __tablename__ = "reports"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    query = Column(Text)
    answer = Column(Text)
    engine = Column(String, nullable=True)
    sources = Column(JSON) # Store as JSON list
    chat_history = Column(JSON, default=list) # Store list of {"role": "...", "content": "..."}
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

def init_db():
    Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
